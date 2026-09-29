import type { Locator, Page, Response } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import {
  api,
  edit,
  makeDocument,
  nodesOf,
  type Client,
  type DocumentView,
  type OutlineNode,
} from './testing/api.js';
import { SERVICE } from './testing/addresses.js';
import { makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * Moving through a document longer than the window (issue #336): the text scrolls where the reader
 * takes it and stays there, and a node chosen in the outline or reached by a link is left on the
 * screen, its heading below the page's sticky header. jsdom lays nothing out, so none of this can be
 * shown there: the loop it guards against is the window, the outline and the text moving each other.
 */

/** A paragraph of a component's content, as the editor stores one. */
function paragraph(id: string, value: string) {
  return { type: 'paragraph', id, style: 'body', content: [{ type: 'text', value, marks: [] }] };
}

const WORDS =
  'The unit is lifted from its box by the two handles at its sides, and set on a level surface ' +
  'with room around it for the air to move. Nothing is connected until it has stood for an hour.';

/** Three components of four paragraphs each, placed over and over: the text is what makes it long. */
async function components(client: Client, name: string): Promise<string[]> {
  const made: string[] = [];
  for (const each of ['One', 'Two', 'Three']) {
    const component = await makeComponent(
      client,
      `${name} ${each}`,
      ['p1', 'p2', 'p3', 'p4'].map((id) => paragraph(id, WORDS)),
    );
    made.push(component.id);
  }
  return made;
}

/**
 * A document of `sections` sections, each placing `placed` components in turn, made through the API
 * one operation at a time as the outline's acts make it.
 */
async function longDocument(
  client: Client,
  name: string,
  sections: number,
  placed: number,
): Promise<DocumentView> {
  const placing = await components(client, name);
  const titles = Array.from({ length: sections }, (_, index) => `Part ${index + 1}`);
  let document = await makeDocument(client, name, titles);
  let used = 0;
  for (let index = 0; index < sections; index++) {
    const parent = nodesOf(document)[index]!.id;
    for (let position = 0; position < placed; position++) {
      document = await edit(client, document, {
        operation: 'insert',
        parent,
        position,
        node: {
          type: 'reference',
          component: placing[used++ % placing.length]!,
          mode: { kind: 'latest' },
        },
      });
    }
  }
  return document;
}

/** Every node of an outline, in reading order. */
function everyNode(nodes: readonly OutlineNode[]): OutlineNode[] {
  return nodes.flatMap((node) => [node, ...everyNode(node.children)]);
}

/** The document's page, its text drawn and its faces loaded, so nothing moves under a measure. */
async function open(page: Page, path: string): Promise<{ tree: Locator; text: Locator }> {
  await page.goto(`${SERVICE}/#${path}`);
  const tree = page.getByRole('tree', { name: 'Outline' });
  const text = page.getByRole('region', { name: "The document's text" });
  await tree.waitFor();
  await text.locator('[data-node]').first().waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return { tree, text };
}

/**
 * Waits for the window to stop moving - the same place read for half a second - and answers where it
 * stopped. A page that springs back does so within a few frames, so a place held that long is where
 * the page has settled, not a moment on the way somewhere else.
 */
async function settled(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        let last = window.scrollY;
        let still = 0;
        const began = performance.now();
        const look = () => {
          const now = window.scrollY;
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 30) resolve(now);
          else if (performance.now() - began > 15_000)
            reject(new Error(`The page never stopped moving: last at ${now}`));
          else requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      }),
  );
}

/**
 * Turns the wheel over the text by `pixels` and answers where the window settles. The browser scrolls
 * after the event, on a frame of its own, so the window is waited for to leave where it was - for up
 * to two seconds, since a wheel that moves nothing is an answer too - before it is waited for to stop.
 */
async function wheel(page: Page, pixels: number): Promise<number> {
  const from = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, pixels);
  await page
    .waitForFunction((was) => window.scrollY !== was, from, { timeout: 2_000, polling: 'raf' })
    .catch(() => undefined);
  return settled(page);
}

/**
 * The pointer over the text, and the wheel made ready there. The pinned headless Chromium drops the
 * wheel events a page is sent in its first moments, scrolling nothing, so turns of one pixel are spent
 * until one moves the window, and its place then answered: where the reader's own turns start from.
 */
async function overTheText(page: Page, text: Locator): Promise<number> {
  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, 400);
  for (let turn = 0; turn < 20; turn++) {
    const at = await wheel(page, 1);
    if (at > 0) return at;
  }
  throw new Error('The wheel never moved the window');
}

/** How far the window can scroll at most. */
async function furthest(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
}

/** Where a node's heading stands in the window, and where the sticky header's foot is. */
async function standing(
  page: Page,
  node: string,
): Promise<{ top: number; bottom: number; header: number; height: number }> {
  return page.evaluate((id) => {
    const element = document.querySelector(
      `[aria-label="The document's text"] [data-node="${id}"]`,
    );
    if (!element) throw new Error(`No node ${id} in the text`);
    const heading = element.querySelector('h1, h2, h3, h4, h5, h6') ?? element;
    const box = heading.getBoundingClientRect();
    const header = document.querySelector('header')!.getBoundingClientRect().bottom;
    return { top: box.top, bottom: box.bottom, header, height: window.innerHeight };
  }, node);
}

/** A node's heading is wholly on the screen, below the header rather than under it. */
async function expectOnScreen(page: Page, node: string, what: string): Promise<void> {
  await settled(page);
  const at = await standing(page, node);
  expect(
    at.top,
    `${what}: its heading's top, against the header's foot at ${at.header}`,
  ).toBeGreaterThanOrEqual(at.header - 1);
  expect(
    at.bottom,
    `${what}: its heading's foot, against the window's ${at.height}`,
  ).toBeLessThanOrEqual(at.height);
}

/** Whether the tree item of `node` is inside the outline pane's visible part. */
async function shownInPane(tree: Locator, node: string): Promise<boolean> {
  return tree.evaluate((root, id) => {
    const item = root.querySelector(`[role="treeitem"][data-node="${id}"]`);
    const row = item?.querySelector('[data-row]') ?? item;
    if (!row) return false;
    const box = row.getBoundingClientRect();
    let pane: Element | null = root.parentElement;
    while (pane && pane.scrollHeight <= pane.clientHeight) pane = pane.parentElement;
    const clip = pane && pane !== document.documentElement ? pane.getBoundingClientRect() : null;
    const top = Math.max(
      clip?.top ?? 0,
      document.querySelector('header')!.getBoundingClientRect().bottom,
    );
    const bottom = Math.min(clip?.bottom ?? window.innerHeight, window.innerHeight);
    return box.top >= top - 1 && box.bottom <= bottom + 1;
  }, node);
}

/** Whether a response is the texts' or the theme's, or a face's file. */
const TEXTS = (response: Response) => response.url().endsWith('/texts');
const THEME = (response: Response) => response.url().endsWith('/presentation');
const FACE = /\.(ttf|otf)(\?.*)?$/;

/**
 * Holds every request `matching` until `after` has answered and a moment more, so what it brings
 * changes the page after the link has gone to its node; answers when the first of them is through.
 */
async function holdUntil(
  page: Page,
  matching: string | RegExp,
  after: (response: Response) => boolean,
): Promise<{ readonly through: Promise<unknown> }> {
  const answered = page.waitForResponse(after);
  // Awaited below; a page closed before it answers is the test's own failure, not an unhandled one.
  answered.catch(() => undefined);
  let letThrough!: () => void;
  const released = new Promise<void>((resolve) => (letThrough = resolve));
  await page.route(matching, async (route) => {
    await answered;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
    letThrough();
  });
  return { through: released.then(() => page.waitForTimeout(100)) };
}

/**
 * The orders a document's page can take in what it loads, each arranged before the page opens and
 * answering once what it held is through: what the texts, the theme and the faces each change is the
 * height of everything above a linked node, however late it comes (issues #341, #350).
 */
const INTERLEAVINGS: readonly {
  readonly name: string;
  readonly arrange: (page: Page) => Promise<{ readonly through: Promise<unknown> }>;
}[] = [
  { name: 'as the stack serves it', arrange: async () => ({ through: Promise.resolve() }) },
  {
    name: 'the theme after the texts',
    arrange: (page) => holdUntil(page, '**/v1/documents/*/presentation', TEXTS),
  },
  { name: 'the faces after the texts', arrange: (page) => holdUntil(page, FACE, TEXTS) },
  {
    name: 'the texts after the theme',
    arrange: (page) => holdUntil(page, '**/v1/documents/*/texts', THEME),
  },
  {
    name: 'on a machine four times slower',
    arrange: async (page) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      return { through: Promise.resolve() };
    },
  },
];

/** Waits for a linked node's heading to have been taken to just below the header. */
async function arrivedAt(page: Page, node: string): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const element = document.querySelector(
        `[aria-label="The document's text"] [data-node="${id}"]`,
      );
      const header = document.querySelector('header')!.getBoundingClientRect().bottom;
      return element !== null && Math.abs(element.getBoundingClientRect().top - header) < 2;
    },
    node,
    { polling: 'raf' },
  );
  // And the page given the means to grow the text above a node, as its own layout grows it.
  await page.evaluate(() => {
    (window as unknown as { growAbove: (id: string, by: number) => void }).growAbove = (id, by) => {
      const room = document.createElement('div');
      room.style.height = `${by}px`;
      document
        .querySelector(`[aria-label="The document's text"] [data-node="${id}"]`)!
        .append(room);
    };
  });
}

/** Declared for the page's scripts: `arrivedAt` puts it there. */
declare function growAbove(id: string, by: number): void;

/**
 * Holds the document's theme back until the answer is called, which lets it through and waits for it
 * and the faces it names: its arrival changes every height above a linked node.
 */
async function holdTheTheme(page: Page): Promise<() => Promise<void>> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/v1/documents/*/presentation', async (route) => {
    await held;
    await route.continue();
  });
  return async () => {
    const themed = page.waitForResponse(THEME);
    release();
    await themed;
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
  };
}

describe('moving through a long document in a browser (issue #336)', () => {
  it('STR-035 scrolls the text wherever the wheel takes it, and it stays there', async () => {
    const client = api();
    const made = await longDocument(client, 'Scrolled by the wheel', 3, 4);
    await withPage(async (page) => {
      const { text } = await open(page, `/documents/${made.id}`);
      expect(await settled(page)).toBe(0);
      const most = await furthest(page);
      expect(most, 'the text is longer than the window').toBeGreaterThan(1500);
      const start = await overTheText(page, text);
      const reached: number[] = [];
      for (let step = 1; step <= 10; step++) reached.push(await wheel(page, 150));
      expect(reached).toEqual(Array.from({ length: 10 }, (_, index) => start + (index + 1) * 150));
      // And still there a moment later: nothing pulls it back once the reader has let go.
      await page.waitForTimeout(500);
      expect(await settled(page)).toBe(start + 1500);
    });
  });

  it('STR-035 takes the text to any node chosen in the outline and leaves its heading below the header', async () => {
    const client = api();
    const made = await longDocument(client, 'Chosen in the outline', 3, 3);
    const nodes = everyNode(nodesOf(made));
    await withPage(async (page) => {
      const { tree } = await open(page, `/documents/${made.id}`);
      // The last node first - the furthest the text can go - then back up through the sections.
      const chosen = [nodes.at(-1)!, nodes[8]!, nodes[4]!, nodes.at(-4)!];
      for (const node of chosen) {
        await tree.locator(`[role="treeitem"][data-node="${node.id}"] [data-row]`).first().click();
        await expectOnScreen(page, node.id, `node ${nodes.indexOf(node) + 1} chosen`);
        expect(await shownInPane(tree, node.id)).toBe(true);
      }
      expect(await settled(page)).toBeGreaterThan(0);
    });
  });

  it('STR-045 opens at a linked node with its heading below the header', async () => {
    const client = api();
    const made = await longDocument(client, 'Reached by a link', 3, 3);
    const nodes = everyNode(nodesOf(made));
    const target = nodes[8]!;
    await withPage(async (page) => {
      await open(page, `/documents/${made.id}/nodes/${target.id}`);
      await expectOnScreen(page, target.id, 'the linked node');
      expect(await settled(page)).toBeGreaterThan(0);
    });
  });

  it('STR-045 keeps a linked node below the header however its texts, theme and faces arrive (issues #341, #350)', async () => {
    const client = api();
    const made = await longDocument(client, 'Reached as it loads', 3, 3);
    // The middle section: the window can scroll past it, so nothing but the page holds it in place.
    const target = everyNode(nodesOf(made))[4]!;
    // Every order tried, and every one that lands wrong named together.
    const wrong: string[] = [];
    for (const { name, arrange } of INTERLEAVINGS) {
      await withPage(async (page) => {
        const { through } = await arrange(page);
        await open(page, `/documents/${made.id}/nodes/${target.id}`);
        await through;
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        try {
          await expectOnScreen(page, target.id, `the linked node, ${name}`);
          expect(await settled(page), name).toBeGreaterThan(0);
        } catch (failure) {
          wrong.push((failure as Error).message.split('\n')[0]!);
        }
      });
    }
    expect(wrong).toEqual([]);
  });

  it('STR-045 leaves the reader where they scrolled once a link has taken them to its node, whatever arrives after (issue #350)', async () => {
    const client = api();
    const made = await longDocument(client, 'Scrolled from a link', 3, 3);
    const target = everyNode(nodesOf(made))[4]!;
    await withPage(async (page) => {
      // The theme held until the reader has scrolled: its arrival changes every height above the node.
      const release = await holdTheTheme(page);
      const { text } = await open(page, `/documents/${made.id}/nodes/${target.id}`);
      await arrivedAt(page, target.id);
      await overTheText(page, text);
      await wheel(page, 300);
      await release();
      await settled(page);
      const at = await standing(page, target.id);
      expect(at.top, 'the node, left where the reader scrolled past it').toBeLessThan(
        at.header - 100,
      );
    });
  });

  it('STR-045 leaves the reader where they scrolled by no wheel, key or pointer - a find, a dragged scrollbar - as the theme arrives (issue #350)', async () => {
    const client = api();
    const made = await longDocument(client, 'Scrolled without an input', 3, 3);
    const target = everyNode(nodesOf(made))[4]!;
    await withPage(async (page) => {
      const release = await holdTheTheme(page);
      await open(page, `/documents/${made.id}/nodes/${target.id}`);
      await arrivedAt(page, target.id);
      // The window scrolled as a find or a scrollbar scrolls it: no event the page hears but the scroll.
      await page.evaluate(() => window.scrollBy(0, 300));
      await release();
      await settled(page);
      const at = await standing(page, target.id);
      expect(at.top, 'the node, left where the reader scrolled past it').toBeLessThan(
        at.header - 100,
      );
    });
  });

  it("STR-045 takes a scroll of the reader's own in the frame the text above the node grows for theirs, not the layout's (issue #350)", async () => {
    const client = api();
    const made = await longDocument(client, 'Scrolled as it grew', 3, 3);
    const nodes = everyNode(nodesOf(made));
    const target = nodes[4]!;
    await withPage(async (page) => {
      await open(page, `/documents/${made.id}/nodes/${target.id}`);
      await arrivedAt(page, target.id);
      const from = await settled(page);
      // In one task: the text above the node 60 pixels taller, and the window scrolled 400 by the reader.
      await page.evaluate((above) => {
        growAbove(above, 60);
        window.scrollBy(0, 400);
      }, nodes[1]!.id);
      expect(await settled(page), 'the reader, left 400 pixels down').toBe(from + 400);
      // And let go: the text above growing again moves nothing.
      await page.evaluate((above) => growAbove(above, 200), nodes[1]!.id);
      expect(await settled(page), 'the window, once the hold has let go').toBe(from + 400);
    });
  });

  it('STR-045 lets a linked node go once the page has settled, so nothing that grows above it later moves the window (issue #350)', async () => {
    const client = api();
    const made = await longDocument(client, 'Settled after a link', 3, 3);
    const nodes = everyNode(nodesOf(made));
    const target = nodes[4]!;
    await withPage(async (page) => {
      await open(page, `/documents/${made.id}/nodes/${target.id}`);
      await arrivedAt(page, target.id);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      // Well past the page's settling: its texts, theme and faces in, and nothing resized since.
      await page.waitForTimeout(3_000);
      // The browser's own anchoring off, so the window moves only where the page moves it.
      await page.addStyleTag({ content: 'html { overflow-anchor: none !important; }' });
      const from = await settled(page);
      await page.evaluate((above) => growAbove(above, 300), nodes[1]!.id);
      expect(await settled(page), 'the window, after the page settled').toBe(from);
    });
  });

  it("STR-035 opens a document of five hundred nodes where it begins, and moves through it at the reader's bidding", async () => {
    const client = api();
    const made = await longDocument(client, 'Five hundred nodes', 125, 3);
    const nodes = everyNode(nodesOf(made));
    expect(nodes).toHaveLength(500);
    await withPage(async (page) => {
      const { tree, text } = await open(page, `/documents/${made.id}`);
      await page.waitForTimeout(500);
      expect(await settled(page), 'the page scrolled itself as it opened').toBe(0);

      // The wheel, a long way down.
      const start = await overTheText(page, text);
      const reached: number[] = [];
      for (let step = 1; step <= 5; step++) reached.push(await wheel(page, 1000));
      expect(reached).toEqual([1, 2, 3, 4, 5].map((step) => start + step * 1000));

      // Nodes chosen deep in the tree, by the pointer: each left on the screen, and its item in view in
      // the outline's own pane.
      for (const index of [499, 250, 377, 3, 123]) {
        const node = nodes[index]!;
        const item = tree.locator(`[role="treeitem"][data-node="${node.id}"] [data-row]`).first();
        await item.scrollIntoViewIfNeeded();
        await item.click();
        await expectOnScreen(page, node.id, `node ${index + 1} of 500 chosen`);
        expect(await shownInPane(tree, node.id), `node ${index + 1}'s item in the pane`).toBe(true);
      }

      // The keyboard: Home and End in the tree move the focus, and the pane scrolls to where it went.
      await tree.locator('[role="treeitem"][tabindex="0"]').focus();
      for (const [key, index] of [
        ['End', 499],
        ['Home', 0],
      ] as const) {
        await page.keyboard.press(key);
        await settled(page);
        const focusedNode = await page.evaluate(
          () => (document.activeElement as HTMLElement | null)?.dataset.node,
        );
        expect(focusedNode, `${key} moved the focus`).toBe(nodes[index]!.id);
        expect(await shownInPane(tree, focusedNode!), `${key}'s item in the pane`).toBe(true);
      }
    });
  });
});
