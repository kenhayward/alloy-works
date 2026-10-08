import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { fileURLToPath } from 'node:url';

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
    const untrusting: ExchangePolicy = { ...policy(), ca: undefined } as unknown as ExchangePolicy;
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

  it('DAT-108 refuses a body longer than its Content-Length too, result_incomplete, the parser holding a body to its stated length', async () => {
    const certs = new URL('../../../deploy/sources/http/', import.meta.url);
    const server = createTlsServer(
      {
        key: readFileSync(fileURLToPath(new URL('server-key.pem', certs))),
        cert: readFileSync(fileURLToPath(new URL('server.pem', certs))),
      },
      (socket) => {
        socket.on('data', () => {
          // Ten bytes stated, twenty sent, then the connection closed.
          socket.end(
            'HTTP/1.1 200 OK\r\ncontent-length: 10\r\nconnection: close\r\n\r\n0123456789ABCDEFGHIJ',
          );
        });
      },
    );
    const port = await new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
    );
    try {
      const answered = await exchange({ ...asked('/v1/long'), port }, policy());
      expect(answered.ok ? answered.body.toString('latin1') : answered.failure.code).toBe(
        'result_incomplete',
      );
    } finally {
      server.close();
    }
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

  // ADR-0048: a source over plain http, reached through the same guard, deadline and limits.
  describe('over plain http', () => {
    let plain: Server;
    let port: number;
    beforeAll(async () => {
      plain = createHttpServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ count: 2 }));
      });
      await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
      port = (plain.address() as AddressInfo).port;
    });
    afterAll(async () => {
      await new Promise((resolve) => plain.close(resolve));
    });

    it('reads a response when the connection is not secure, and never dials a host the guard refuses', async () => {
      const answered = await exchange(asked('/v1/readings', { port, secure: false }), policy());
      expect(answered.ok && JSON.parse(answered.body.toString('utf8'))).toEqual({ count: 2 });
      // TLS asked of a plain server fails to reach; plain asked of a TLS one, likewise.
      expect(code(await exchange(asked('/v1/readings', { port }), policy()))).toBe(
        'connection_failed',
      );
      expect(
        code(await exchange(asked('/v1/readings', { secure: false }), policy())),
      ).not.toBe('ok');
      // Loopback denied, as in production: refused before anything is dialled.
      expect(
        code(
          await exchange(
            asked('/v1/readings', { port, secure: false }),
            policy({ deny: ['127.0.0.0/8'] }),
          ),
        ),
      ).toBe('connection_failed');
    });
  });
});
