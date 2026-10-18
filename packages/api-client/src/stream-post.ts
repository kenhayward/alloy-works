/**
 * A request answered as Server-Sent Events (the G2 plan, G2-K): the assistant's run. Written with
 * `fetch`, as `followStream` is, but never retried - a retry would ask the model again, and be paid
 * for again - and a refusal before the stream answered as the JSON body it is.
 */
export interface StreamPostOptions {
  readonly url: string;
  readonly body: unknown;
  /** Every frame, by its event's name, as it arrives. */
  readonly onEvent: (event: string, data: unknown) => void;
  /** Aborted, the request closes, and the service ends what it was doing for it. */
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
}

/** How the request ended: streamed to its end, refused before it began, or failed on the way. */
export type StreamPostOutcome =
  | { readonly kind: 'streamed' }
  | { readonly kind: 'refused'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'failed' }
  | { readonly kind: 'stopped' };

export async function streamPost(options: StreamPostOptions): Promise<StreamPostOutcome> {
  const request = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await request(options.url, {
      method: 'POST',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(options.body),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    return options.signal?.aborted ? { kind: 'stopped' } : { kind: 'failed' };
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A refusal with no body of ours says only its status.
    }
    return { kind: 'refused', status: response.status, body };
  }
  if (!response.body) return { kind: 'failed' };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let end = buffered.indexOf('\n\n');
      while (end !== -1) {
        const frame = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        end = buffered.indexOf('\n\n');
        if (frame.startsWith(':')) continue;
        const event = /^event: ([^\n]+)/m.exec(frame)?.[1];
        const data = /^data: ([^\n]+)/m.exec(frame)?.[1];
        if (event && data) options.onEvent(event, JSON.parse(data) as unknown);
      }
    }
  } catch {
    return options.signal?.aborted ? { kind: 'stopped' } : { kind: 'failed' };
  }
  return { kind: 'streamed' };
}
