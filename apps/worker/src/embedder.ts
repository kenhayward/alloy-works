import {
  EMBED_ANSWER_MAX_BYTES,
  embedAnswerSchema,
  type EmbedAnswer,
  type EmbedRequest,
} from '@alloy-works/domain';

/**
 * The worker's one way to the connector (the G7 plan, G7-E): `POST /v1/embed`, with the embed-only
 * key, which opens nothing else. The request carries the endpoint's sealed key, so the worker never
 * holds the sealing key or a provider's.
 */
export type Embedder = (request: EmbedRequest) => Promise<EmbedAnswer>;

export function connectorEmbedder(options: {
  readonly url: string;
  readonly key: string;
  readonly fetch?: typeof fetch;
}): Embedder {
  const base = options.url.replace(/\/+$/, '');
  const fetching = options.fetch ?? fetch;
  return async (request) => {
    let response: Response;
    try {
      response = await fetching(`${base}/v1/embed`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(request.deadlineMs + 5000),
      });
    } catch {
      return { type: 'failed', failure: { code: 'connector_unavailable' } };
    }
    if (response.status === 503) return { type: 'failed', failure: { code: 'connector_busy' } };
    if (!response.ok) return { type: 'failed', failure: { code: 'connector_error' } };
    const text = await response.text();
    if (text.length > EMBED_ANSWER_MAX_BYTES) {
      return { type: 'failed', failure: { code: 'connector_error' } };
    }
    try {
      const parsed = embedAnswerSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      // Not an answer.
    }
    return { type: 'failed', failure: { code: 'connector_error' } };
  };
}
