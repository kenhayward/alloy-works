import { randomBytes } from 'node:crypto';
import { sealSecret } from '@alloy-works/db';
import {
  BindingRefused,
  RUN_REQUEST_MAX_BYTES,
  bindFetch,
  type Parameter,
  type Query,
  type DescribeAnswer,
  type DescribeSqlAnswer,
  type RunAnswer,
  type TestAnswer,
} from '@alloy-works/domain';

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
  /** Where set, a run's answer by what it was sent, in place of `run`. */
  runFor?: ((body: { readonly values: Record<string, unknown> }) => RunAnswer) | undefined;
  /** Where set, a test and a describe wait for it before answering: a source that is slow. */
  hold?: Promise<void> | undefined;
  /** Where set, each run takes this long to answer: how many it answers at once is counted. */
  runMs?: number | undefined;
  /** How many runs it was answering at once, at most, since this was last set to 0. */
  mostRunning: number;
  /** Where set, a seal waits for it before answering: a connector that is slow to seal. */
  sealHold?: Promise<void> | undefined;
}

export function fakeConnector(): FakeConnector {
  const sealingKey = randomBytes(32);
  let running = 0;
  const fake: FakeConnector = {
    asked: [],
    mode: 'answer',
    test: { outcome: 'ok', findings: [] },
    describe: { relations: [], truncated: false, leftOut: { relations: 0, columns: 0 } },
    describeSql: { columns: [], parameters: [] },
    run: { outcome: 'failed', failure: { code: 'connector_error', attribution: 'connector' } },
    mostRunning: 0,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      // A run's and a describe's body are held to the real connector's limit, as its door holds them.
      if (
        (path === '/v1/run' || path === '/v1/describe') &&
        Buffer.byteLength(String(init?.body ?? ''), 'utf8') > RUN_REQUEST_MAX_BYTES
      ) {
        return new Response(null, { status: 413 });
      }
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
        // A built query is described as SQL is (D4-Q), its shape generated through the one function
        // the real connector binds by, so a tree it could not generate is answered as the real one does.
        if ('builder' in body) {
          const builder = body.builder as { query: Query; parameters: Parameter[] };
          try {
            bindFetch(
              {
                parameters: builder.parameters,
                fetch: { kind: 'builder', format: 1, query: builder.query },
                columns: [],
                order: 'multiset',
              },
              {},
              'shape',
            );
          } catch (error) {
            if (!(error instanceof BindingRefused)) throw error;
            return Response.json({
              failure: { code: 'definition_unbindable', attribution: 'query' },
            });
          }
          return Response.json(fake.describeSql);
        }
        return Response.json('sql' in body ? fake.describeSql : fake.describe);
      }
      if (path === '/v1/run') {
        running += 1;
        fake.mostRunning = Math.max(fake.mostRunning, running);
        try {
          if (fake.runMs !== undefined) {
            await new Promise((settle) => setTimeout(settle, fake.runMs));
          }
          return Response.json(
            fake.runFor ? fake.runFor(body as { values: Record<string, unknown> }) : fake.run,
          );
        } finally {
          running -= 1;
        }
      }
      return new Response(null, { status: 404 });
    }) as typeof globalThis.fetch,
  };
  return fake;
}
