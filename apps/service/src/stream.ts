import {
  leavePresence,
  locksShown,
  presenceShown,
  streamScope,
  type StreamScope,
  type Tenant,
  type TenantDatabase,
  type TenantEvent,
  type TenantListener,
} from '@alloy-works/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Credential } from './app.js';
import { REQUEST_ID_HEADER } from './http.js';

/** How long a browser waits before coming back, and how often we prove the connection is alive. */
export const STREAM_RETRY_MS = 5000;
const HEARTBEAT_MS = 25_000;
/** Enough to show what is going on, few enough that a snapshot is small. */
const SNAPSHOT_SAMPLES = 20;
/**
 * How long a stream lives before it ends and the browser comes back (the PL plan, PL-B): a grant
 * lapsing by the clock changes no row, so nothing announces it; a stream that reconnects is read
 * afresh within this.
 */
export const STREAM_LIFETIME_MS = 5 * 60 * 1000;

/** A scoped stream's range: its scope, whom it is for, and the components of it they may read. */
export interface ScopedStream {
  readonly scope: StreamScope;
  readonly principalId: string;
  readonly components: ReadonlySet<string>;
  /** The window this stream is, as its presence beats name it: closing takes its presence with it. */
  readonly viewer?: string;
}

/**
 * One viewer's stream. It registers with the fan-out and waits until it is heard *before* reading
 * its snapshot, because an event committed before the database is listening reaches nobody and would
 * leave the viewer on the snapshot's older state (issue #137). It holds what arrives until the
 * snapshot has gone, because an event committed in between would otherwise reach the viewer first
 * and be undone by the older snapshot (ADR-0018). A subscription that cannot be heard ends the
 * stream, and the browser comes back after STREAM_RETRY_MS. The credential it was opened with ending
 * - a sign-out, a token revoked - ends it too, on the notice every replica hears (IAM-082, D7-I).
 *
 * **Scoped** to a document or a component (the PL plan, PL-A, PL-B), it sends only what its viewer
 * may read of that scope, as read when it opened: a lock read again as it now stands, the document's
 * outline, and the end any change to access brings. The environment's own stream sends samples alone.
 * Every stream ends after `STREAM_LIFETIME_MS` and is read afresh when it comes back.
 */
export async function streamToViewer(options: {
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly db: TenantDatabase;
  readonly events: TenantListener;
  readonly tenant: Tenant;
  /** What the viewer signed in with: its ending ends the stream. */
  readonly credential: Credential | null;
  /** A document's or a component's stream, read when it was asked for; none for the environment's. */
  readonly scoped?: ScopedStream;
  readonly lifetimeMs?: number;
}): Promise<void> {
  const { request, reply, db, events, tenant, credential, scoped } = options;
  let components = scoped?.components ?? new Set<string>();
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Proxies that buffer would hold every frame until the stream ended.
    'x-accel-buffering': 'no',
    // A hijacked reply skips the hook that gives every other response its identifier (API-047).
    [REQUEST_ID_HEADER]: request.id,
  });
  const send = (event: string, data: unknown) => {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  raw.write(`retry: ${STREAM_RETRY_MS}\n\n`);

  // Set once the viewer has gone, so nothing is read or written for nobody.
  let gone = false;

  /** What one event becomes for this viewer. Run one at a time, in the order they were heard. */
  const deliver = async (event: TenantEvent): Promise<void> => {
    if (scoped === undefined) {
      if (event.kind === 'sample') send('sample', event);
      return;
    }
    if (event.kind === 'permissions') {
      send('permissions', {});
      end();
      return;
    }
    if (event.kind === 'lock' && components.has(event.component)) {
      const [lock] = await db.withTenant(tenant, (trx) => locksShown(trx, [event.component]));
      if (!gone && lock) send('lock', lock);
      return;
    }
    const document = 'document' in scoped.scope ? scoped.scope.document : null;
    if (event.kind === 'presence' && event.document === document) {
      // Read as it now stands: a row silent past a minute, or gone, is absence (COL-055).
      const [shown] = await db.withTenant(tenant, (trx) =>
        presenceShown(trx, document, components, event.viewer),
      );
      if (!gone) send(shown ? 'presence' : 'presence_left', shown ?? { viewer: event.viewer });
      return;
    }
    if (event.kind === 'presence_left' && event.document === document) {
      send('presence_left', { viewer: event.viewer });
      return;
    }
    if (
      event.kind === 'outline' &&
      'document' in scoped.scope &&
      event.document === scoped.scope.document
    ) {
      // Its components may have changed: what the stream ranges over is read again first.
      const now = await db.withTenant(tenant, (trx) =>
        streamScope(trx, scoped.principalId, scoped.scope),
      );
      if (now === undefined) {
        send('permissions', {});
        end();
        return;
      }
      components = now;
      if (!gone) send('outline', { document: event.document });
    }
  };
  let queue = Promise.resolve();
  const enqueue = (event: TenantEvent) => {
    queue = queue
      .then(() => (gone ? undefined : deliver(event)))
      .catch((error: unknown) => request.log.error({ err: error }, 'a stream event was not sent'));
  };

  let sent = false;
  const held: TenantEvent[] = [];
  const subscription = events.subscribe(tenant.id, (event) => {
    if (event.kind === 'credential_ended') {
      if (credential !== null && endsCredential(event, credential)) end();
      return;
    }
    if (sent) enqueue(event);
    else held.push(event);
  });
  const beat = setInterval(() => raw.write(': alive\n\n'), HEARTBEAT_MS);
  const lifetime = setTimeout(() => end(), options.lifetimeMs ?? STREAM_LIFETIME_MS);
  function stop() {
    if (gone) return;
    gone = true;
    clearInterval(beat);
    clearTimeout(lifetime);
    subscription.stop();
    // A dropped connection is absence at once, not 30 seconds of a live claim (COL-004).
    if (scoped?.viewer !== undefined) {
      const viewer = scoped.viewer;
      void db
        .withTenant(tenant, (trx) => leavePresence(trx, scoped.principalId, viewer))
        .catch((error: unknown) => request.log.error({ err: error }, 'a presence was not removed'));
    }
  }
  function end() {
    stop();
    raw.end();
  }
  request.raw.on('close', stop);

  try {
    await subscription.ready;
    if (gone) return;
    const snapshot =
      scoped === undefined
        ? {
            samples: await db.withTenant(tenant, (trx) =>
              trx
                .selectFrom('sample')
                .select(['id', 'state'])
                .orderBy('requested_at', 'desc')
                .limit(SNAPSHOT_SAMPLES)
                .execute(),
            ),
          }
        : await db.withTenant(tenant, async (trx) => ({
            locks: (await locksShown(trx, components)).filter((lock) => lock.holder !== null),
            presence:
              'document' in scoped.scope
                ? await presenceShown(trx, scoped.scope.document, components)
                : [],
          }));
    if (gone) return;
    send('snapshot', snapshot);
    sent = true;
    for (const event of held) enqueue(event);
    held.length = 0;
  } catch (error) {
    // A viewer who has already left is not a stream that could not start.
    const left = gone;
    end();
    if (!left) request.log.error({ err: error }, 'a stream could not start');
  }
}

/** Whether a notice that a credential ended names this one. */
export function endsCredential(
  event: Extract<TenantEvent, { kind: 'credential_ended' }>,
  credential: Credential,
): boolean {
  return credential.kind === 'session'
    ? 'session' in event && event.session === credential.id
    : 'token' in event && event.token === credential.id;
}
