import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

import { keyPairText } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConnectorConfig } from './config.js';
import { createConnectorServer } from './server.js';
import { childSpawn, runChild, type ChildSpec, type SpawnChild } from './supervisor.js';
import {
  built,
  column,
  describeBuiltRequest,
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
import {
  DEV_CA,
  DEV_KEY,
  get,
  httpDescribeRequest,
  httpDraft,
  httpRequestFor,
  httpRunRequest,
  httpSettings,
  member,
  startFakeApi,
} from './testing/http.js';
import {
  CSV,
  field,
  fileDraft,
  s3DescribeRequest,
  s3RequestFor,
  s3RunRequest,
  s3Settings,
  SOURCES_CA,
  startFakeStore,
} from './testing/s3.js';

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
    // And a built query's run and describe (the D4 plan), each failing each way too.
    const query = {
      sources: [{ alias: 's', table: { schema: 'sample', name: 'site' } }],
      joins: [],
      select: [{ name: 'id', of: { source: 's', column: 'id' } }],
      groupBy: [],
    };
    const builtDefinition = built(query, { id: { base: 'integer' } });
    for (const source of [
      settings(),
      settings({ host: 'no-such-source.invalid' }),
      settings({ port: plain.port }),
    ]) {
      expect((await call(real.url, '/v1/run', runRequest(source, CANARY, definition))).text).toBe(
        failed,
      );
      expect(
        (await call(real.url, '/v1/run', runRequest(source, CANARY, builtDefinition))).text,
      ).toBe(failed);
      expect(
        (await call(real.url, '/v1/describe', describeBuiltRequest(source, CANARY, query))).text,
      ).toBe('{"failure":{"code":"connection_failed","attribution":"connector"}}');
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

  it("DAT-005 keeps an HTTP connection's secret header and every composed URL out of every answer, log line and crash report, raw, URL-encoded or base64", async () => {
    const api = await startFakeApi();
    // A header carries printable ASCII alone, so the canary is that, with what each encoding spells
    // its own way; and a value placed in the URL, so a composed URL can be looked for by it.
    const canary = 'Canary+Header/9=%&-7f3a';
    const placed = 'Placed+Value=9%&-2c1d?#';
    const url = `https://127.0.0.1:${api.port}/v1`;
    const looked = [canary, placed].flatMap((each) => [
      each,
      encodeURIComponent(each),
      Buffer.from(each, 'utf8').toString('base64'),
      Buffer.from(each, 'utf8').toString('base64url'),
    ]);
    const seen: string[] = [];
    const stderr: string[] = [];
    const spawn: SpawnChild = (spec, input, deadlineMs, onStderr) =>
      runChild(spec, input, deadlineMs, (chunk) => {
        stderr.push(chunk.toString('utf8'));
        onStderr?.(chunk);
      });
    const withCa = loadConnectorConfig(
      {
        CONNECTOR_KEY: KEY,
        CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
        CONNECTOR_DENY: 'none',
        CONNECTOR_CA_FILE: 'ca.pem',
      },
      () => DEV_CA,
    );
    const start = async (spec: ChildSpec) => {
      const server = createConnectorServer({
        config: withCa,
        deny: suiteDeny,
        spec,
        spawn,
        log: (line) => seen.push(line),
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return { server, at: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    };
    const call = async (at: string, path: string, body: unknown) => {
      const response = await fetch(`${at}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      seen.push(text);
      return { status: response.status, text };
    };
    try {
      const real = await start(childSpawn(suiteChild, suiteIsolation));
      const failed =
        '{"outcome":"failed","failure":{"code":"connection_failed","attribution":"connector"}}';
      const source = httpSettings(api.port);
      expect((await call(real.at, '/v1/test', httpRequestFor(source, canary))).text).toBe(failed);
      // A run placing a value in the path, the query and a header: refused, and nothing composed
      // of it answered.
      const template = get(['echo'], {
        path: [{ fixed: 'echo' }, { parameter: 'site' }],
        query: [{ name: 'site', value: { parameter: 'site' } }],
        headers: [{ name: 'x-site', value: { parameter: 'site' } }],
      });
      const definition = httpDraft(template, [member('method', { base: 'text' })], {
        parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }],
        format: { kind: 'json', rows: '/items' },
      });
      expect(
        (
          await call(
            real.at,
            '/v1/run',
            httpRunRequest(source, canary, definition, { site: placed }),
          )
        ).text,
      ).toBe(failed);
      expect(
        (
          await call(
            real.at,
            '/v1/describe',
            httpDescribeRequest(
              source,
              canary,
              template,
              { kind: 'json', rows: '/items' },
              definition.parameters,
              { site: placed },
            ),
          )
        ).text,
      ).toBe('{"failure":{"code":"connection_failed","attribution":"connector"}}');
      // The right key, so the run is answered: what it ran is the template, never the URL.
      const ran = await call(
        real.at,
        '/v1/run',
        httpRunRequest(source, DEV_KEY, definition, { site: placed }),
      );
      expect(JSON.parse(ran.text)).toMatchObject({ outcome: 'ok', ran: { request: template } });
      // Not vacuous: the source received the value where it was placed.
      expect(api.seen.some((each) => each.rawPath.includes(encodeURIComponent(placed)))).toBe(true);
      // A seal refused, and one taken.
      expect(
        await call(real.at, '/v1/seal', {
          tenant: 'Not A Tenant',
          connection: randomUUID(),
          secret: canary,
          settings: source,
        }),
      ).toEqual({ status: 400, text: '{"code":"request_invalid"}' });
      expect(
        (
          await call(real.at, '/v1/seal', {
            tenant: 'acme',
            connection: randomUUID(),
            secret: canary,
            settings: source,
          })
        ).status,
      ).toBe(200);
      await new Promise<void>((resolve) => real.server.close(() => resolve()));

      // A child that sends the secret, then throws an error naming it and the URL it composed.
      const crashing = await start({
        file: process.execPath,
        args: [
          '--import',
          'tsx',
          fileURLToPath(new URL('./testing/throwing-http-child.ts', import.meta.url)),
        ],
        env: {},
      });
      expect((await call(crashing.at, '/v1/test', httpRequestFor(source, canary))).text).toBe(
        '{"outcome":"failed","failure":{"code":"connector_error","attribution":"connector"}}',
      );
      await new Promise<void>((resolve) => crashing.server.close(() => resolve()));
      // Not vacuous: the crash wrote the secret and the URL, and the supervisor dropped them.
      expect(stderr.join('')).toContain(canary);
      expect(stderr.join('')).toContain(url);
      for (const text of seen) {
        expect(text).not.toContain(url);
        expect(text).not.toContain(`127.0.0.1:${api.port}`);
        // The ok run's answer is the one that names the value: as the template's parameter, not it.
        for (const encoding of looked) expect(text).not.toContain(encoding);
      }
    } finally {
      await api.close();
    }
  });

  it("DAT-005 keeps an S3 connection's key pair, its signatures and every composed URL out of every answer, log line and crash report, raw, URL-encoded or base64", async () => {
    // The fake store refuses an object under `refused/`, and answers any other as one CSV row.
    const store = await startFakeStore((request) =>
      (request.url ?? '').includes('/refused/')
        ? { status: 403, body: '<Error><Code>AccessDenied</Code></Error>' }
        : { body: 'site\nNorth weir\n' },
    );
    const pair = { accessKeyId: 'source-s3-reader', secretAccessKey: 'Canary+Secret/9=-7f3a' };
    const placed = 'Placed+Value=9-2c1d';
    const looked = [pair.secretAccessKey, keyPairText(pair)].flatMap((each) => [
      each,
      encodeURIComponent(each),
      Buffer.from(each, 'utf8').toString('base64'),
      Buffer.from(each, 'utf8').toString('base64url'),
    ]);
    const seen: string[] = [];
    const stderr: string[] = [];
    const spawn: SpawnChild = (spec, input, deadlineMs, onStderr) =>
      runChild(spec, input, deadlineMs, (chunk) => {
        stderr.push(chunk.toString('utf8'));
        onStderr?.(chunk);
      });
    const withCa = loadConnectorConfig(
      {
        CONNECTOR_KEY: KEY,
        CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
        CONNECTOR_DENY: 'none',
        CONNECTOR_CA_FILE: 'ca.pem',
      },
      () => SOURCES_CA,
    );
    const start = async (spec: ChildSpec) => {
      const server = createConnectorServer({
        config: withCa,
        deny: suiteDeny,
        spec,
        spawn,
        log: (line) => seen.push(line),
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return { server, at: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    };
    const call = async (at: string, path: string, body: unknown) => {
      const response = await fetch(`${at}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      seen.push(text);
      return { status: response.status, text };
    };
    const source = s3Settings(store.port);
    const composed = [`https://127.0.0.1:${store.port}`, `127.0.0.1:${store.port}`];
    try {
      const real = await start(childSpawn(suiteChild, suiteIsolation));
      const definition = fileDraft(
        [{ fixed: 'echo' }, { parameter: 'site' }],
        [field('site', { base: 'text' })],
        { parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }] },
      );
      const refused = fileDraft([{ fixed: 'refused' }, { parameter: 'site' }], definition.columns, {
        parameters: definition.parameters,
      });
      expect(
        (await call(real.at, '/v1/run', s3RunRequest(source, refused, { site: placed }, { pair })))
          .text,
      ).toBe(
        '{"outcome":"failed","failure":{"code":"connection_failed","attribution":"connector"}}',
      );
      // Answered: what it read is the bucket and the key, never the URL it was read at.
      const ran = await call(
        real.at,
        '/v1/run',
        s3RunRequest(source, definition, { site: placed }, { pair }),
      );
      expect(JSON.parse(ran.text)).toMatchObject({
        outcome: 'ok',
        ran: { object: { bucket: 'alloy-readings', key: `echo/${placed}` } },
      });
      expect(
        (
          await call(
            real.at,
            '/v1/describe',
            s3DescribeRequest(
              source,
              refused.fetch.kind === 'file' ? refused.fetch.key : [],
              CSV,
              [...definition.parameters],
              { site: placed },
            ),
          )
        ).status,
      ).toBe(200);
      // A seal of something not a key pair refused, and of a key pair taken.
      expect(
        await call(real.at, '/v1/seal', {
          tenant: 'acme',
          connection: randomUUID(),
          secret: pair.secretAccessKey,
          settings: source,
        }),
      ).toEqual({ status: 400, text: '{"code":"request_invalid"}' });
      expect(
        (
          await call(real.at, '/v1/seal', {
            tenant: 'acme',
            connection: randomUUID(),
            secret: keyPairText(pair),
            settings: source,
          })
        ).status,
      ).toBe(200);
      await new Promise<void>((resolve) => real.server.close(() => resolve()));

      // A child that sends the key pair, then throws an error naming it and the URL it composed.
      const crashing = await start({
        file: process.execPath,
        args: [
          '--import',
          'tsx',
          fileURLToPath(new URL('./testing/throwing-s3-child.ts', import.meta.url)),
        ],
        env: {},
      });
      expect((await call(crashing.at, '/v1/test', s3RequestFor(source, pair))).text).toBe(
        '{"outcome":"failed","failure":{"code":"connector_error","attribution":"connector"}}',
      );
      await new Promise<void>((resolve) => crashing.server.close(() => resolve()));
      // Not vacuous: the store saw signed requests, and the crash wrote the pair and the URL.
      const signatures = store.seen
        .map((each) => /Signature=([0-9a-f]{64})/.exec(String(each.headers.authorization))?.[1])
        .filter((each): each is string => each !== undefined);
      expect(signatures.length).toBeGreaterThanOrEqual(3);
      expect(stderr.join('')).toContain(pair.secretAccessKey);
      expect(stderr.join('')).toContain(composed[0]);
      for (const text of seen) {
        for (const each of [...looked, ...composed, ...signatures])
          expect(text).not.toContain(each);
      }
      // The store itself was never sent the secret: a signature is made of it, never it.
      for (const request of store.seen) {
        if (String(request.headers.authorization).startsWith('{')) continue;
        expect(JSON.stringify(request)).not.toContain(pair.secretAccessKey);
      }
    } finally {
      await store.close();
    }
  });
});
