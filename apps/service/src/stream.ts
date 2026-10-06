import type { Tenant, TenantDatabase, TenantEvent, TenantListener } from '@alloy-works/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Credential } from './app.js';
import { REQUEST_ID_HEADER } from './http.js';

/** How long a browser waits before coming back, and how often we prove the connection is alive. */
export const STREAM_RETRY_MS = 5000;
const HEARTBEAT_MS = 25_000;
/** Enough to show what is going on, few enough that a snapshot is small. */
const SNAPSHOT_SAMPLES = 20;

/**
 * One viewer's stream. It registers with the fan-out and waits until it is heard *before* reading
 * its snapshot, because an event committed before the database is listening reaches nobody and would
 * leave the viewer on the snapshot's older state (issue #137). It holds what arrives until the
 * snapshot has gone, because an event committed in between would otherwise reach the viewer first
 * and be undone by the older snapshot (ADR-0018). A subscription that cannot be heard ends the
 * stream, and the browser comes back after STREAM_RETRY_MS. The credential it was opened with ending
 * - a sign-out, a token revoked - ends it too, on the notice every replica hears (IAM-082, D7-I).
 */
export async function streamToViewer(options: {
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly db: TenantDatabase;
  readonly events: TenantListener;
  readonly tenant: Tenant;
  /** What the viewer signed in with: its ending ends the stream. */
  readonly credential: Credential | null;
}): Promise<void> {
  const { request, reply, db, events, tenant, credential } = options;
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

  let sent = false;
  const held: TenantEvent[] = [];
  const subscription = events.subscribe(tenant.id, (event) => {
    if (event.kind === 'credential_ended') {
      if (credential !== null && endsCredential(event, credential)) {
        stop();
        raw.end();
      }
      return;
    }
    if (sent) send('sample', event);
    else held.push(event);
  });
  const beat = setInterval(() => raw.write(': alive\n\n'), HEARTBEAT_MS);
  // Set once the viewer has gone, so nothing is read or written for nobody.
  let gone = false;
  function stop() {
    if (gone) return;
    gone = true;
    clearInterval(beat);
    subscription.stop();
  }
  request.raw.on('close', stop);

  try {
    await subscription.ready;
    if (gone) return;
    const samples = await db.withTenant(tenant, (trx) =>
      trx
        .selectFrom('sample')
        .select(['id', 'state'])
        .orderBy('requested_at', 'desc')
        .limit(SNAPSHOT_SAMPLES)
        .execute(),
    );
    if (gone) return;
    send('snapshot', { samples });
    sent = true;
    for (const event of held) send('sample', event);
    held.length = 0;
  } catch (error) {
    // A viewer who has already left is not a stream that could not start.
    const left = gone;
    stop();
    raw.end();
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
