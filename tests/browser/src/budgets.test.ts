import type { Page } from 'playwright-core';
import { beforeAll, describe, expect, it, type TaskMeta } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, nodesOf, readDocument } from './testing/api.js';
import {
  binding,
  BUDGETS,
  configuration,
  summary,
  type Budget,
  type Summary,
} from './testing/budget.js';
import { FIVE_HUNDRED, fiveHundred, seeded, type FiveHundred } from './testing/five-hundred.js';
import { withPage } from './testing/page.js';
import {
  armAndGo,
  holdsNow,
  inFlight,
  instrument,
  measure,
  type Measured,
  type Until,
} from './testing/timing.js';

/**
 * The navigation budgets, measured in the pinned Chromium against the running stack over the
 * five-hundred-node fixture (the W13 plan's W13.3, B-K, B-L and B-P). Each act is timed by the page
 * itself, from the act to the frame showing its result painted, and that result is the state's own
 * content, asked for by the page: the outline's five hundred items named and the first text on the
 * screen, a moved node's new number, a node's heading in view. One warm-up, reported and held to the
 * maximum, then twenty samples, of which the nearest-rank p95 is the second slowest.
 */

const WARM_UP = 1;
const SAMPLES = 20;

declare module 'vitest' {
  interface TaskMeta {
    /** What a budget measured, on what, and against which bounds (B-P). */
    budget?: Record<string, unknown>;
  }
}

/** Held to `budget` where it binds; recorded either way. */
function hold(name: string, measured: Summary, warmUp: number, budget: Budget): void {
  const bound = binding(budget, process.env);
  if (bound.p95 !== null) {
    expect(measured.p95, `${name}: the p95 of ${measured.samples.join(', ')}`).toBeLessThanOrEqual(
      bound.p95,
    );
  }
  if (bound.max !== null) {
    expect(
      measured.max,
      `${name}: the slowest of ${measured.samples.join(', ')}`,
    ).toBeLessThanOrEqual(bound.max);
    expect(warmUp, `${name}: the warm-up`).toBeLessThanOrEqual(bound.max);
  }
}

/** The documents list, arrived at and settled: where each open starts from. */
async function atTheList(page: Page, settle: () => Promise<void>): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/documents';
  });
  await page.getByRole('heading', { name: 'Documents', level: 1, exact: true }).waitFor();
  await page.getByRole('tree', { name: 'Outline' }).waitFor({ state: 'detached' });
  await settle();
}

/** The document opened from the list, as a link followed there opens it, timed to its first screen. */
async function openFromTheList(page: Page, fixture: FiveHundred): Promise<Measured> {
  const until: Until = {
    kind: 'open',
    nodes: fixture.nodes,
    node: fixture.first.node,
    words: fixture.first.words,
  };
  return measure(page, until, () => armAndGo(page, until, `#/documents/${fixture.document.id}`), {
    startOn: 'now',
  });
}

/** The page at the fixture's documents list, instrumented, with its requests counted. */
async function prepared(page: Page) {
  await page.addInitScript(instrument);
  const requests = inFlight(page);
  await page.goto(`${SERVICE}/#/documents`);
  await page.getByRole('heading', { name: 'Documents', level: 1, exact: true }).waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await requests.quiet();
  return requests;
}

/** Opens, one warm-up and then the samples, each from the list. */
async function opens(page: Page, fixture: FiveHundred, settle: () => Promise<void>) {
  const all: Measured[] = [];
  for (let sample = 0; sample < WARM_UP + SAMPLES; sample++) {
    await atTheList(page, settle);
    all.push(await openFromTheList(page, fixture));
    await settle();
  }
  return { warmUp: all.slice(0, WARM_UP), samples: all.slice(WARM_UP) };
}

/** The label of `node`'s row in the outline, which a pointer chooses it by. */
function rowOf(page: Page, node: string) {
  return page.locator(`[role="treeitem"][data-node="${node}"] > [data-row] > span[id]`).last();
}

/** The number the tree describes `node` by, as it is drawn now. */
async function numberOf(page: Page, node: string): Promise<string> {
  return page.evaluate((id) => {
    const item = document.querySelector(`[role="treeitem"][data-node="${id}"]`);
    const described = item?.getAttribute('aria-describedby');
    return (described ? document.getElementById(described)?.textContent : null) ?? '';
  }, node);
}

describe('the navigation budgets over a document of five hundred nodes', () => {
  let fixture: FiveHundred;
  beforeAll(async () => {
    fixture = await fiveHundred(api());
  }, 1_800_000);

  it("the interface's share of opening the document and of a move", async ({ task }) => {
    await withPage(async (page) => {
      const requests = await prepared(page);
      const settle = () => requests.quiet();
      const opened = await opens(page, fixture, settle);

      // A move among siblings, by Alt+Down and then back by Alt+Up, so the fixture ends as it began:
      // the first chapter's first two sections, as the service holds them now.
      const client = api();
      const [first, second] = nodesOf(await readDocument(client, fixture.document.id))[0]!.children;
      const moved = first!.id;
      await rowOf(page, moved).click();
      await expect
        .poll(() =>
          page.locator(`[role="treeitem"][data-node="${moved}"]`).getAttribute('aria-selected'),
        )
        .toBe('true');
      await settle();
      const moves: Measured[] = [];
      // Down, it swaps places with the second; up, back again: either way it takes the second's number.
      const other = second!.id;
      for (let sample = 0; sample < WARM_UP + SAMPLES; sample++) {
        const down = sample % 2 === 0;
        const number = await numberOf(page, other);
        expect(number, 'the sibling a move swaps with is numbered').not.toBe('');
        moves.push(
          await measure(page, { kind: 'number', node: moved, number }, () =>
            page.keyboard.press(down ? 'Alt+ArrowDown' : 'Alt+ArrowUp'),
          ),
        );
        await settle();
      }
      // An odd number of acts leaves the node a place down: put it back, outside the samples.
      if ((WARM_UP + SAMPLES) % 2 === 1) {
        const number = await numberOf(page, second!.id);
        await page.keyboard.press('Alt+ArrowUp');
        await expect.poll(() => numberOf(page, moved)).toBe(number);
        await settle();
      }

      const open = summary(opened.samples.map((each) => each.interface));
      const move = summary(moves.slice(WARM_UP).map((each) => each.interface));
      record(task.meta, {
        configuration: await configuration(page.context().browser()!),
        fixture: shapeOf(fixture),
        open: {
          interface: open,
          whole: summary(opened.samples.map((each) => each.whole)),
          service: summary(opened.samples.map((each) => each.service)),
          warmUp: opened.warmUp,
          requests: opened.samples[opened.samples.length - 1]!.requests,
        },
        move: {
          interface: move,
          whole: summary(moves.slice(WARM_UP).map((each) => each.whole)),
          service: summary(moves.slice(WARM_UP).map((each) => each.service)),
          warmUp: moves.slice(0, WARM_UP),
          requests: moves[moves.length - 1]!.requests,
        },
        budget: BUDGETS.interface,
      });
      hold('opening, the interface', open, opened.warmUp[0]!.interface, BUDGETS.interface);
      hold('a move, the interface', move, moves[0]!.interface, BUDGETS.interface);
    });
  });

  it('the view opens, and jumps to any node', async ({ task }) => {
    await withPage(async (page) => {
      const requests = await prepared(page);
      const settle = () => requests.quiet();
      const opened = await opens(page, fixture, settle);

      // Jumps to nodes drawn from a seeded sequence, each chosen in the outline by a pointer, passing
      // over any whose heading is already on the screen, since a jump there moves nothing.
      const random = seeded(179);
      const jumps: Measured[] = [];
      const chosen: string[] = [];
      const missed: { node: string; said: string }[] = [];
      while (jumps.length + missed.length < WARM_UP + SAMPLES) {
        const node = fixture.order[Math.floor(random() * fixture.order.length)]!.id;
        const until: Until = { kind: 'inView', node };
        if (await holdsNow(page, until)) continue;
        const row = rowOf(page, node);
        await row.scrollIntoViewIfNeeded();
        try {
          const measured = await measure(page, until, () => row.click(), { within: 2_000 });
          await settle();
          if (await holdsNow(page, until)) {
            jumps.push(measured);
            chosen.push(node);
          } else {
            missed.push({ node, said: `shown after ${measured.whole} ms, then taken away` });
          }
        } catch (failure) {
          missed.push({ node, said: String(failure).slice(0, 300) });
        }
        await settle();
      }

      const open = summary(opened.samples.map((each) => each.whole));
      const jump =
        jumps.length > WARM_UP ? summary(jumps.slice(WARM_UP).map((each) => each.whole)) : null;
      record(task.meta, {
        configuration: await configuration(page.context().browser()!),
        fixture: shapeOf(fixture),
        open: {
          whole: open,
          interface: summary(opened.samples.map((each) => each.interface)),
          service: summary(opened.samples.map((each) => each.service)),
          warmUp: opened.warmUp,
          requests: opened.samples[opened.samples.length - 1]!.requests,
        },
        jump: { whole: jump, warmUp: jumps.slice(0, WARM_UP), seed: 179, nodes: chosen, missed },
        budgets: { open: BUDGETS.open, jump: BUDGETS.jump },
      });
      hold('opening, the whole time', open, opened.warmUp[0]!.whole, BUDGETS.open);
      expect(missed).toEqual([]);
      hold('a jump, the whole time', jump!, jumps[0]!.whole, BUDGETS.jump);
    });
  }, 600_000);
});

/** The fixture's shape as read back, for the record. */
function shapeOf(fixture: FiveHundred) {
  return {
    title: fixture.document.outline.title,
    version: FIVE_HUNDRED.version,
    nodes: fixture.nodes,
    sections: fixture.sections,
    references: fixture.references,
    components: fixture.components,
  };
}

/** Written into the test's meta, which the JSON report carries, and printed. */
function record(meta: TaskMeta, measured: Record<string, unknown>): void {
  meta.budget = measured;
  console.log(JSON.stringify(measured, null, 2));
}
