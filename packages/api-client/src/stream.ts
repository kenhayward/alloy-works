/**
 * Follows an environment's stream. Written with `fetch` rather than `EventSource`, because Node has
 * none and the same reader has to serve the renderer and the end-to-end suite. Reconnection is ours
 * for the same reason, and waits a random extra moment so that a crowd whose service restarted does
 * not come back all at once (ADR-0018).
 */
export interface StreamSnapshot {
  readonly samples: readonly { readonly id: string; readonly state: string }[];
}

export interface StreamSample {
  readonly kind: string;
  readonly id: string;
  readonly state: string;
}

export interface FollowOptions {
  readonly url: string;
  readonly onSnapshot: (snapshot: StreamSnapshot) => void;
  readonly onSample: (sample: StreamSample) => void;
  readonly onError?: (error: unknown) => void;
  /** How long to wait before coming back; the stream's own `retry` overrides it. */
  readonly retryMs?: number;
  readonly fetch?: typeof fetch;
}

export function followStream(options: FollowOptions): () => void {
  const request = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  let stopped = false;
  let retryMs = options.retryMs ?? 5000;

  const handle = (frame: string) => {
    if (frame.startsWith(':')) return;
    const retry = /^retry: (\d+)$/m.exec(frame)?.[1];
    if (retry) retryMs = Number(retry);
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    if (!event || !data) return;
    const parsed: unknown = JSON.parse(data);
    if (event === 'snapshot') options.onSnapshot(parsed as StreamSnapshot);
    if (event === 'sample') options.onSample(parsed as StreamSample);
  };

  async function follow(): Promise<void> {
    while (!stopped) {
      try {
        const response = await request(options.url, {
          headers: { accept: 'text/event-stream' },
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok || !response.body)
          throw new Error(`the stream answered ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            handle(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (error) {
        if (stopped) return;
        options.onError?.(error);
      }
      if (stopped) return;
      await new Promise((resolve) => setTimeout(resolve, retryMs + Math.random() * retryMs));
    }
  }

  void follow();
  return () => {
    stopped = true;
    controller.abort();
  };
}
