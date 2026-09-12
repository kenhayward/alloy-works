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

export interface TenantListener {
  /** Hear this tenant's events until the returned function is called. */
  subscribe(tenantId: string, handler: (event: TenantEvent) => void): () => void;
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
  let client: pg.Client | undefined;
  let connecting: Promise<pg.Client> | undefined;
  let closed = false;

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
      const first = listeners.size === 0;
      listeners.add(handler);
      handlers.set(channel, listeners);
      if (first) {
        void connection()
          .then((made) => made.query(`listen ${channel}`))
          .catch((error: unknown) => options.onError?.(error));
      }
      return () => {
        listeners.delete(handler);
        if (listeners.size > 0) return;
        handlers.delete(channel);
        void client
          ?.query(`unlisten ${channel}`)
          .catch((error: unknown) => options.onError?.(error));
      };
    },

    listening: () => [...handlers.keys()],

    async close() {
      closed = true;
      handlers.clear();
      const made = client;
      client = undefined;
      await made?.end();
    },
  };
}
