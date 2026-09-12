import type { Tenant, TenantDatabase, TenantEvent, TenantListener } from '@alloy-works/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** How long a browser waits before coming back, and how often we prove the connection is alive. */
export const STREAM_RETRY_MS = 5000;
const HEARTBEAT_MS = 25_000;
/** Enough to show what is going on, few enough that a snapshot is small. */
const SNAPSHOT_SAMPLES = 20;

/**
 * One viewer's stream. It registers with the fan-out *before* reading its snapshot and holds what
 * arrives until the snapshot has gone, because an event committed in between would otherwise reach
 * the viewer first and be undone by the older snapshot (ADR-0018).
 */
export async function streamToViewer(options: {
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly db: TenantDatabase;
  readonly events: TenantListener;
  readonly tenant: Tenant;
}): Promise<void> {
  const { request, reply, db, events, tenant } = options;
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Proxies that buffer would hold every frame until the stream ended.
    'x-accel-buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  raw.write(`retry: ${STREAM_RETRY_MS}\n\n`);

  let sent = false;
  const held: TenantEvent[] = [];
  const unsubscribe = events.subscribe(tenant.id, (event) => {
    if (sent) send('sample', event);
    else held.push(event);
  });
  const beat = setInterval(() => raw.write(': alive\n\n'), HEARTBEAT_MS);
  const stop = () => {
    clearInterval(beat);
    unsubscribe();
  };
  request.raw.on('close', stop);

  try {
    const samples = await db.withTenant(tenant, (trx) =>
      trx
        .selectFrom('sample')
        .select(['id', 'state'])
        .orderBy('requested_at', 'desc')
        .limit(SNAPSHOT_SAMPLES)
        .execute(),
    );
    send('snapshot', { samples });
    sent = true;
    for (const event of held) send('sample', event);
    held.length = 0;
  } catch (error) {
    stop();
    raw.end();
    request.log.error({ err: error }, 'a stream could not start');
  }
}
