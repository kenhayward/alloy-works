import type { Locator, Page, Route } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';
import {
  api,
  edit,
  makeDocument,
  nodesOf,
  readDocument,
  shapeOf,
  titleOf,
  words,
  type Client,
  type DocumentView,
  type OutlineNode,
  type ShapeEntry,
} from './testing/api.js';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { withPage } from './testing/page.js';

/**
 * The outline, edited the three ways STR-006 names - by pointer, by keyboard alone and through the
 * API - against the whole stack, each act read back from the service rather than from the page. What
 * jsdom could not show is shown here: the browser's own drag and drop, where the focus really goes,
 * what the live region says in the accessibility tree, and `Alt+Left` kept from the browser.
 */

/** Each document starts as this: a section, a section holding one, and a section. */
const START = ['Alpha', ['Beta', 'Beta one'], 'Gamma'] as const;

/** What the page reports of the input it was sent, counted in the page itself. */
interface Acts {
  pointer: number;
  altArrows: { key: string; prevented: boolean }[];
}

/**
 * Counts every pointer press the page receives, and whether each `Alt` and arrow key was taken - its
 * default prevented - by the time it reached the window, after the tree's own handler. A key the tree
 * leaves alone is one the browser acts on, and `Alt+Left` there is Back.
 */
function countActs(): void {
  const acts: Acts = { pointer: 0, altArrows: [] };
  (window as unknown as { acts: Acts }).acts = acts;
  window.addEventListener('pointerdown', () => (acts.pointer += 1), true);
  window.addEventListener('mousedown', () => (acts.pointer += 1), true);
  window.addEventListener('keydown', (event) => {
    if (event.altKey && event.key.startsWith('Arrow')) {
      acts.altArrows.push({ key: event.key, prevented: event.defaultPrevented });
    }
  });
}

async function actsOf(page: Page): Promise<Acts> {
  return page.evaluate(() => (window as unknown as { acts: Acts }).acts);
}

/** The document's page, arrived at from the documents list, so the browser has somewhere to go Back to. */
async function open(page: Page, opened: DocumentView): Promise<Locator> {
  await page.addInitScript(countActs);
  await page.goto(`${SERVICE}/#/documents`);
  await page.getByRole('button', { name: /Ada/ }).waitFor();
  await page.goto(`${SERVICE}/#/documents/${opened.id}`);
  const tree = page.getByRole('tree', { name: 'Outline' });
  await tree.waitFor();
  // The page's faces arrive after its first paint and move the rows beneath them: a pointer aimed
  // before that lands on the wrong one.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return tree;
}

function item(tree: Locator, label: string): Locator {
  return tree.getByRole('treeitem', { name: label, exact: true });
}

/** The node the focus is on, if it is on a tree item; otherwise what it is on, to say where it went. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    const node = active?.closest('[role="treeitem"]');
    if (node instanceof HTMLElement && node === active) return `treeitem:${node.dataset.node}`;
    return `${active?.tagName.toLowerCase()}:${active?.getAttribute('aria-label') ?? active?.textContent?.slice(0, 40)}`;
  });
}

/** Waits for the page's live region to say `said`, read from the accessibility tree. */
async function announced(page: Page, said: string): Promise<void> {
  const status = page.locator('footer').getByRole('status');
  await vi.waitFor(async () => expect(await status.ariaSnapshot()).toContain(said), {
    timeout: 15_000,
    interval: 100,
  });
}

/** The outline as the service holds it now, as a nested list of titles. */
async function held(client: Client, document: DocumentView): Promise<ShapeEntry[]> {
  return shapeOf(nodesOf(await readDocument(client, document.id)));
}

function find(nodes: readonly OutlineNode[], title: string): OutlineNode {
  for (const node of nodes) {
    if (titleOf(node) === title) return node;
    const within = node.children.length > 0 ? findOrNot(node.children, title) : undefined;
    if (within) return within;
  }
  throw new Error(`No node titled ${title}`);
}

function findOrNot(nodes: readonly OutlineNode[], title: string): OutlineNode | undefined {
  try {
    return find(nodes, title);
  } catch {
    return undefined;
  }
}

/** Tabs from the top of the page until the focus is in the tree: one tab stop, as the tree is. */
async function tabIntoTree(page: Page): Promise<void> {
  for (let presses = 0; presses < 80; presses++) {
    await page.keyboard.press('Tab');
    if ((await focused(page)).startsWith('treeitem:')) return;
  }
  throw new Error(`Tabbing never reached the tree; the focus is on ${await focused(page)}`);
}

/**
 * The browser's own drag and drop, driven by the pointer: pressed on the source's row, moved until the
 * drag has begun and the drop places have appeared, then over the target and let go.
 */
async function drag(page: Page, source: Locator, target: () => Locator): Promise<void> {
  // Hovered first, which waits for the row to be stable and to be what the pointer would hit.
  await source.hover();
  const from = await source.boundingBox();
  if (!from) throw new Error('The dragged row is not on the page');
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y + 8, { steps: 4 });
  const onto = target();
  await onto.waitFor({ state: 'visible' });
  const to = await onto.boundingBox();
  if (!to) throw new Error('The drop target is not on the page');
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
}

const OUTLINE_PANEL = '[data-panel="outline"]';

describe('the outline in a browser', () => {
  it('STR-006 is edited by keyboard alone: every operation, each read back from the service', async ({
    task,
  }) => {
    const client = api();
    const document = await makeDocument(client, 'The outline by keyboard', START);
    await withPage(async (page) => {
      const tree = await open(page, document);
      await checkAxe(page, 'the outline as opened', task.meta, { within: OUTLINE_PANEL });

      await tabIntoTree(page);
      const alpha = find(nodesOf(document), 'Alpha').id;
      expect(await focused(page)).toBe(`treeitem:${alpha}`);

      // Insert: Enter, a title, Enter.
      await page.keyboard.press('Enter');
      await page.keyboard.type('Delta');
      await page.keyboard.press('Enter');
      await announced(page, 'Added Delta.');
      expect(await held(client, document)).toEqual([
        'Alpha',
        'Delta',
        ['Beta', 'Beta one'],
        'Gamma',
      ]);
      const delta = find(nodesOf(await readDocument(client, document.id)), 'Delta').id;
      await vi.waitFor(async () => expect(await focused(page)).toBe(`treeitem:${delta}`));
      await checkAxe(page, 'a section added', task.meta, { within: OUTLINE_PANEL });

      // Move among siblings.
      await page.keyboard.press('Alt+ArrowDown');
      await announced(page, 'Moved Delta after Beta.');
      expect(await held(client, document)).toEqual([
        'Alpha',
        ['Beta', 'Beta one'],
        'Delta',
        'Gamma',
      ]);
      await vi.waitFor(async () => expect(await focused(page)).toBe(`treeitem:${delta}`));
      await checkAxe(page, 'a section moved down', task.meta, { within: OUTLINE_PANEL });

      await page.keyboard.press('Alt+ArrowUp');
      await announced(page, 'Moved Delta after Alpha.');
      expect(await held(client, document)).toEqual([
        'Alpha',
        'Delta',
        ['Beta', 'Beta one'],
        'Gamma',
      ]);
      await vi.waitFor(async () => expect(await focused(page)).toBe(`treeitem:${delta}`));
      await checkAxe(page, 'a section moved up', task.meta, { within: OUTLINE_PANEL });

      // Demote and promote.
      await page.keyboard.press('Alt+ArrowRight');
      await announced(page, 'Moved Delta under Alpha.');
      expect(await held(client, document)).toEqual([
        ['Alpha', 'Delta'],
        ['Beta', 'Beta one'],
        'Gamma',
      ]);
      await vi.waitFor(async () => expect(await focused(page)).toBe(`treeitem:${delta}`));
      await checkAxe(page, 'a section demoted', task.meta, { within: OUTLINE_PANEL });

      // The address follows the chosen node, and Delta stays chosen: Back is all that could move it.
      const address = page.url();
      const history = await page.evaluate(() => window.history.length);
      await page.keyboard.press('Alt+ArrowLeft');
      await announced(page, 'Moved Delta to the top level, after Alpha.');
      expect(await held(client, document)).toEqual([
        'Alpha',
        'Delta',
        ['Beta', 'Beta one'],
        'Gamma',
      ]);
      await vi.waitFor(async () => expect(await focused(page)).toBe(`treeitem:${delta}`));
      // Alt+Left is the browser's Back on Windows and Linux: the tree took it, and the page stayed.
      expect(page.url()).toBe(address);
      expect(await page.evaluate(() => window.history.length)).toBe(history);
      expect((await actsOf(page)).altArrows).toEqual(
        ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].map((key) => ({
          key,
          prevented: true,
        })),
      );
      await checkAxe(page, 'a section promoted', task.meta, { within: OUTLINE_PANEL });

      // Retitle, in Title, the next stop after the tree.
      await page.keyboard.press('Tab');
      expect(await focused(page)).toMatch(/Title$/);
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Epsilon');
      await page.keyboard.press('Enter');
      await announced(page, 'Renamed Delta to Epsilon.');
      expect(await held(client, document)).toEqual([
        'Alpha',
        'Epsilon',
        ['Beta', 'Beta one'],
        'Gamma',
      ]);
      expect(await focused(page)).toMatch(/Title$/);
      await checkAxe(page, 'a section retitled', task.meta, { within: OUTLINE_PANEL });

      // Starts on, past Equation.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      expect(await focused(page)).toMatch(/^select:/);
      await page.keyboard.press('ArrowDown');
      await announced(page, 'Epsilon now starts on a new page.');
      const epsilon = find(nodesOf(await readDocument(client, document.id)), 'Epsilon');
      expect(epsilon.pageBreak).toBe('page');
      expect(await focused(page)).toMatch(/^select:/);
      await checkAxe(page, 'a section set to start on a new page', task.meta, {
        within: OUTLINE_PANEL,
      });

      // Remove, back in the tree: Delete, and the question answered.
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      expect(await focused(page)).toBe(`treeitem:${delta}`);
      await page.keyboard.press('Delete');
      await page.getByRole('group', { name: 'Confirm removal' }).waitFor();
      await checkAxe(page, 'the removal asked about', task.meta, { within: OUTLINE_PANEL });
      await page.keyboard.press('Enter');
      await announced(page, 'Removed Epsilon.');
      expect(await held(client, document)).toEqual(['Alpha', ['Beta', 'Beta one'], 'Gamma']);
      await vi.waitFor(async () => expect(await focused(page)).toBe(`treeitem:${alpha}`));
      await expect(item(tree, 'Alpha').getAttribute('aria-selected')).resolves.toBe('true');
      await checkAxe(page, 'a section removed', task.meta, { within: OUTLINE_PANEL });

      // And not one pointer press, from the first key to the last.
      expect((await actsOf(page)).pointer).toBe(0);
    });
  });

  it("STR-006 is edited by pointer: every operation, moves by the browser's own drag and drop, each read back from the service", async ({
    task,
  }) => {
    const client = api();
    const document = await makeDocument(client, 'The outline by pointer', START);
    const beta = find(nodesOf(document), 'Beta').id;
    await withPage(async (page) => {
      const tree = await open(page, document);
      const row = (label: string) => item(tree, label).locator('[data-row]').first();

      // Onto another node: its last child.
      await drag(page, row('Gamma'), () => row('Alpha').locator('[data-drop^="into:"]'));
      await announced(page, 'Moved Gamma under Alpha.');
      expect(await held(client, document)).toEqual([
        ['Alpha', 'Gamma'],
        ['Beta', 'Beta one'],
      ]);
      await checkAxe(page, 'a section dropped onto another', task.meta, { within: OUTLINE_PANEL });

      // Onto the gap before one: there, among its siblings.
      await drag(page, row('Gamma'), () => tree.locator(`[data-drop="before:${beta}"]`));
      await announced(page, 'Moved Gamma to the top level, after Alpha.');
      expect(await held(client, document)).toEqual(['Alpha', 'Gamma', ['Beta', 'Beta one']]);
      await checkAxe(page, 'a section dropped before another', task.meta, {
        within: OUTLINE_PANEL,
      });

      // Onto the end of the document.
      await drag(page, row('Alpha'), () => page.getByText('Move to the end of the document'));
      await announced(page, 'Moved Alpha after Beta.');
      expect(await held(client, document)).toEqual(['Gamma', ['Beta', 'Beta one'], 'Alpha']);
      await checkAxe(page, 'a section dropped at the end', task.meta, { within: OUTLINE_PANEL });

      // Insert: Alpha chosen by a click, **Add section** clicked, a title typed and **Add** clicked.
      await row('Alpha').click();
      await expect(item(tree, 'Alpha').getAttribute('aria-selected')).resolves.toBe('true');
      await page.getByRole('button', { name: 'Add section' }).click();
      await page.getByLabel('New section title').fill('Delta');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await announced(page, 'Added Delta.');
      expect(await held(client, document)).toEqual([
        'Gamma',
        ['Beta', 'Beta one'],
        'Alpha',
        'Delta',
      ]);
      await checkAxe(page, 'a section added by pointer', task.meta, { within: OUTLINE_PANEL });

      // Retitle: a click into **Title**, the words typed, and a click away, which commits them.
      const title = page.getByRole('textbox', { name: 'Title' });
      await title.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Epsilon');
      await page.locator('#document-title').click();
      await announced(page, 'Renamed Delta to Epsilon.');
      expect(await held(client, document)).toEqual([
        'Gamma',
        ['Beta', 'Beta one'],
        'Alpha',
        'Epsilon',
      ]);
      await checkAxe(page, 'a section retitled by pointer', task.meta, { within: OUTLINE_PANEL });

      // Starts on: the select clicked open and a choice made. Its list is drawn by the browser
      // outside the page, where no pointer event can reach, so the choice is made as the list makes
      // it - the option selected and the change announced to the page.
      const startsOn = page.getByLabel('Starts on');
      await startsOn.click();
      await startsOn.selectOption({ label: 'A new page' });
      await announced(page, 'Epsilon now starts on a new page.');
      const epsilon = find(nodesOf(await readDocument(client, document.id)), 'Epsilon');
      expect(epsilon.pageBreak).toBe('page');
      await checkAxe(page, 'a section set to start on a new page by pointer', task.meta, {
        within: OUTLINE_PANEL,
      });

      // Remove: **Remove section** clicked, and the question's **Remove** clicked.
      await page.getByRole('button', { name: 'Remove section' }).click();
      const question = page.getByRole('group', { name: 'Confirm removal' });
      await question.getByRole('button', { name: 'Remove', exact: true }).click();
      await announced(page, 'Removed Epsilon.');
      expect(await held(client, document)).toEqual(['Gamma', ['Beta', 'Beta one'], 'Alpha']);
      await checkAxe(page, 'a section removed by pointer', task.meta, { within: OUTLINE_PANEL });
    });
  });

  it('STR-006 is edited through the API: the same five operations, each a version', async () => {
    const client = api();
    let document = await makeDocument(client, 'The outline through the API', ['Alpha', 'Beta']);
    const versions = [document.version.number];

    document = await edit(client, document, {
      operation: 'insert',
      parent: null,
      position: 1,
      node: { type: 'section', title: words('Delta') },
    });
    versions.push(document.version.number);
    expect(shapeOf(nodesOf(document))).toEqual(['Alpha', 'Delta', 'Beta']);

    const delta = find(nodesOf(document), 'Delta').id;
    const beta = find(nodesOf(document), 'Beta').id;
    document = await edit(client, document, {
      operation: 'move',
      node: delta,
      parent: beta,
      position: 0,
    });
    versions.push(document.version.number);
    expect(shapeOf(nodesOf(document))).toEqual(['Alpha', ['Beta', 'Delta']]);

    document = await edit(client, document, {
      operation: 'retitle',
      node: delta,
      title: words('Epsilon'),
    });
    versions.push(document.version.number);
    expect(shapeOf(nodesOf(document))).toEqual(['Alpha', ['Beta', 'Epsilon']]);

    document = await edit(client, document, { operation: 'set', node: delta, pageBreak: 'page' });
    versions.push(document.version.number);
    expect(find(nodesOf(document), 'Epsilon').pageBreak).toBe('page');

    document = await edit(client, document, { operation: 'remove', node: delta });
    versions.push(document.version.number);
    expect(shapeOf(nodesOf(document))).toEqual(['Alpha', 'Beta']);

    // Each act one version, and the service holds what the last one made.
    expect(new Set(versions).size).toBe(versions.length);
    expect(await held(client, document)).toEqual(['Alpha', 'Beta']);
  });

  it("keeps both of two spaces typed in a section's title, stored and drawn (issue #325)", async () => {
    const client = api();
    const document = await makeDocument(client, 'The outline with two spaces', ['Alpha']);
    await withPage(async (page) => {
      await open(page, document);
      const title = page.getByRole('textbox', { name: 'Title' });
      await title.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Two  spaces');
      await page.keyboard.press('Enter');
      // The accessibility tree reads a sentence with its spaces collapsed, so only its start is sure.
      await announced(page, 'Renamed Alpha to Two');

      expect(titleOf(nodesOf(await readDocument(client, document.id))[0]!)).toBe('Two  spaces');
      // What keeps them: the field's own rule, which a browser computes and jsdom never did.
      expect(await title.evaluate((field) => getComputedStyle(field).whiteSpace)).toBe(
        'break-spaces',
      );
      // And what the author sees: `innerText` is the text as laid out, spaces collapsed or not.
      expect(await title.evaluate((field) => (field as HTMLElement).innerText)).toBe('Two  spaces');
    });
  });

  it('sends one move for two Alt+Down pressed before the first is answered', async () => {
    const client = api();
    const document = await makeDocument(client, 'The outline under a quick hand', [
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    await withPage(async (page) => {
      const tree = await open(page, document);
      // Every act the page sends is held until both keys are down, so the second lands while the
      // first is still in flight however quick the stack is.
      const sent: Route[] = [];
      let release: () => void = () => {};
      const released = new Promise<void>((resolve) => (release = resolve));
      await page.route('**/v1/documents/*/outline', async (route) => {
        sent.push(route);
        await released;
        await route.continue();
      });

      await tabIntoTree(page);
      await page.keyboard.press('Alt+ArrowDown');
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      await page.keyboard.press('Alt+ArrowDown');
      release();
      await announced(page, 'Moved Alpha after Beta.');
      await expect(tree.getAttribute('aria-busy')).resolves.toBe('false');

      expect(sent).toHaveLength(1);
      expect(await held(client, document)).toEqual(['Beta', 'Alpha', 'Gamma']);
    });
  });
});
