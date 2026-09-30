import type { AddressInfo } from 'node:net';

import {
  connectionTarget,
  credentialContext,
  DEFINITION_MAX_BYTES,
  RUN_REQUEST_MAX_BYTES,
  SEALED,
} from '@alloy-works/domain';
import { openSecret } from '@alloy-works/sealing';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConnectorConfig } from './config.js';
import { createConnectorServer } from './server.js';
import { childSpawn, type ChildSpec } from './supervisor.js';
import {
  column,
  describeSqlRequest,
  draft,
  PASSWORDS,
  requestFor,
  runRequest,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';

const KEY = Buffer.alloc(32, 3).toString('base64');
const config = loadConnectorConfig({
  CONNECTOR_KEY: KEY,
  CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
  CONNECTOR_DENY: 'none',
  CONNECTOR_HOST: '127.0.0.1',
});

const hanging: ChildSpec = {
  file: process.execPath,
  args: ['-e', 'setInterval(() => {}, 1000)'],
  env: {},
};

describe("the connector's interface", () => {
  const servers: ReturnType<typeof createConnectorServer>[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function started(
    options: Partial<Parameters<typeof createConnectorServer>[0]> = {},
  ): Promise<{ url: string; lines: string[] }> {
    const lines: string[] = [];
    const server = createConnectorServer({
      config,
      deny: suiteDeny,
      spec: childSpawn(suiteChild, suiteIsolation),
      log: (line) => lines.push(line),
      ...options,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, lines };
  }

  const post = (url: string, path: string, body: unknown, key: string | null = KEY) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key === null ? {} : { authorization: `Bearer ${key}` }),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it("seals a secret to a value SEALED matches, which opens only with the connector's key, the tenant's id, the connection's id and its target", async () => {
    const { url } = await started();
    const connection = '5c1d0c6e-8f9a-4b1e-9d6a-3f2b7c4e5a10';
    const response = await post(url, '/v1/seal', {
      tenant: 'acme',
      connection,
      secret: 'an-invented-password',
      settings: settings(),
    });
    expect(response.status).toBe(200);
    const { sealed } = (await response.json()) as { sealed: string };
    expect(sealed).toMatch(SEALED);
    const target = credentialContext(connection, settings());
    // Not for another connection with the same target, which a copied row would claim to be.
    expect(() =>
      openSecret(
        SEALING_KEY,
        'source-credential',
        'acme',
        sealed,
        credentialContext('0b8f3a2c-1d4e-4f5a-8b6c-7d9e0f1a2b3c', settings()),
      ),
    ).toThrow();
    expect(() =>
      openSecret(SEALING_KEY, 'source-credential', 'acme', sealed, connectionTarget(settings())),
    ).toThrow();
    expect(openSecret(SEALING_KEY, 'source-credential', 'acme', sealed, target)).toBe(
      'an-invented-password',
    );
    expect(() => openSecret(SEALING_KEY, 'source-credential', 'acmedev', sealed, target)).toThrow();
    expect(() =>
      openSecret(Buffer.alloc(32, 4), 'source-credential', 'acme', sealed, target),
    ).toThrow();
    expect(() => openSecret(SEALING_KEY, 'sign-in', 'acme', sealed, target)).toThrow();
    // Not for the connection pointed anywhere else, and not for no target at all.
    expect(() => openSecret(SEALING_KEY, 'source-credential', 'acme', sealed)).toThrow();
    for (const moved of [
      settings({ host: 'elsewhere.example' }),
      settings({ port: 6543 }),
      settings({ database: 'other' }),
      settings({ account: 'writer' }),
      settings({ tls: 'verifyFull' }),
    ]) {
      expect(() =>
        openSecret(
          SEALING_KEY,
          'source-credential',
          'acme',
          sealed,
          credentialContext(connection, moved),
        ),
      ).toThrow();
    }
  });

  it('answers a request without the key, or with another, 401 and no body', async () => {
    const { url } = await started();
    for (const key of [null, Buffer.alloc(32, 5).toString('base64'), `${KEY}x`, '']) {
      for (const path of ['/v1/seal', '/v1/test', '/v1/describe']) {
        const response = await post(url, path, { tenant: 'acme', secret: 'x' }, key);
        expect(response.status, `${path} ${key}`).toBe(401);
        expect(await response.text(), `${path} ${key}`).toBe('');
      }
    }
    const basic = await fetch(`${url}/v1/seal`, {
      method: 'POST',
      headers: { authorization: `Basic ${KEY}` },
      body: '{}',
    });
    expect(basic.status).toBe(401);
  });

  it('answers a body over 64 KiB 413, a malformed request 400, and anything else 404', async () => {
    const { url } = await started();
    const large = await post(url, '/v1/seal', { tenant: 'acme', secret: 'x'.repeat(65 * 1024) });
    expect(large.status).toBe(413);
    for (const body of ['not json', { tenant: 'Acme', secret: 'x' }, { tenant: 'acme' }]) {
      const response = await post(url, '/v1/seal', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ code: 'request_invalid' });
    }
    const test = await post(url, '/v1/test', { ...requestFor(settings(), 'x'), deadlineMs: 5 });
    expect(test.status).toBe(400);
    expect((await post(url, '/v1/nothing', {})).status).toBe(404);
    expect((await fetch(`${url}/v1/seal`)).status).toBe(404);
  });

  it('takes a run and a SQL describe of up to 1 MiB and 64 KiB, a seal or a test of up to 64 KiB, and refuses a statement that does not lex 400', async () => {
    const { url } = await started();
    const id = column('id', { base: 'integer' });
    // Nearly 100,000 characters of SQL, over 64 KiB and under 256 KiB, are a run's and a describe's.
    const long = `select id from sample.site /* ${'x'.repeat(99_000)} */ order by id`;
    const ran = await post(
      url,
      '/v1/run',
      runRequest(settings(), PASSWORDS.reader, draft(long, [id])),
    );
    expect(ran.status).toBe(200);
    expect(await ran.json()).toMatchObject({ outcome: 'ok', rowCount: 3 });
    const described = await post(
      url,
      '/v1/describe',
      describeSqlRequest(settings(), PASSWORDS.reader, long),
    );
    expect(described.status).toBe(200);
    expect(await described.json()).toEqual({
      columns: [{ name: 'id', sourceType: 'integer', proposed: { base: 'integer' } }],
      parameters: [],
    });
    // A definition at its size bound, with a value, is a run's too.
    const values: string[] = [];
    const bounded = () =>
      draft('select id from sample.site where {{label}} is not null order by id', [id], {
        parameters: [
          {
            name: 'label',
            type: { base: 'text' },
            required: true,
            list: false,
            permitted: { values },
          },
        ],
      });
    const request = () =>
      runRequest(settings(), PASSWORDS.reader, bounded(), { label: values[0] ?? '' });
    const bytes = () => Buffer.byteLength(JSON.stringify(request().definition));
    for (;;) {
      values.push(`${values.length}${'一'.repeat(980)}`);
      if (bytes() > DEFINITION_MAX_BYTES - 16) break;
    }
    values.pop();
    values.push(`${values.length}`);
    const left = DEFINITION_MAX_BYTES - bytes();
    values[values.length - 1] += '一'.repeat(Math.floor(left / 3)) + 'a'.repeat(left % 3);
    expect(bytes()).toBe(DEFINITION_MAX_BYTES);
    const atBound = await post(url, '/v1/run', request());
    expect(atBound.status).toBe(200);
    expect(await atBound.json()).toMatchObject({ outcome: 'ok', rowCount: 3 });
    const huge = `select 1 /* ${'x'.repeat(RUN_REQUEST_MAX_BYTES)} */`;
    expect(
      (await post(url, '/v1/run', runRequest(settings(), 'x', draft(huge, [id])))).status,
    ).toBe(413);
    const sealed = await post(url, '/v1/test', {
      ...requestFor(settings(), 'x'),
      pad: 'x'.repeat(65 * 1024),
    });
    expect(sealed.status).toBe(413);
    for (const text of ["select 'open", 'select {{nothing}}']) {
      const refused = await post(url, '/v1/describe', describeSqlRequest(settings(), 'x', text));
      expect(refused.status, text).toBe(400);
      expect(await refused.json()).toEqual({ code: 'request_invalid' });
    }
  });

  it('answers health to anybody, and logs none of it: a probe every two seconds is no request', async () => {
    const { url, lines } = await started();
    for (let probe = 0; probe < 3; probe += 1) {
      const response = await fetch(`${url}/v1/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
    // A request that is not a probe is still logged, after it.
    await fetch(`${url}/v1/nothing`, { method: 'POST', body: '{}' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lines.map((line) => (JSON.parse(line) as { path: string }).path)).toEqual([
      '/v1/nothing',
    ]);
  });

  it('tests and describes through a child, and logs one line a request with neither body nor answer', async () => {
    const { url, lines } = await started();
    const tested = await post(url, '/v1/test', requestFor(settings(), PASSWORDS.reader));
    expect(tested.status).toBe(200);
    expect(await tested.json()).toEqual({ outcome: 'ok', findings: [] });
    const described = await post(url, '/v1/describe', requestFor(settings(), PASSWORDS.reader));
    expect(described.status).toBe(200);
    expect(((await described.json()) as { relations: unknown[] }).relations).toHaveLength(5);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(
        ['at', 'method', 'ms', 'path', 'status', 'stderrBytes'].sort(),
      );
    }
  });

  it('answers a ninth request at a cap of eight 503 connector_busy', async () => {
    const { url } = await started({ spec: hanging });
    const running = Array.from({ length: 8 }, () =>
      post(url, '/v1/test', requestFor(settings(), 'x', 1000)),
    );
    // Let the eight arrive before the ninth.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const ninth = await post(url, '/v1/test', requestFor(settings(), 'x', 1000));
    expect(ninth.status).toBe(503);
    expect(await ninth.json()).toEqual({ code: 'connector_busy' });
    for (const response of await Promise.all(running)) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        outcome: 'failed',
        failure: { code: 'timeout', attribution: 'connector' },
      });
    }
  });
});
