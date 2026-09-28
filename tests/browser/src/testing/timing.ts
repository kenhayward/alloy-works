import type { Page } from 'playwright-core';

/**
 * What a measured act waits for, answered by the page itself: each a condition on the state's own
 * content, so a measurement can never end on the screen before (the W13.2 review).
 *
 * - `open`: the outline's `nodes` tree items drawn, every one named - no component still waiting on
 *   the listing to be called by its title - and the paragraph of `node`'s text holding `words` shown
 *   in the first screen.
 * - `number`: the tree item for `node` described by `number`.
 * - `inView`: `node`'s heading in the text shown on the screen.
 */
export type Until =
  | { readonly kind: 'open'; readonly nodes: number; readonly node: string; readonly words: string }
  | { readonly kind: 'number'; readonly node: string; readonly number: string }
  | { readonly kind: 'inView'; readonly node: string };

/** When the act began, the condition first held, and the frame showing it was painted, in the page's clock. */
export interface Timed {
  readonly act: number;
  readonly held: number;
  readonly painted: number;
  /** Each request the act waited on: begun after the act and answered before the result was painted. */
  readonly requests: readonly {
    readonly name: string;
    readonly from: number;
    readonly to: number;
  }[];
}

/** One act measured: the whole time, the service's share of it, and the interface's, which is the rest. */
export interface Measured {
  readonly whole: number;
  readonly service: number;
  readonly interface: number;
  readonly requests: readonly { readonly name: string; readonly ms: number }[];
}

/**
 * Installed in the page before it loads (`page.addInitScript`), so the page itself says when an act
 * began and when its result was painted - never the test's polling, whose interval would be in every
 * sample (B-L).
 *
 * `arm` clears the resource timings and waits for the act: the next key other than a modifier or the
 * next pointer press, whose event's own time is the act's; or, for an act the page is told to make,
 * now. From then it asks the condition at every frame, before the frame is drawn; the first frame it
 * holds in is the one that shows the result, and the time is taken after that frame is painted, from a
 * message posted as the frame is drawn - which the page runs once the frame is done.
 */
export function instrument(): void {
  performance.setResourceTimingBufferSize(100_000);
  const labelOf = (item: Element) =>
    document.getElementById(item.getAttribute('aria-labelledby') ?? '')?.textContent ?? '';
  // On the screen and not under anything: the element, or something inside it, is what the page has
  // at a point in its first line.
  // What keeps it from being shown, or null where it is: the element, or something inside it, is what
  // the page has at a point in its first line - or, for a passage of text, in any of its lines.
  const unseen = (
    element: Element | null | undefined,
    what: string,
    lines: 'first' | 'any',
  ): string | null => {
    if (!element) return `${what} is not on the page`;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return `${what} has no size`;
    const x = rect.left + Math.min(rect.width / 2, 12);
    const ys =
      lines === 'first'
        ? [rect.top + Math.min(rect.height / 2, 8)]
        : Array.from({ length: Math.max(1, Math.floor(rect.height / 16)) }, (_, line) =>
            Math.min(rect.bottom - 1, rect.top + 8 + line * 16),
          );
    let said = `${what} is off the screen, at ${Math.round(rect.top)}`;
    for (const y of ys) {
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      const there = document.elementFromPoint(x, y);
      if (there !== null && element.contains(there)) return null;
      said = `${what} is under ${there?.outerHTML.slice(0, 120) ?? 'nothing'}`;
    }
    return said;
  };
  const text = () => document.querySelector('section[aria-label="The document\'s text"]');
  // What the page still lacks of `until`, or null where it holds.
  const missing = (until: Until): string | null => {
    switch (until.kind) {
      case 'open': {
        const items = document.querySelectorAll('[role="tree"] [role="treeitem"]');
        if (items.length !== until.nodes) return `the tree has ${items.length} items`;
        for (const item of items) {
          if (labelOf(item) === 'A component') return 'a component in the tree is not named yet';
        }
        const within = text()?.querySelector(`[data-node="${until.node}"]`);
        const paragraph = [...(within?.querySelectorAll('p') ?? [])].find((each) =>
          each.textContent?.includes(until.words),
        );
        return unseen(paragraph, `the text holding ${until.words}`, 'any');
      }
      case 'number': {
        const item = document.querySelector(`[role="treeitem"][data-node="${until.node}"]`);
        const described = item?.getAttribute('aria-describedby');
        const number = described ? document.getElementById(described)?.textContent : undefined;
        return number === until.number ? null : `the node is numbered ${number}`;
      }
      case 'inView': {
        const within = text()?.querySelector(`[data-node="${until.node}"]`);
        return unseen(
          within?.querySelector('h1, h2, h3, h4, h5, h6'),
          "the node's heading",
          'first',
        );
      }
    }
  };
  const holds = (until: Until): boolean => missing(until) === null;
  const MODIFIERS = new Set(['Alt', 'Control', 'Shift', 'Meta']);
  const state: { result: Timed | null; failed: string | null } = { result: null, failed: null };
  const budget = {
    /** Whether `until` holds now: asked before an act, so a sample never starts where it has ended. */
    holds,
    /** What the page lacks of `until`, for a failure to name. */
    missing,
    get result() {
      return state.result;
    },
    get failed() {
      return state.failed;
    },
    arm(until: Until, startOn: 'input' | 'now'): void {
      state.result = null;
      state.failed = null;
      performance.clearResourceTimings();
      let act: number | null = null;
      if (startOn === 'now') act = performance.now();
      else {
        const began = (event: Event) => {
          if (event instanceof KeyboardEvent && MODIFIERS.has(event.key)) return;
          act = event.timeStamp;
          window.removeEventListener('keydown', began, true);
          window.removeEventListener('pointerdown', began, true);
        };
        window.addEventListener('keydown', began, true);
        window.addEventListener('pointerdown', began, true);
      }
      const frame = () => {
        let there: boolean;
        try {
          there = act !== null && holds(until);
        } catch (error) {
          state.failed = String(error);
          return;
        }
        if (!there) {
          requestAnimationFrame(frame);
          return;
        }
        const held = performance.now();
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          const painted = performance.now();
          const from = act!;
          const requests = performance
            .getEntriesByType('resource')
            .filter(
              (entry): entry is PerformanceResourceTiming =>
                entry instanceof PerformanceResourceTiming &&
                entry.startTime >= from &&
                entry.responseEnd > 0 &&
                entry.responseEnd <= painted,
            )
            .map((entry) => ({
              name: entry.name,
              from: entry.requestStart > 0 ? entry.requestStart : entry.fetchStart,
              to: entry.responseEnd,
            }));
          state.result = { act: from, held, painted, requests };
        };
        channel.port2.postMessage(null);
      };
      requestAnimationFrame(frame);
    },
  };
  (window as unknown as { budget: typeof budget }).budget = budget;
}

/** The time at least one of `intervals` was open: overlapping requests counted once, not twice. */
export function covered(intervals: readonly (readonly [number, number])[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let open: [number, number] | null = null;
  for (const [from, to] of sorted) {
    if (open !== null && from <= open[1]) open[1] = Math.max(open[1], to);
    else {
      if (open !== null) total += open[1] - open[0];
      open = [from, to];
    }
  }
  if (open !== null) total += open[1] - open[0];
  return total;
}

/**
 * One act measured in the page (B-L): armed, made by `act`, and timed by the page from the act to the
 * frame showing `until` painted. The service's share is the time any request the act waited on was in
 * flight, from its `requestStart` to its `responseEnd` by Resource Timing, overlapping ones counted
 * once; the interface's is the rest.
 */
export async function measure(
  page: Page,
  until: Until,
  act: () => Promise<void>,
  {
    startOn = 'input',
    within = 30_000,
  }: { readonly startOn?: 'input' | 'now'; readonly within?: number } = {},
): Promise<Measured> {
  type Armed = { budget: { arm(until: Until, startOn: 'input' | 'now'): void } };
  if (startOn === 'input') {
    await page.evaluate((condition) => {
      (window as unknown as Armed).budget.arm(condition, 'input');
    }, until);
    await act();
  } else {
    await act();
  }
  let answer: Timed | { failed: string };
  try {
    const handle = await page.waitForFunction(
      () => {
        const budget = (
          window as unknown as { budget: { result: Timed | null; failed: string | null } }
        ).budget;
        return budget.failed !== null ? { failed: budget.failed } : budget.result;
      },
      undefined,
      { timeout: within },
    );
    answer = (await handle.jsonValue()) as Timed | { failed: string };
  } catch (failure) {
    const lacking = await page
      .evaluate(
        (condition) =>
          (
            window as unknown as { budget: { missing(until: Until): string | null } }
          ).budget.missing(condition),
        until,
      )
      .catch(() => 'the page could not say');
    throw new Error(`The act's result never arrived (${until.kind}): ${lacking}`, {
      cause: failure,
    });
  }
  if ('failed' in answer) throw new Error(`The page could not ask its condition: ${answer.failed}`);
  const whole = answer.painted - answer.act;
  const service = covered(answer.requests.map((request) => [request.from, request.to] as const));
  const round = (value: number) => Number(value.toFixed(1));
  return {
    whole: round(whole),
    service: round(service),
    interface: round(whole - service),
    requests: answer.requests.map((request) => ({
      name: new URL(request.name).pathname,
      ms: round(request.to - request.from),
    })),
  };
}

/** Whether `until` holds on the page now, asked of the page's own condition. */
export async function holdsNow(page: Page, until: Until): Promise<boolean> {
  return page.evaluate(
    (condition) =>
      (window as unknown as { budget: { holds(until: Until): boolean } }).budget.holds(condition),
    until,
  );
}

/**
 * Counts the page's requests in flight, so a test can wait between samples until nothing an act set
 * off - a text read again after a move, say - is still arriving to fall inside the next.
 */
export function inFlight(page: Page): { quiet(forMs?: number): Promise<void> } {
  let open = 0;
  let changed = Date.now();
  const touched = () => {
    changed = Date.now();
  };
  page.on('request', () => {
    open += 1;
    touched();
  });
  const done = () => {
    open = Math.max(0, open - 1);
    touched();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return {
    async quiet(forMs = 250) {
      const stop = Date.now() + 30_000;
      while (open > 0 || Date.now() - changed < forMs) {
        if (Date.now() > stop) throw new Error(`${open} requests were still in flight after 30 s`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}

/**
 * An act the page is told to make, armed and made in one step so nothing of the test's own round trip
 * falls inside it: the act is timed from the moment the page is told.
 */
export async function armAndGo(page: Page, until: Until, hash: string): Promise<void> {
  await page.evaluate(
    ({ condition, to }) => {
      (window as unknown as { budget: { arm(until: Until, startOn: 'now'): void } }).budget.arm(
        condition,
        'now',
      );
      window.location.hash = to;
    },
    { condition: until, to: hash },
  );
}
