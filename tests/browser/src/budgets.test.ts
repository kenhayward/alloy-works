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
 * screen, a node inserted, gone, renamed or renumbered, a node's heading in view. One warm-up,
 * reported and held to the maximum, then twenty samples, of which the nearest-rank p95 is the second
 * slowest.
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
  return all;
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

/** The name the tree gives `node`, as it is drawn now. */
async function labelOf(page: Page, node: string): Promise<string> {
  return page.evaluate((id) => {
    const item = document.querySelector(`[role="treeitem"][data-node="${id}"]`);
    return document.getElementById(item?.getAttribute('aria-labelledby') ?? '')?.textContent ?? '';
  }, node);
}

/** The tree item named `label`, which an insert made. */
async function nodeNamed(page: Page, label: string): Promise<string> {
  const id = await page.evaluate((name) => {
    for (const item of document.querySelectorAll('[role="tree"] [role="treeitem"]')) {
      const said = document.getElementById(item.getAttribute('aria-labelledby') ?? '')?.textContent;
      if (said === name) return item.getAttribute('data-node');
    }
    return null;
  }, label);
  if (id === null) throw new Error(`No node in the tree is named ${label}`);
  return id;
}

/** Waits until the focus is on `node`'s tree item, where the keyboard's acts on the outline start. */
async function focusedOn(page: Page, node: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const active = document.activeElement;
        return (
          active?.getAttribute('role') === 'treeitem' && active.getAttribute('data-node') === id
        );
      }, node),
    )
    .toBe(true);
}

/** Where the focus is, by its element and accessible name, to say where it went. */
async function focusName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return `${active?.tagName.toLowerCase()}:${active?.getAttribute('aria-label') ?? ''}`;
  });
}

/** Chooses `node` in the outline by a pointer, leaving the focus on it. */
async function choose(page: Page, node: string): Promise<void> {
  const row = rowOf(page, node);
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await focusedOn(page, node);
}

/** The acts the outline offers (STR-072's "each structural act"), each made by the keyboard. */
const ACTS = ['insert', 'remove', 'retitle', 'set', 'move', 'demote', 'promote'] as const;
type Act = (typeof ACTS)[number];

/** A budget's record: the interface's share, the whole time and the service's, and the warm-up. */
function recorded(all: readonly Measured[]) {
  const samples = all.slice(WARM_UP);
  return {
    interface: summary(samples.map((each) => each.interface)),
    whole: summary(samples.map((each) => each.whole)),
    service: summary(samples.map((each) => each.service)),
    warmUp: all.slice(0, WARM_UP),
    requests: all[all.length - 1]!.requests,
  };
}

describe('the navigation budgets over a document of five hundred nodes', () => {
  let fixture: FiveHundred;
  beforeAll(async () => {
    fixture = await fiveHundred(api());
  }, 1_800_000);

  it("opens a document of five hundred nodes within the interface's share of the budget", async ({
    task,
  }) => {
    await withPage(async (page) => {
      const requests = await prepared(page);
      const all = await opens(page, fixture, () => requests.quiet());
      const open = recorded(all);
      record(task.meta, {
        configuration: await configuration(page.context().browser()!),
        fixture: shapeOf(fixture),
        open,
        budget: BUDGETS.interface,
      });
      hold('opening, the interface', open.interface, all[0]!.interface, BUDGETS.interface);
    });
  }, 600_000);

  it("shows each structural act on the outline within the interface's share of the budget: insert, remove, retitle, Starts on, move, demote and promote", async ({
    task,
  }) => {
    await withPage(async (page) => {
      const requests = await prepared(page);
      const settle = () => requests.quiet();
      await page.evaluate((id) => {
        window.location.hash = `#/documents/${id}`;
      }, fixture.document.id);
      await page.getByRole('tree', { name: 'Outline' }).waitFor();
      await settle();

      // The first chapter's first two sections, as the service holds them now.
      const [first, second] = nodesOf(await readDocument(api(), fixture.document.id))[0]!.children;
      const topic = first!.id;
      const next = second!.id;
      const measured: Record<Act, Measured[]> = {
        insert: [],
        remove: [],
        retitle: [],
        set: [],
        move: [],
        demote: [],
        promote: [],
      };
      // Each act measured, then the page left to settle: what an act sets off - the texts read again
      // for the version it made - is not the next act's.
      const timed = async (act: Act, until: Until, key: () => Promise<void>) => {
        measured[act].push(await measure(page, until, key));
        await settle();
      };

      // Each act and its inverse, so the fixture ends every cycle as it began. The first cycle's are
      // the warm-ups; retitle, Starts on and move are measured both ways, so twice a cycle.
      for (let cycle = 0; cycle < WARM_UP + SAMPLES; cycle++) {
        const title = await labelOf(page, topic);

        // Inserted after the section - Enter, a title, and Enter again - then removed: Delete, and the
        // question answered.
        await choose(page, topic);
        const added = `Inserted ${cycle + 1}`;
        await page.keyboard.press('Enter');
        await page.keyboard.type(added);
        await timed('insert', { kind: 'added', label: added }, () => page.keyboard.press('Enter'));
        const made = await nodeNamed(page, added);
        await focusedOn(page, made);
        await page.keyboard.press('Delete');
        await page.getByRole('group', { name: 'Confirm removal' }).waitFor();
        await timed('remove', { kind: 'gone', node: made }, () => page.keyboard.press('Enter'));

        // Retitled in Title, the next stop after the tree, and back.
        await choose(page, topic);
        await page.keyboard.press('Tab');
        expect(await focusName(page)).toMatch(/Title$/);
        for (const to of [`${title} retitled`, title]) {
          await page.keyboard.press('ControlOrMeta+a');
          await page.keyboard.type(to);
          await timed('retitle', { kind: 'label', node: topic, label: to }, () =>
            page.keyboard.press('Enter'),
          );
        }

        // Starts on, past Equation: a new page, and back to none.
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        expect(await focusName(page)).toMatch(/^select:/);
        await timed(
          'set',
          { kind: 'label', node: topic, label: `${title}, starts on a new page` },
          () => page.keyboard.press('ArrowDown'),
        );
        await timed('set', { kind: 'label', node: topic, label: title }, () =>
          page.keyboard.press('ArrowUp'),
        );

        // Moved among its siblings, down and back up: each time it takes the other's number.
        await choose(page, topic);
        for (const key of ['Alt+ArrowDown', 'Alt+ArrowUp']) {
          const number = await numberOf(page, next);
          await timed('move', { kind: 'number', node: topic, number }, () =>
            page.keyboard.press(key),
          );
          await focusedOn(page, topic);
        }

        // The second section demoted under the first, as its last child, and promoted back.
        await choose(page, next);
        const was = await numberOf(page, next);
        const under = await page
          .locator(`[role="treeitem"][data-node="${topic}"] > [role="group"] > [role="treeitem"]`)
          .count();
        const demoted = `${await numberOf(page, topic)}.${under + 1}`;
        await timed('demote', { kind: 'number', node: next, number: demoted }, () =>
          page.keyboard.press('Alt+ArrowRight'),
        );
        await focusedOn(page, next);
        await timed('promote', { kind: 'number', node: next, number: was }, () =>
          page.keyboard.press('Alt+ArrowLeft'),
        );
      }

      // What the service holds is the fixture as it was.
      const now = nodesOf(await readDocument(api(), fixture.document.id))[0]!.children;
      expect(now.map((each) => each.id).slice(0, 2)).toEqual([topic, next]);
      expect(now.length).toBe(FIVE_HUNDRED.sectionsPerChapter);

      const acts = Object.fromEntries(ACTS.map((act) => [act, recorded(measured[act])]));
      record(task.meta, {
        configuration: await configuration(page.context().browser()!),
        fixture: shapeOf(fixture),
        acts,
        budget: BUDGETS.interface,
      });
      for (const act of ACTS) {
        hold(
          `${act}, the interface`,
          acts[act]!.interface,
          measured[act][0]!.interface,
          BUDGETS.interface,
        );
      }
    });
  }, 900_000);

  it('opens the document view and jumps to any node within the budget', async ({ task }) => {
    await withPage(async (page) => {
      const requests = await prepared(page);
      const settle = () => requests.quiet();
      const opened = await opens(page, fixture, settle);

      // Jumps to nodes drawn from a seeded sequence, each chosen in the outline by a pointer, passing
      // over any whose heading is already on the screen, since a jump there moves nothing. A heading
      // that arrives and is taken away again (issue #336) is not a jump that landed.
      const random = seeded(179);
      const jumps: Measured[] = [];
      const chosen: string[] = [];
      while (jumps.length < WARM_UP + SAMPLES) {
        const node = fixture.order[Math.floor(random() * fixture.order.length)]!.id;
        const until: Until = { kind: 'inView', node };
        if (await holdsNow(page, until)) continue;
        const row = rowOf(page, node);
        await row.scrollIntoViewIfNeeded();
        jumps.push(await measure(page, until, () => row.click()));
        chosen.push(node);
        await settle();
        expect(await holdsNow(page, until), `the jump to ${node} stays where it landed`).toBe(true);
      }

      const open = recorded(opened);
      const jump = summary(jumps.slice(WARM_UP).map((each) => each.whole));
      record(task.meta, {
        configuration: await configuration(page.context().browser()!),
        fixture: shapeOf(fixture),
        open,
        jump: { whole: jump, warmUp: jumps.slice(0, WARM_UP), seed: 179, nodes: chosen },
        budgets: { open: BUDGETS.open, jump: BUDGETS.jump },
      });
      hold('opening, the whole time', open.whole, opened[0]!.whole, BUDGETS.open);
      hold('a jump, the whole time', jump, jumps[0]!.whole, BUDGETS.jump);
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
