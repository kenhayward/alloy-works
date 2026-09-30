import { randomUUID } from 'node:crypto';
import type { ConnectionSettings, TestRequest } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';
import { createConnectorClient } from './connector.js';

const KEY = 'aW52ZW50ZWQtY29ubmVjdG9yLWtleS1mb3ItdGVzdHMhIQ==';
const SEALED = `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(40)}`;
const SECRET = 'an-invented-canary-password';

const settings: ConnectionSettings = {
  schemaVersion: 1,
  name: 'Readings',
  description: '',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'readings',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
};

const request = (deadlineMs = 10_000): TestRequest => ({
  requestId: randomUUID(),
  tenant: 'acme1',
  connection: { id: randomUUID(), version: randomUUID() },
  settings,
  sealed: SEALED,
  deadlineMs,
});

type Asked = { url: string; init: RequestInit };

/** A fetch that answers every request with one response, and remembers what it was asked. */
function answering(status: number, body?: unknown) {
  const asked: Asked[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(url), init: init ?? {} });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { asked, fetch };
}

describe("the service's connector client", () => {
  it('seals a secret with the key in a header, and answers the sealed value it parsed', async () => {
    const { asked, fetch } = answering(200, { sealed: SEALED });
    const client = createConnectorClient({ url: 'http://connector:8090', key: KEY, fetch });
    expect(await client.seal('acme1', SECRET)).toEqual({ answer: { sealed: SEALED } });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe('http://connector:8090/v1/seal');
    expect(asked[0]!.init.method).toBe('POST');
    expect(new Headers(asked[0]!.init.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    // The secret travels in the body, never in the address.
    expect(asked[0]!.url).not.toContain(SECRET);
    expect(JSON.parse(String(asked[0]!.init.body))).toEqual({ tenant: 'acme1', secret: SECRET });
  });

  it('answers a test and a describe as the connector answered them, parsed', async () => {
    const tested = answering(200, { outcome: 'ok', findings: ['account_not_read_only'] });
    expect(
      await createConnectorClient({ url: 'http://c', key: KEY, fetch: tested.fetch }).test(
        request(),
      ),
    ).toEqual({ answer: { outcome: 'ok', findings: ['account_not_read_only'] } });
    expect(tested.asked[0]!.url).toBe('http://c/v1/test');
    const failed = answering(200, {
      failure: { code: 'connection_failed', attribution: 'connector' },
    });
    expect(
      await createConnectorClient({ url: 'http://c', key: KEY, fetch: failed.fetch }).describe(
        request(),
      ),
    ).toEqual({ answer: { failure: { code: 'connection_failed', attribution: 'connector' } } });
    expect(failed.asked[0]!.url).toBe('http://c/v1/describe');
  });

  it('answers a full connector as connector_busy, and anything else that is not an answer as connector_unavailable, with none of its words', async () => {
    const busy = answering(503, { code: 'connector_busy' });
    expect(
      await createConnectorClient({ url: 'http://c', key: KEY, fetch: busy.fetch }).test(request()),
    ).toEqual({ refused: { code: 'connector_busy', attribution: 'product' } });

    const unavailable = { refused: { code: 'connector_unavailable', attribution: 'product' } };
    const unreachable = (async () => {
      throw new TypeError(`fetch failed: ${SECRET}`);
    }) as typeof globalThis.fetch;
    for (const fetch of [
      unreachable,
      answering(500).fetch,
      answering(401).fetch,
      answering(400, { code: 'request_invalid' }).fetch,
      answering(200, { sealed: 'not a sealed value' }).fetch,
      answering(200, { outcome: 'maybe' }).fetch,
      (async () => new Response('<html>', { status: 200 })) as typeof globalThis.fetch,
    ]) {
      const client = createConnectorClient({ url: 'http://c', key: KEY, fetch });
      const answers = [
        await client.seal('acme1', SECRET),
        await client.test(request()),
        await client.describe(request()),
      ];
      for (const answer of answers) {
        expect(answer).toEqual(unavailable);
        expect(JSON.stringify(answer)).not.toContain(SECRET);
      }
    }
  });

  it('gives up on a request two seconds past its deadline, as connector_unavailable', async () => {
    let signal: AbortSignal | undefined;
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(signal!.reason));
      })) as unknown as typeof globalThis.fetch;
    const client = createConnectorClient({ url: 'http://c', key: KEY, fetch: hanging });
    const started = Date.now();
    expect(await client.test(request(1000))).toEqual({
      refused: { code: 'connector_unavailable', attribution: 'product' },
    });
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(2900);
    expect(took).toBeLessThan(6000);
    expect(signal?.aborted).toBe(true);
  }, 10_000);
});
