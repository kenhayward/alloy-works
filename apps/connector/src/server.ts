import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  RUN_REQUEST_MAX_BYTES,
  credentialContext,
  describeRequestSchema,
  describeSqlRequestSchema,
  runRequestSchema,
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

/** The most a seal's or a test's body may be (D1-E). */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * The most a body may be on each path: a run's and a describe's hold a definition, of up to 512 KiB,
 * and its values (the D2 plan, task 3 and final review 2); a seal's and a test's no more than D1's.
 */
const bodyLimits: Readonly<Record<string, number>> = {
  '/v1/seal': MAX_BODY_BYTES,
  '/v1/test': MAX_BODY_BYTES,
  '/v1/describe': RUN_REQUEST_MAX_BYTES,
  '/v1/run': RUN_REQUEST_MAX_BYTES,
};

class TooLarge extends Error {}

async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new TooLarge();
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += (chunk as Buffer).length;
    if (bytes > limit) throw new TooLarge();
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
 * The connector's interface (the D1 plan, D1-E; the D2 plan, task 3): HTTP/1.1 and JSON on
 * `connector-private`. `seal`, `test`, `describe` - of the relations, or of a statement - and `run`
 * need the service's key; `health` answers anybody. A named failure is an answer (200); a malformed
 * request is 400 `request_invalid`; an unauthenticated one 401 with no body; a body over its path's
 * limit - 1 MiB and 64 KiB for a run or a describe, 64 KiB otherwise - 413; a full supervisor 503
 * `connector_busy`. One log line a request but a health
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
      ...(config.ca === undefined ? {} : { ca: config.ca }),
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
    const limit =
      request.method === 'POST' && Object.hasOwn(bodyLimits, path ?? '')
        ? bodyLimits[path ?? '']
        : undefined;
    if (limit === undefined) return send(404);
    if (!authenticated(request, config.keyDigest)) {
      // Drain and drop the body unread, so the answer is not written under an unread upload.
      request.resume();
      return send(401);
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(request, limit)) as unknown;
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
    const before = stderrBytes;
    // A caller that closes its request before the answer is sent has stopped waiting - a person signed
    // out, or a token revoked (IAM-082, the D7 plan's D7-I): the child is killed, and with it its
    // connection to the source, which sees its client gone within 250 ms.
    const gone = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) gone.abort();
    });
    let answer;
    if (path === '/v1/run') {
      const parsed = runRequestSchema.safeParse(body);
      if (!parsed.success) return send(400, { code: 'request_invalid' });
      answer = await supervisor.run('run', parsed.data, gone.signal);
    } else if (
      path === '/v1/describe' &&
      typeof body === 'object' &&
      body !== null &&
      ('sql' in body || 'builder' in body || 'http' in body || 'file' in body)
    ) {
      // A describe taking a statement, SQL or a built query's: its columns, never run (D2-G, D4-Q);
      // or an HTTP request's or an object's, sampled for its columns (the D6 plan, D6-A).
      const parsed = describeSqlRequestSchema.safeParse(body);
      if (!parsed.success) return send(400, { code: 'request_invalid' });
      answer = await supervisor.run('describeSql', parsed.data, gone.signal);
    } else if (path === '/v1/describe') {
      // The relations, as the account or as a person (the D7 plan, D7-G).
      const parsed = describeRequestSchema.safeParse(body);
      if (!parsed.success) return send(400, { code: 'request_invalid' });
      answer = await supervisor.run('describe', parsed.data, gone.signal);
    } else {
      // A test checks the account, so it never carries a person.
      const parsed = testRequestSchema.safeParse(body);
      if (!parsed.success) return send(400, { code: 'request_invalid' });
      answer = await supervisor.run('test', parsed.data, gone.signal);
    }
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
