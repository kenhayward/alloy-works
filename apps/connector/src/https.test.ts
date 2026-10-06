import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { exchange, statedDigests, type Exchange, type ExchangePolicy } from './https.js';
import { DEV_CA, DEV_KEY, localhost, startFakeApi, type FakeApi } from './testing/http.js';
import { suiteDeny } from './testing/source.js';

describe('the guarded HTTPS client', () => {
  let api: FakeApi;
  beforeAll(async () => {
    api = await startFakeApi();
  });
  afterAll(async () => {
    await api.close();
  });

  const asked = (path: string, over: Partial<Exchange> = {}): Exchange => ({
    host: 'localhost',
    port: api.port,
    path,
    method: 'GET',
    headers: [['x-api-key', DEV_KEY]],
    ...over,
  });
  const policy = (over: Partial<ExchangePolicy> = {}): ExchangePolicy => ({
    deny: suiteDeny,
    lookup: localhost,
    ca: DEV_CA,
    deadline: Date.now() + 10_000,
    connectTimeoutMs: 5000,
    maxBytes: 1024 * 1024,
    ...over,
  });
  const code = (outcome: Awaited<ReturnType<typeof exchange>>) =>
    outcome.ok ? 'ok' : outcome.failure.code;

  it('reads a response by the name it checked, its certificate the development CA', async () => {
    const answered = await exchange(asked('/v1/readings'), policy());
    expect(answered.ok && JSON.parse(answered.body.toString('utf8'))).toMatchObject({ count: 3 });
    // Gzip decoded, its digest taken over what was sent, as RFC 9530 says.
    const zipped = await exchange(asked('/v1/readings?gzip'), policy());
    expect(zipped.ok && JSON.parse(zipped.body.toString('utf8'))).toMatchObject({ count: 3 });
    // Without the CA the certificate is not trusted: refused as a failure to reach.
    const { ca: _ca, ...untrusting } = policy();
    expect(code(await exchange(asked('/v1/readings'), untrusting))).toBe('connection_failed');
  });

  it('DAT-109 stops a source trickling a byte a second at the deadline, timeout, and closes the socket', async () => {
    const started = Date.now();
    const before = await new Promise<number>((resolve) =>
      api.server.getConnections((_error, count) => resolve(count)),
    );
    const answered = await exchange(asked('/v1/trickle'), policy({ deadline: started + 2500 }));
    const took = Date.now() - started;
    expect(code(answered)).toBe('timeout');
    expect(took).toBeGreaterThanOrEqual(2400);
    expect(took).toBeLessThan(4000);
    // The socket is closed: the source holds no connection of the client's past it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = await new Promise<number>((resolve) =>
      api.server.getConnections((_error, count) => resolve(count)),
    );
    expect(after).toBeLessThanOrEqual(before);
  });

  it('DAT-110 refuses one string past the byte limit, and a gzip bomb, byte_limit, as they arrive', async () => {
    expect(
      code(await exchange(asked('/v1/big?bytes=2000000'), policy({ maxBytes: 1024 * 1024 }))),
    ).toBe('byte_limit');
    // 64 MiB of spaces gzip to about 64 KiB: past the limit only once decoded.
    const bomb = await exchange(asked('/v1/bomb?mb=64'), policy({ maxBytes: 1024 * 1024 }));
    expect(code(bomb)).toBe('byte_limit');
    expect(code(await exchange(asked('/v1/big?bytes=1000'), policy()))).toBe('ok');
  });

  it('DAT-108 refuses a body shorter than its Content-Length, or not its Content-Digest, result_incomplete', async () => {
    expect(code(await exchange(asked('/v1/short'), policy()))).toBe('result_incomplete');
    expect(code(await exchange(asked('/v1/digest-wrong'), policy()))).toBe('result_incomplete');
    expect(statedDigests('sha-256=:AAAA:, unknown=:BBBB:')?.size).toBe(1);
    expect(statedDigests('sha-256=AAAA')).toBeUndefined();
  });

  it('follows no redirect, and reads a 401 as a failure to reach; any other refusal is its status alone', async () => {
    expect(code(await exchange(asked('/v1/redirect'), policy()))).toBe('connection_failed');
    expect(code(await exchange(asked('/v1/readings', { headers: [] }), policy()))).toBe(
      'connection_failed',
    );
    const refused = await exchange(asked('/v1/status/503'), policy());
    expect(refused.ok ? undefined : refused.failure).toEqual({
      code: 'source_refused',
      attribution: 'query',
      status: 503,
    });
  });

  it('dials the address the guard checked, and never asks a resolver again', async () => {
    let asks = 0;
    // A rebinding resolver: the address checked first, a denied one after.
    const rebinding = async () => {
      asks += 1;
      return [{ address: asks === 1 ? '127.0.0.1' : '169.254.169.254', family: 4 }];
    };
    expect(code(await exchange(asked('/v1/readings'), policy({ lookup: rebinding })))).toBe('ok');
    expect(asks).toBe(1);
    // A name answering a denied address anywhere is refused before anything is dialled.
    const denied = async () => [
      { address: '127.0.0.1', family: 4 },
      { address: '::1', family: 6 },
    ];
    expect(code(await exchange(asked('/v1/readings'), policy({ lookup: denied })))).toBe(
      'connection_failed',
    );
  });

  it('reads no proxy from the environment', async () => {
    const saved = { ...process.env };
    // A proxy that does not exist: a client that read it could not reach the source.
    process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
    process.env.https_proxy = 'http://127.0.0.1:1';
    process.env.NODE_USE_ENV_PROXY = '1';
    try {
      expect(code(await exchange(asked('/v1/readings'), policy()))).toBe('ok');
    } finally {
      for (const name of ['HTTPS_PROXY', 'https_proxy', 'NODE_USE_ENV_PROXY']) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
  });
});
