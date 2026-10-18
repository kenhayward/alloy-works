import type { FastifyReply, FastifyRequest } from 'fastify';

import type { Streamed } from './after-commit.js';
import { REQUEST_ID_HEADER } from './http.js';

/** How often a streamed answer says it is alive, so a proxy holds the connection open. */
const ALIVE_MS = 25_000;

/**
 * A `Streamed` answer sent (the G2 plan, G2-A): the head written as the live stream's is, a `: alive`
 * comment every 25 s, each event as `run` sends it until the caller goes, and the stream ended when
 * `run` settles. Apart from the routes, so a timer here reaches no connector.
 */
export async function sendStreamed(
  request: FastifyRequest,
  reply: FastifyReply,
  body: Streamed,
): Promise<void> {
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
  const closed = new AbortController();
  const gone = () => closed.abort();
  request.raw.on('close', gone);
  const alive = setInterval(() => raw.write(': alive\n\n'), ALIVE_MS);
  try {
    await body.run((event, data) => {
      if (!closed.signal.aborted) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }, closed.signal);
  } catch (error) {
    request.log.error({ err: error }, 'a streamed answer failed');
  } finally {
    clearInterval(alive);
    request.raw.off('close', gone);
    raw.end();
  }
}
