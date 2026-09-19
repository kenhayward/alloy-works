import { sql } from 'kysely';
import pg from 'pg';
import type { TenantTransaction } from './tables.js';

const TENANT_ID = /^[0-9a-z]{1,40}$/;

/** The application name the listening connection takes, so a test can find and cut it. */
const LISTENER = 'alloy-works-listener';

/** One channel per tenant (ADR-0018). Ids travel on it, never content. */
export function tenantChannel(tenantId: string): string {
  if (!TENANT_ID.test(tenantId)) {
    throw new Error(`Not a tenant id: ${JSON.stringify(tenantId)}`);
  }
  return `aw_t_${tenantId}`;
}

/** What an environment says has happened: a kind, an id, and where it got to. Never content. */
export interface TenantEvent {
  readonly kind: 'sample';
  readonly id: string;
  readonly state: string;
}

/**
 * Said inside the transaction that changed something, so nothing is announced that did not commit.
 * The channel is derived from the role doing the notifying, so a tenant can announce only its own.
 */
export async function notifyTenant(trx: TenantTransaction, event: TenantEvent): Promise<void> {
  await sql`select pg_notify('aw_t_' || substring(current_user::text from 3), ${JSON.stringify(event)})`.execute(
    trx,
  );
}

/** One watcher's hold on a tenant's channel. */
export interface Subscription {
  /** Stop hearing this tenant's events. Calling it again does nothing. */
  stop(): void;
  /**
   * Resolves once the database has acknowledged the LISTEN that covers this tenant's channel, so
   * everything committed after it resolves is heard - whether this subscription asked for that
   * LISTEN, joined one still on its way (even one queued behind the UNLISTEN of the last watcher to
   * leave), or joined a channel already listened to. Read a snapshot only after it: anything
   * committed before the LISTEN lands reaches nobody (issue #137).
   *
   * Rejects, and never hangs, when the LISTEN cannot be made - the database cannot be reached, the
   * connection is lost while asking, or the listener is closed first. A watcher that cannot be heard
   * should end and try again, rather than show a snapshot that will never move. Once resolved it
   * stays resolved: a connection lost later is made again and every channel re-listened, but what is
   * committed while it is down reaches nobody.
   */
  readonly ready: Promise<void>;
}

/** Why a subscription made after its listener closed, or queued when it closed, is not heard. */
class ListenerClosed extends Error {
  constructor() {
    super('The listener is closed, so nothing on this channel will be heard');
  }
}

export interface TenantListener {
  /** Hear this tenant's events until the subscription is stopped. */
  subscribe(tenantId: string, handler: (event: TenantEvent) => void): Subscription;
  /** The channels it is listening to now. For tests and diagnostics. */
  listening(): string[];
  close(): Promise<void>;
}

/**
 * One connection for every stream this instance holds: it listens to a tenant's channel while
 * somebody is watching, and stops when the last one goes. A lost connection is made again and every
 * channel re-listened, because a stream that hears nothing looks exactly like nothing happening.
 */
export function listenToTenants(
  url: string,
  options: { readonly onError?: (error: unknown) => void } = {},
): TenantListener {
  const handlers = new Map<string, Set<(event: TenantEvent) => void>>();
  // Each watched channel's LISTEN, resolved once the database has acknowledged it. Forgotten when
  // the last watcher goes, when the LISTEN fails, and when the connection is lost, so the next
  // watcher asks again rather than trusting a LISTEN that no longer covers it.
  const acknowledged = new Map<string, Promise<void>>();
  let client: pg.Client | undefined;
  let connecting: Promise<pg.Client> | undefined;
  let closed = false;
  // A pg client runs one query at a time. Every listen and unlisten waits its turn here, so none is
  // sent while another is in flight - pg 8 warns about that, and pg 9 refuses it.
  let turns: Promise<void> = Promise.resolve();

  function inTurn(work: () => Promise<unknown>): Promise<void> {
    const done = turns.then(work).then(() => undefined);
    turns = done.catch((error: unknown) => {
      if (!(error instanceof ListenerClosed)) options.onError?.(error);
    });
    return done;
  }

  function listen(channel: string): Promise<void> {
    const ack = inTurn(async () => {
      if (closed) throw new ListenerClosed();
      await (await connection()).query(`listen ${channel}`);
    });
    acknowledged.set(channel, ack);
    // Also settles a rejection nobody waits on, which would otherwise be unhandled.
    ack.catch(() => {
      if (acknowledged.get(channel) === ack) acknowledged.delete(channel);
    });
    return ack;
  }

  async function connect(): Promise<pg.Client> {
    const made = new pg.Client({ connectionString: url, application_name: LISTENER });
    made.on('notification', (message) => {
      const listeners = handlers.get(message.channel);
      if (!listeners || !message.payload) return;
      const event = JSON.parse(message.payload) as TenantEvent;
      for (const handler of [...listeners]) handler(event);
    });
    made.on('error', (error) => {
      options.onError?.(error);
      acknowledged.clear();
      client = undefined;
      connecting = undefined;
      if (!closed) setTimeout(() => void reconnect(), 100);
    });
    await made.connect();
    for (const channel of handlers.keys()) {
      await made.query(`listen ${channel}`);
    }
    client = made;
    return made;
  }

  async function reconnect(): Promise<void> {
    if (closed || client) return;
    try {
      await connection();
    } catch (error) {
      options.onError?.(error);
      if (!closed) setTimeout(() => void reconnect(), 250);
    }
  }

  function connection(): Promise<pg.Client> {
    if (client) return Promise.resolve(client);
    connecting ??= connect().finally(() => {
      connecting = undefined;
    });
    return connecting;
  }

  return {
    subscribe(tenantId, handler) {
      const channel = tenantChannel(tenantId);
      const listeners = handlers.get(channel) ?? new Set();
      listeners.add(handler);
      handlers.set(channel, listeners);
      const ready = acknowledged.get(channel) ?? listen(channel);
      let stopped = false;
      return {
        stop() {
          if (stopped) return;
          stopped = true;
          listeners.delete(handler);
          if (listeners.size > 0 || handlers.get(channel) !== listeners) return;
          handlers.delete(channel);
          acknowledged.delete(channel);
          void inTurn(async () => {
            if (!closed) await client?.query(`unlisten ${channel}`);
          }).catch(() => {
            // Said through onError, in its turn.
          });
        },
        ready,
      };
    },

    listening: () => [...handlers.keys()],

    async close() {
      closed = true;
      handlers.clear();
      acknowledged.clear();
      await turns;
      const made = client;
      client = undefined;
      await made?.end();
    },
  };
}
