/** Reading a Server-Sent Events stream frame by frame, for the stream's tests. */

export interface Frame {
  readonly event: string;
  readonly data: unknown;
}

/**
 * A stream, read frame by frame. Tests wait for the frame they expect rather than for a length of
 * time: a machine busier than this one takes longer to connect, and a sleep would race it.
 */
export function openStream(url: string, cookie: string) {
  const controller = new AbortController();
  const arrived: Frame[] = [];
  const waiting: ((frame: Frame) => void)[] = [];
  let finished = () => {};
  /** Settles when the service ends the stream. */
  const ended = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const deliver = (frame: Frame) => {
    const next = waiting.shift();
    if (next) next(frame);
    else arrived.push(frame);
  };

  const response = fetch(url, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });

  void response
    .then(async (answer) => {
      if (!answer.body) return;
      const reader = answer.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          finished();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (event && data) deliver({ event, data: JSON.parse(data) });
          boundary = buffer.indexOf('\n\n');
        }
      }
    })
    .catch(() => {
      // The test closes the stream when it is done, which ends the read.
    });

  return {
    response,
    ended,
    next: (within = 10_000) =>
      new Promise<Frame>((resolve, reject) => {
        const held = arrived.shift();
        if (held) {
          resolve(held);
          return;
        }
        const timer = setTimeout(() => reject(new Error(`no frame within ${within}ms`)), within);
        waiting.push((frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
      }),
    close: () => controller.abort(),
  };
}
