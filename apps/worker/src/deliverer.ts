import {
  deliverAnswerSchema,
  DELIVERY_DEADLINE_MS,
  type DeliverAnswer,
  type DeliverRequest,
} from '@alloy-works/domain';

/**
 * The worker's way to deliver a webhook (the WB plan, WB-F): `POST /v1/deliver`, with the deliver-only
 * key, which opens nothing else. The request carries the subscription's sealed secrets, so the worker
 * never holds one; `busy` where the connector is full, which is no attempt.
 */
export type Deliverer = (request: DeliverRequest) => Promise<DeliverAnswer | 'busy'>;

/** The most a delivery's answer may be: its status, latency and 2 KiB of reply, as JSON. */
const ANSWER_MOST = 16 * 1024;

export function connectorDeliverer(options: {
  readonly url: string;
  readonly key: string;
  readonly fetch?: typeof fetch;
}): Deliverer {
  const base = options.url.replace(/\/+$/, '');
  const fetching = options.fetch ?? fetch;
  const failed = (code: 'connector_error'): DeliverAnswer => ({
    type: 'failed',
    code,
    latencyMs: 0,
  });
  return async (request) => {
    let response: Response;
    try {
      response = await fetching(`${base}/v1/deliver`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(DELIVERY_DEADLINE_MS + 5000),
      });
    } catch {
      return 'busy';
    }
    if (response.status === 503) return 'busy';
    if (!response.ok) return failed('connector_error');
    let text: string;
    try {
      text = await response.text();
    } catch {
      return 'busy';
    }
    if (text.length > ANSWER_MOST) return failed('connector_error');
    try {
      const parsed = deliverAnswerSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      // Not an answer.
    }
    return failed('connector_error');
  };
}
