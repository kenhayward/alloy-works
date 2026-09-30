import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConnectorConfig } from './config.js';
import { createConnectorServer } from './server.js';
import { childSpawn, runChild, type ChildSpec, type SpawnChild } from './supervisor.js';
import {
  column,
  describeSqlRequest,
  draft,
  requestFor,
  runRequest,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
  LOADED_TIMEOUT_MS,
} from './testing/source.js';

/** An invented secret, with characters each encoding spells differently. */
const CANARY = 'Canary+Secret/9=%&ü-7f3a';
const encodings = [
  CANARY,
  encodeURIComponent(CANARY),
  Buffer.from(CANARY, 'utf8').toString('base64'),
  Buffer.from(CANARY, 'utf8').toString('base64url'),
];

const KEY = Buffer.alloc(32, 3).toString('base64');
const config = loadConnectorConfig({
  CONNECTOR_KEY: KEY,
  CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
  CONNECTOR_DENY: 'none',
});

/** A listener, and every socket it accepted, closed together. */
async function listening(
  onSocket: (socket: Socket) => void,
): Promise<{ server: Server; port: number; sockets: Set<Socket> }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    onSocket(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port, sockets };
}

describe("the connector's secrets", { timeout: LOADED_TIMEOUT_MS }, () => {
  // A source that answers PostgreSQL's request for TLS with no, and one that never answers at all.
  let plain: Awaited<ReturnType<typeof listening>>;
  let silent: Awaited<ReturnType<typeof listening>>;
  beforeAll(async () => {
    plain = await listening((socket) => socket.once('data', () => socket.write('N')));
    silent = await listening(() => {});
  });
  afterAll(async () => {
    for (const each of [plain, silent]) {
      for (const socket of each.sockets) socket.destroy();
      await new Promise<void>((resolve) => each.server.close(() => resolve()));
    }
  });

  it('DAT-005 keeps a credential out of every answer, log line and crash report of the connector, raw, URL-encoded or base64', async () => {
    const seen: string[] = [];
    const stderr: string[] = [];
    // The child's standard error is read and dropped by the supervisor; captured here to search it.
    const spawn: SpawnChild = (spec, input, deadlineMs, onStderr) =>
      runChild(spec, input, deadlineMs, (chunk) => {
        stderr.push(chunk.toString('utf8'));
        onStderr?.(chunk);
      });
    const start = async (spec: ChildSpec) => {
      const server = createConnectorServer({
        config,
        deny: suiteDeny,
        spec,
        spawn,
        log: (line) => seen.push(line),
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    };
    const call = async (url: string, path: string, body: unknown) => {
      const response = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      seen.push(text);
      return { status: response.status, text };
    };

    const real = await start(childSpawn(suiteChild, suiteIsolation));
    const failed =
      '{"outcome":"failed","failure":{"code":"connection_failed","attribution":"connector"}}';
    // Case 2's matrix, for PostgreSQL.
    expect((await call(real.url, '/v1/test', requestFor(settings(), CANARY))).text).toBe(failed);
    expect(
      (
        await call(
          real.url,
          '/v1/test',
          requestFor(settings({ host: 'no-such-source.invalid' }), CANARY),
        )
      ).text,
    ).toBe(failed);
    expect(
      (await call(real.url, '/v1/test', requestFor(settings({ port: plain.port }), CANARY))).text,
    ).toBe(failed);
    expect(
      (await call(real.url, '/v1/test', requestFor(settings({ port: silent.port }), CANARY, 1000)))
        .status,
    ).toBe(200);
    expect((await call(real.url, '/v1/describe', requestFor(settings(), CANARY))).text).toBe(
      '{"failure":{"code":"connection_failed","attribution":"connector"}}',
    );
    // A run and a SQL describe, each failing each way (the D2 plan): a wrong credential, an unknown
    // host, and a source that refuses TLS.
    const definition = draft('select id from sample.site order by id', [
      column('id', { base: 'integer' }),
    ]);
    for (const source of [
      settings(),
      settings({ host: 'no-such-source.invalid' }),
      settings({ port: plain.port }),
    ]) {
      expect((await call(real.url, '/v1/run', runRequest(source, CANARY, definition))).text).toBe(
        failed,
      );
      expect(
        (
          await call(
            real.url,
            '/v1/describe',
            describeSqlRequest(source, CANARY, 'select 1 as one'),
          )
        ).text,
      ).toBe('{"failure":{"code":"connection_failed","attribution":"connector"}}');
    }
    // A malformed host carrying the secret, and a seal refused and one taken, each echo none of it.
    const malformed = requestFor(settings(), CANARY);
    const withHost = {
      ...malformed,
      settings: {
        ...malformed.settings,
        source: { ...malformed.settings.source, host: `reader:${CANARY}@source` },
      },
    };
    expect(await call(real.url, '/v1/test', withHost)).toEqual({
      status: 400,
      text: '{"code":"request_invalid"}',
    });
    expect(
      await call(real.url, '/v1/seal', {
        tenant: 'Not A Tenant',
        connection: randomUUID(),
        secret: CANARY,
        settings: settings(),
      }),
    ).toEqual({
      status: 400,
      text: '{"code":"request_invalid"}',
    });
    expect(
      (
        await call(real.url, '/v1/seal', {
          tenant: 'acme',
          connection: randomUUID(),
          secret: CANARY,
          settings: settings(),
        })
      ).status,
    ).toBe(200);
    await new Promise<void>((resolve) => real.server.close(() => resolve()));

    // A child made to throw the driver's own error, uncaught.
    const crashing = await start({
      file: process.execPath,
      args: [
        '--import',
        'tsx',
        fileURLToPath(new URL('./testing/throwing-child.ts', import.meta.url)),
      ],
      env: {},
    });
    expect((await call(crashing.url, '/v1/test', requestFor(settings(), CANARY))).text).toBe(
      '{"outcome":"failed","failure":{"code":"connector_error","attribution":"connector"}}',
    );
    await new Promise<void>((resolve) => crashing.server.close(() => resolve()));
    // Not vacuous: the crash did write its report, and the supervisor said how long it was.
    expect(stderr.join('')).toMatch(/password authentication failed/);
    expect(seen.some((line) => /"stderrBytes":[1-9]/.test(line))).toBe(true);

    for (const text of [...seen, stderr.join('')]) {
      for (const encoding of encodings) expect(text).not.toContain(encoding);
    }
  });
});
