import { randomBytes } from 'node:crypto';
import { sealSecret } from '@alloy-works/db';
import type { DescribeAnswer, DescribeSqlAnswer, RunAnswer, TestAnswer } from '@alloy-works/domain';

/** The key a harness's service presents to its fake connector: invented, and made afresh. */
export const FAKE_CONNECTOR_KEY = randomBytes(32).toString('base64');

/**
 * A hand-written connector for the service's suites, answered through `fetch`: it seals as the real
 * one does, with a key of its own the service never holds, and answers a test, a describe, a SQL
 * describe and a run as a test tells it to - or fails in one of the ways a real one can: unreachable, full, broken or talking
 * nonsense.
 */
export interface FakeConnector {
  readonly fetch: typeof globalThis.fetch;
  /** Every request it was sent, in order: its path and its parsed body. */
  readonly asked: { readonly path: string; readonly body: unknown }[];
  /** What the next requests meet. */
  mode: 'answer' | 'unreachable' | 'busy' | 'broken' | 'nonsense';
  test: TestAnswer;
  describe: DescribeAnswer;
  /** A describe sent a statement (D2-G). */
  describeSql: DescribeSqlAnswer;
  /** A run (D2-I). */
  run: RunAnswer;
  /** Where set, a test and a describe wait for it before answering: a source that is slow. */
  hold?: Promise<void> | undefined;
  /** Where set, a seal waits for it before answering: a connector that is slow to seal. */
  sealHold?: Promise<void> | undefined;
}

export function fakeConnector(): FakeConnector {
  const sealingKey = randomBytes(32);
  const fake: FakeConnector = {
    asked: [],
    mode: 'answer',
    test: { outcome: 'ok', findings: [] },
    describe: { relations: [], truncated: false, leftOut: { relations: 0, columns: 0 } },
    describeSql: { columns: [], parameters: [] },
    run: { outcome: 'failed', failure: { code: 'connector_error', attribution: 'connector' } },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body ?? 'null')) as Record<string, unknown>;
      if (new Headers(init?.headers).get('authorization') !== `Bearer ${FAKE_CONNECTOR_KEY}`) {
        return new Response(null, { status: 401 });
      }
      switch (fake.mode) {
        case 'unreachable':
          throw new TypeError('fetch failed');
        case 'busy':
          return Response.json({ code: 'connector_busy' }, { status: 503 });
        case 'broken':
          return new Response(null, { status: 500 });
        case 'nonsense':
          return new Response('<html>', { status: 200 });
      }
      fake.asked.push({ path, body });
      if (path === '/v1/seal' && fake.sealHold) await fake.sealHold;
      if (path === '/v1/seal') {
        return Response.json({
          sealed: sealSecret(
            sealingKey,
            'source-credential',
            String(body.tenant),
            String(body.secret),
          ),
        });
      }
      if (path !== '/v1/seal' && fake.hold) await fake.hold;
      if (path === '/v1/test') return Response.json(fake.test);
      if (path === '/v1/describe') {
        return Response.json('sql' in body ? fake.describeSql : fake.describe);
      }
      if (path === '/v1/run') return Response.json(fake.run);
      return new Response(null, { status: 404 });
    }) as typeof globalThis.fetch,
  };
  return fake;
}
