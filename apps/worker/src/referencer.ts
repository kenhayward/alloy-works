import {
  referenceAnswerSchema,
  type ReferenceAnswer,
  type ReferenceRequest,
} from '@alloy-works/domain';

/**
 * The worker's way to re-check an entry (the XR plan, XR-B, XR-E): `POST /v1/reference`, with the
 * reference-only key, which opens a `check` and nothing else. `busy` where the connector is full or
 * cannot be reached, which is no check.
 */
export type Referencer = (request: ReferenceRequest) => Promise<ReferenceAnswer | 'busy'>;

/** How long a check may take: its fifteen seconds, a child's start, and the way there. */
const CHECK_MS = 20_000;
/** The most a check's answer may be: one record's CSL and its notices, as JSON. */
const ANSWER_MOST = 256 * 1024;

export function connectorReferencer(options: {
  readonly url: string;
  readonly key: string;
  readonly fetch?: typeof fetch;
}): Referencer {
  const base = options.url.replace(/\/+$/, '');
  const fetching = options.fetch ?? fetch;
  return async (request) => {
    let text: string;
    try {
      const response = await fetching(`${base}/v1/reference`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(CHECK_MS),
      });
      if (!response.ok) return 'busy';
      text = await response.text();
    } catch {
      return 'busy';
    }
    if (text.length > ANSWER_MOST) return 'busy';
    try {
      const parsed = referenceAnswerSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      // Not an answer.
    }
    return 'busy';
  };
}
