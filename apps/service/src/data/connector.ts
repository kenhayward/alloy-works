import {
  CONNECTOR_ANSWER_MAX_BYTES,
  MODEL_ANSWER_MAX_BYTES,
  embedAnswerSchema,
  modelEventSchema,
  type EmbedAnswer,
  type EmbedRequest,
  type ModelEvent,
  type ModelRequest,
  type ModelSealRequest,
  dataFailure,
  describeAnswerSchema,
  describeSqlAnswerSchema,
  revisionAnswerSchema,
  runAnswerSchema,
  sealAnswerSchema,
  testAnswerSchema,
  type ConnectionSettings,
  type DataFailure,
  type DescribeAnswer,
  type DescribeRequest,
  type DescribeSqlAnswer,
  type DescribeSqlRequest,
  type RevisionAnswer,
  type RevisionRequest,
  type RunAnswer,
  type RunRequest,
  type SealAnswer,
  type TestAnswer,
  type TestRequest,
  type WebhookSealRequest,
  manifestAnswerSchema,
  type ManifestAnswer,
  type ManifestRequest,
  referenceAnswerSchema,
  type ReferenceAnswer,
  type ReferenceRequest,
  type ReferenceSealRequest,
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
  /*
   * Each request below is given up on where `signal` aborts - the caller's authority ended (IAM-082,
   * the D7 plan's D7-I) - which closes it, and the connector kills its child.
   */
  test(request: TestRequest, signal?: AbortSignal): Promise<Answered<TestAnswer>>;
  describe(request: DescribeRequest, signal?: AbortSignal): Promise<Answered<DescribeAnswer>>;
  /** A SQL statement's result columns, never run (D2-G). */
  describeSql(
    request: DescribeSqlRequest,
    signal?: AbortSignal,
  ): Promise<Answered<DescribeSqlAnswer>>;
  /** A definition run against values the service has checked (D2-I). */
  run(request: RunRequest, signal?: AbortSignal): Promise<Answered<RunAnswer>>;
  /** Whether a source moved since a revision, asked by the run a check would send (FR-D). */
  revision(request: RevisionRequest, signal?: AbortSignal): Promise<Answered<RevisionAnswer>>;
  /** Seals a model endpoint's key, bound to the endpoint and its origin (the G1 plan, G1-B). */
  sealModel(request: ModelSealRequest): Promise<Answered<SealAnswer>>;
  /** Seals a webhook's signing secret to its subscription and URL (the WB plan, WB-G). */
  sealWebhook(request: WebhookSealRequest): Promise<Answered<SealAnswer>>;
  /** Fetches an extension's manifest by its URL (the EX plan, EX-B). */
  manifest(request: ManifestRequest): Promise<Answered<ManifestAnswer>>;
  /** Asks a reference source by its id and an operation, never a URL (the XR plan, XR-B). */
  reference(request: ReferenceRequest): Promise<Answered<ReferenceAnswer>>;
  /** Seals a reference extension's secret to it and its endpoint (the XR plan, XR-J). */
  sealReference(request: ReferenceSealRequest): Promise<Answered<SealAnswer>>;
  /**
   * A model call (the G1 plan, G1-C): each event as the connector streams it, the last `ended` or
   * `failed`, which is also answered. A connector that cannot be reached, is full, or ends without a
   * last event answers its refusal; where `signal` aborts, the request is closed, and the call ends.
   */
  model(
    request: ModelRequest,
    onEvent: (event: ModelEvent) => void,
    signal?: AbortSignal,
  ): Promise<Answered<Extract<ModelEvent, { type: 'ended' | 'failed' }>>>;
  /** An embedding call (the G7 plan, G7-G): a search's words, embedded by the serving model. */
  embed(request: EmbedRequest, signal?: AbortSignal): Promise<Answered<EmbedAnswer>>;
}

/**
 * How long a seal may take: it opens no source, and is answered in milliseconds, so it is asked in the
 * transaction its permission was decided in, and three seconds bounds a connector that hangs there.
 */
/** How long a manifest's fetch may take: its ten seconds, a child's start, and the way there. */
const MANIFEST_MS = 15_000;
/** How long a reference call may take: its fifteen seconds, a child's start, and the way there. */
const REFERENCE_MS = 20_000;

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
 * reaches the connector, imported by the connection routes and the model endpoint routes alone
 * (DAT-089; the G1 plan, G1-L).
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
    signal?: AbortSignal,
  ): Promise<Answered<z.infer<S>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abandon = () => controller.abort();
    if (signal?.aborted) abandon();
    else signal?.addEventListener('abort', abandon, { once: true });
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
      signal?.removeEventListener('abort', abandon);
    }
  }

  return {
    seal: (tenant, connection, secret, settings) =>
      ask('/v1/seal', { tenant, connection, secret, settings }, sealAnswerSchema, SEAL_MS),
    test: (request, signal) =>
      ask('/v1/test', request, testAnswerSchema, request.deadlineMs + SLACK_MS, signal),
    describe: (request, signal) =>
      ask('/v1/describe', request, describeAnswerSchema, request.deadlineMs + SLACK_MS, signal),
    describeSql: (request, signal) =>
      ask('/v1/describe', request, describeSqlAnswerSchema, request.deadlineMs + SLACK_MS, signal),
    run: (request, signal) =>
      ask('/v1/run', request, runAnswerSchema, request.deadlineMs + SLACK_MS, signal),
    revision: (request, signal) =>
      ask('/v1/revision', request, revisionAnswerSchema, request.deadlineMs + SLACK_MS, signal),
    sealModel: (request) => ask('/v1/model/seal', request, sealAnswerSchema, SEAL_MS),
    sealWebhook: (request) => ask('/v1/webhook/seal', request, sealAnswerSchema, SEAL_MS),
    manifest: (request) => ask('/v1/manifest', request, manifestAnswerSchema, MANIFEST_MS),
    reference: (request) => ask('/v1/reference', request, referenceAnswerSchema, REFERENCE_MS),
    sealReference: (request) => ask('/v1/reference/seal', request, sealAnswerSchema, SEAL_MS),
    embed: (request, signal) =>
      ask('/v1/embed', request, embedAnswerSchema, request.deadlineMs + SLACK_MS, signal),
    model: async (request, onEvent, signal) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.deadlineMs + SLACK_MS);
      const abandon = () => controller.abort();
      if (signal?.aborted) abandon();
      else signal?.addEventListener('abort', abandon, { once: true });
      try {
        const response = await send(`${base}/v1/model`, {
          method: 'POST',
          headers: { authorization: `Bearer ${options.key}`, 'content-type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (response.status === 503) {
          const busy = safeJson((await bounded(response, 1024, controller)) ?? '') as
            { code?: unknown } | undefined;
          return busy?.code === 'connector_busy' ? refusedFor('connector_busy') : unavailable();
        }
        if (response.status !== 200 || !response.body) {
          await response.body?.cancel().catch(() => {});
          return unavailable();
        }
        // Read a line at a time, each an event, no more than the connector's own cap of them.
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let partial = '';
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MODEL_ANSWER_MAX_BYTES * 2) {
            controller.abort();
            return unavailable();
          }
          partial += decoder.decode(value, { stream: true });
          let newline = partial.indexOf('\n');
          while (newline !== -1) {
            const line = partial.slice(0, newline);
            partial = partial.slice(newline + 1);
            newline = partial.indexOf('\n');
            if (line === '') continue;
            const parsed = modelEventSchema.safeParse(safeJson(line));
            if (!parsed.success) {
              controller.abort();
              return unavailable();
            }
            onEvent(parsed.data);
            if (parsed.data.type === 'ended' || parsed.data.type === 'failed') {
              await reader.cancel().catch(() => {});
              return { answer: parsed.data };
            }
          }
        }
        return unavailable();
      } catch {
        return unavailable();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abandon);
      }
    },
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
