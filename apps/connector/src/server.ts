import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  credentialContext,
  sealRequestSchema,
  testRequestSchema,
  type SealAnswer,
} from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';

import { productionDeny, type ConnectorConfig } from './config.js';
import { readNetworkDeny } from './network.js';
import {
  createSupervisor,
  type ChildSpec,
  type SpawnChild,
  type Supervisor,
} from './supervisor.js';

/** The most a request body may be (D1-E). */
export const MAX_BODY_BYTES = 64 * 1024;

class TooLarge extends Error {}

async function readBody(request: IncomingMessage): Promise<string> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new TooLarge();
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_BODY_BYTES) throw new TooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Whether the request carries the service's key, compared as SHA-256 digests in constant time. */
function authenticated(request: IncomingMessage, keyDigest: Buffer): boolean {
  const header = request.headers.authorization ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  const presented = createHash('sha256').update(match[1]!, 'utf8').digest();
  return timingSafeEqual(presented, keyDigest);
}

/**
 * The connector's interface (the D1 plan, D1-E): HTTP/1.1 and JSON on `connector-private`. `seal`,
 * `test` and `describe` need the service's key; `health` answers anybody. A named failure is an
 * answer (200); a malformed request is 400 `request_invalid`; an unauthenticated one 401 with no body;
 * a body over 64 KiB 413; a full supervisor 503 `connector_busy`. One log line a request but a health
 * probe, holding neither the body nor the answer.
 */
export function createConnectorServer(options: {
  readonly config: ConnectorConfig;
  /**
   * The ranges the child's guard refuses. Production's - the built-in ones, CONNECTOR_DENY's, and each
   * gateway and address of the connector's own networks, read as the server is made - unless a test
   * hands it another: a parameter, never configuration (D1-K).
   */
  readonly deny?: readonly string[];
  readonly spec?: ChildSpec | ((slot: number) => ChildSpec);
  readonly spawn?: SpawnChild;
  readonly supervisor?: Supervisor;
  readonly log?: (line: string) => void;
  readonly clock?: () => number;
}): Server {
  const { config } = options;
  const clock = options.clock ?? Date.now;
  const log = options.log ?? ((line: string) => void process.stdout.write(`${line}\n`));
  let stderrBytes = 0;
  const supervisor =
    options.supervisor ??
    createSupervisor({
      sealingKey: config.sealingKey,
      deny: options.deny ?? productionDeny(config, readNetworkDeny()),
      maxChildren: config.maxChildren,
      // Production's children, each as its slot's own user, unless a test hands another.
      ...(options.spec ? { spec: options.spec } : {}),
      ...(options.spawn ? { spawn: options.spawn } : {}),
      onStderrBytes: (bytes) => {
        stderrBytes += bytes;
      },
    });

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<{ status: number; stderrBytes: number }> {
    const send = (status: number, body?: unknown) => {
      if (body === undefined) {
        response.writeHead(status, { 'content-length': '0' }).end();
      } else {
        const text = JSON.stringify(body);
        response
          .writeHead(status, {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(text)),
          })
          .end(text);
      }
      return { status, stderrBytes: 0 };
    };
    const path = (request.url ?? '').split('?')[0];
    if (request.method === 'GET' && path === '/v1/health') return send(200, { ok: true });
    const paths = ['/v1/seal', '/v1/test', '/v1/describe'];
    if (request.method !== 'POST' || !paths.includes(path ?? '')) return send(404);
    if (!authenticated(request, config.keyDigest)) {
      // Drain and drop the body unread, so the answer is not written under an unread upload.
      request.resume();
      return send(401);
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(request)) as unknown;
    } catch (error) {
      if (error instanceof TooLarge) {
        response.setHeader('connection', 'close');
        return send(413);
      }
      return send(400, { code: 'request_invalid' });
    }
    if (path === '/v1/seal') {
      const parsed = sealRequestSchema.safeParse(body);
      if (!parsed.success) return send(400, { code: 'request_invalid' });
      const answer: SealAnswer = {
        sealed: sealSecret(
          config.sealingKey,
          'source-credential',
          parsed.data.tenant,
          parsed.data.secret,
          credentialContext(parsed.data.connection, parsed.data.settings),
        ),
      };
      return send(200, answer);
    }
    const parsed = testRequestSchema.safeParse(body);
    if (!parsed.success) return send(400, { code: 'request_invalid' });
    const before = stderrBytes;
    const answer = await supervisor.run(path === '/v1/test' ? 'test' : 'describe', parsed.data);
    if (answer === 'busy') return send(503, { code: 'connector_busy' });
    const sent = send(200, answer);
    return { ...sent, stderrBytes: stderrBytes - before };
  }

  return createServer((request, response) => {
    const started = clock();
    handle(request, response)
      .catch(() => {
        if (!response.headersSent) response.writeHead(500, { 'content-length': '0' }).end();
        return { status: 500, stderrBytes: 0 };
      })
      .then(({ status, stderrBytes: written }) => {
        if (config.logLevel === 'silent' || (config.logLevel === 'error' && status < 500)) return;
        // The health check probes every two seconds: a line for each would bury every request.
        if (request.method === 'GET' && (request.url ?? '').split('?')[0] === '/v1/health') return;
        log(
          JSON.stringify({
            at: new Date(started).toISOString(),
            method: request.method,
            path: (request.url ?? '').split('?')[0],
            status,
            ms: clock() - started,
            stderrBytes: written,
          }),
        );
      });
  });
}
