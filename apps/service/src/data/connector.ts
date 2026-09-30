import {
  CONNECTOR_ANSWER_MAX_BYTES,
  dataFailure,
  describeAnswerSchema,
  sealAnswerSchema,
  testAnswerSchema,
  type ConnectionSettings,
  type DataFailure,
  type DescribeAnswer,
  type DescribeRequest,
  type SealAnswer,
  type TestAnswer,
  type TestRequest,
} from '@alloy-works/domain';
import type { z } from 'zod';

/**
 * What the connector answered, or why there is no answer: it is full (`connector_busy`), or anything
 * else went wrong on the way - unreachable, a status that is not an answer, a body that does not
 * parse, no answer in time - which is `connector_unavailable` (the D1 plan, D1-Q). Never the error's
 * own words, which could carry what the request did.
 */
export type Answered<T> =
  | { readonly answer: T }
  | {
      readonly refused: DataFailure & {
        readonly code: 'connector_busy' | 'connector_unavailable';
      };
    };

export interface ConnectorClient {
  /**
   * Seals a secret for a tenant's connection, bound to that connection and to where these settings
   * sign in (DA-AF).
   */
  seal(
    tenant: string,
    connection: string,
    secret: string,
    settings: ConnectionSettings,
  ): Promise<Answered<SealAnswer>>;
  test(request: TestRequest): Promise<Answered<TestAnswer>>;
  describe(request: DescribeRequest): Promise<Answered<DescribeAnswer>>;
}

/**
 * How long a seal may take: it opens no source, and is answered in milliseconds, so it is asked in the
 * transaction its permission was decided in, and three seconds bounds a connector that hangs there.
 */
const SEAL_MS = 3_000;
/** How long past a request's own deadline the service waits before giving up on the connector. */
const SLACK_MS = 2_000;

type Refused = Extract<Answered<never>, { readonly refused: unknown }>;

const refusedFor = (code: 'connector_busy' | 'connector_unavailable'): Refused => ({
  refused: { code, attribution: dataFailure(code).attribution },
});

const unavailable = (): Refused => refusedFor('connector_unavailable');

/**
 * The service's client of the connector (the D1 plan, task 5): HTTP and JSON on `connector-private`,
 * the shared key in a header, every answer parsed by the protocol's own schema. The one module that
 * reaches the connector, imported by the connection routes alone (DAT-089).
 */
export function createConnectorClient(options: {
  readonly url: string;
  readonly key: string;
  readonly fetch?: typeof globalThis.fetch;
  /** The most of an answer read before it is given up on; the connector's own cap unless a test says. */
  readonly maxAnswerBytes?: number;
}): ConnectorClient {
  const send = options.fetch ?? globalThis.fetch;
  const maxAnswerBytes = options.maxAnswerBytes ?? CONNECTOR_ANSWER_MAX_BYTES;
  const base = options.url.replace(/\/+$/, '');

  async function ask<S extends z.ZodType>(
    path: string,
    body: unknown,
    schema: S,
    timeoutMs: number,
  ): Promise<Answered<z.infer<S>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await send(`${base}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await bounded(response, maxAnswerBytes, controller);
      if (text === undefined) return unavailable();
      if (response.status === 503) {
        const busy = safeJson(text) as { code?: unknown } | undefined;
        if (busy?.code === 'connector_busy') return refusedFor('connector_busy');
        return unavailable();
      }
      if (response.status !== 200) return unavailable();
      const parsed = schema.safeParse(safeJson(text));
      return parsed.success ? { answer: parsed.data as z.infer<S> } : unavailable();
    } catch {
      // Unreachable, refused, reset or given up on: said the same way, and none of it repeated.
      return unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    seal: (tenant, connection, secret, settings) =>
      ask('/v1/seal', { tenant, connection, secret, settings }, sealAnswerSchema, SEAL_MS),
    test: (request) => ask('/v1/test', request, testAnswerSchema, request.deadlineMs + SLACK_MS),
    describe: (request) =>
      ask('/v1/describe', request, describeAnswerSchema, request.deadlineMs + SLACK_MS),
  };
}

/**
 * A response's body as text, read no further than `max` bytes: past it the request is abandoned and
 * the answer is undefined, so a connector answering without end costs the service no more than that.
 */
async function bounded(
  response: Response,
  max: number,
  controller: AbortController,
): Promise<string | undefined> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > max) {
      controller.abort();
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
