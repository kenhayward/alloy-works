import { randomUUID } from 'node:crypto';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, nodesOf, readDocument, titleOf } from './testing/api.js';
import { withPage } from './testing/page.js';
import { pondSurvey } from './testing/word.js';

/**
 * Importing a Word document in the pinned Chromium by the keyboard alone (the IM plan, IMe): the file
 * chosen in the Import dialog, read by the worker, a part renamed, the proposal accepted, and the
 * document it made read back. Uncited: the jsdom and service tests cite what each demonstrates.
 */

/** Tab pressed until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, most = 80) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

describe('importing a Word document, in Chromium', () => {
  it('imports a file by the keyboard alone, renames a part, accepts it, and makes its outline', async () => {
    const stamp = randomUUID().slice(0, 8);
    const file = pondSurvey(stamp, { outside: false });
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents`);
      await page.getByRole('heading', { name: 'Documents', level: 1 }).waitFor();
      await tabTo(page, page.getByRole('button', { name: 'Import', exact: true }));
      await page.keyboard.press('Enter');

      const dialog = page.getByRole('dialog');
      const input = dialog.getByLabel('File');
      await input.waitFor();
      await tabTo(page, input);
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('Space');
      await (
        await chooser
      ).setFiles({ name: file.name, mimeType: 'application/octet-stream', buffer: file.bytes });
      await tabTo(page, dialog.getByRole('button', { name: 'Import file' }));
      await page.keyboard.press('Enter');

      // The worker reads it; the page follows until it proposes.
      const outline = page.getByRole('list', { name: 'Proposed outline' });
      const results = outline.getByRole('button', { name: 'Component: Results' });
      await results.waitFor({ timeout: 60_000 });
      await tabTo(page, results);
      await page.keyboard.press('Enter');
      await page.getByRole('region', { name: /^Part \d+ of \d+: Results$/ }).waitFor();

      const title = page.getByRole('textbox', { name: 'Part title' });
      await tabTo(page, title);
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Findings');
      await page.keyboard.press('Enter');
      await outline.getByRole('button', { name: 'Component: Findings' }).waitFor();

      const named = page.getByRole('textbox', { name: 'Document title' });
      await tabTo(page, named);
      await page.keyboard.press('Control+A');
      await page.keyboard.type(`Pond survey ${stamp}`);
      await page.keyboard.press('Enter');

      // Accepted, the document it made opens, its outline the proposal as reviewed.
      await page.waitForURL(/#\/documents\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      // Its title is the outline tree's root, the page's heading (DocumentPage), not a level 1.
      await page.locator('#document-title', { hasText: `Pond survey ${stamp}` }).waitFor();
      const tree = page.getByRole('tree', { name: 'Outline' });
      // A section by its title; a component by its title and its mode (tree.ts, nodeLabel).
      await tree.getByRole('treeitem', { name: 'Methods', exact: true }).waitFor();
      for (const name of ['Sampling', 'Findings']) {
        await tree.getByRole('treeitem', { name: `${name}, latest`, exact: true }).waitFor();
      }
      const id = /#\/documents\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
      const made = await readDocument(api(), id);
      const nodes = nodesOf(made);
      expect(nodes.map(titleOf)).toEqual(['Methods']);
      expect(nodes[0]!.children.map((node) => node.type)).toEqual(['reference', 'reference']);
    });
  });
});
