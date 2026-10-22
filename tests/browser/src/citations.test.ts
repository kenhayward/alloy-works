import type { Locator, Page } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace, makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * Citing in the pinned Chromium (the CI plan, CId), by the keyboard alone: an entry of the General
 * space cited from the Cite dialog with a locator, drawn in its in-text form as the service renders it,
 * and the document published under the default layout, which places a bibliography. Axe on the dialog.
 * Uncited: the jsdom and service tests cite what each demonstrates.
 */

/** An entry in General, made despite any match a run before left, and a document placing a component. */
async function placeComponent(
  client: Client,
): Promise<{ document: string; key: string; family: string }> {
  const space = await generalSpace(client);
  const stamp = new Date().toISOString();
  // A family name of its own per run, so the search finds this run's entry alone.
  const family = `Marlow${stamp.replace(/\D/g, '')}`;
  const entry = await client.POST('/v1/spaces/{space}/bibliography-entries', {
    params: { path: { space } },
    body: {
      entry: {
        csl: {
          type: 'book',
          title: 'Sediment and its movement',
          author: [{ family, given: 'Ada' }],
          issued: { 'date-parts': [[2020]] },
          publisher: 'Harbour Press',
        },
      },
      despiteMatches: true,
    } as never,
  });
  if (!entry.data?.entry) throw new Error(`an entry answered ${entry.response.status}`);
  const component = await makeComponent(client, 'Sediment', [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'Sediment moves with the tide', marks: [] }],
    },
  ]);
  let document = await makeDocument(client, 'Citing', ['Sources']);
  document = await edit(client, document, {
    operation: 'insert',
    parent: nodesOf(document)[0]!.id,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  return { document: document.id, key: entry.data.entry.entry.key, family };
}

/** Tab pressed until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, most = 60) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

describe('citing in Chromium (the CI plan, CId)', () => {
  let placed: { document: string; key: string; family: string };
  beforeAll(async () => {
    placed = await placeComponent(api());
  });

  it('cites an entry with a locator from the Cite dialog, shows its in-text form, and publishes, by the keyboard', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${placed.document}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const text = page.getByRole('region', { name: "The document's text" });
      const opens = text.locator('[data-opens="true"]').first();
      await opens.waitFor();
      await opens.focus();
      await page.keyboard.press('Enter');
      const surface = page.getByRole('textbox', { name: /^Content of / });
      await surface.waitFor();
      await surface.focus();
      await page.keyboard.press('End');
      await page.keyboard.press('Control+Shift+2');

      // The dialog: the search has the focus; the entry found by its author is chosen.
      const dialog = page.getByRole('dialog', { name: 'Cite' });
      await dialog.waitFor();
      const search = dialog.getByRole('searchbox', { name: 'Find an entry' });
      await search.waitFor();
      expect(await search.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.type(placed.family);
      const chosen = dialog.getByRole('radio', { name: new RegExp(placed.key) });
      await chosen.waitFor();
      expect(await chosen.isChecked()).toBe(true);
      const locator = dialog.getByRole('textbox', { name: /Locator/ });
      await tabTo(page, locator);
      await page.keyboard.type('p. 4');
      await checkAxe(page, 'the Cite dialog', task.meta, { shows: [dialog, chosen] });
      // Enter in the locator cites it.
      await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'hidden' });

      // Drawn in Harvard's in-text form, the default theme's, as the service renders it.
      await expect
        .poll(async () => (await surface.locator('[data-citation]').textContent()) ?? '', {
          timeout: 20_000,
        })
        .toContain(placed.family);
      expect(await surface.locator('[data-citation]').textContent()).toContain('4');

      // Done, from the Formatting toolbar's one stop.
      const done = page.getByRole('button', { name: 'Done editing' });
      await tabTo(
        page,
        page.getByRole('toolbar', { name: 'Formatting' }).locator('button[tabindex="0"]'),
      );
      await page.keyboard.press('Home');
      await expect
        .poll(() => done.evaluate((element) => element === document.activeElement))
        .toBe(true);
      await page.keyboard.press('Enter');
      await surface.waitFor({ state: 'hidden' });

      // Published, from the Publishing panel: Tab to the panels' one stop, End to choose the last.
      const panels = page.getByRole('tablist', { name: 'Document panels' });
      await tabTo(page, panels.getByRole('tab', { selected: true }), 120);
      await page.keyboard.press('End');
      const publish = page.getByRole('button', { name: /^Publish as/ }).first();
      await tabTo(page, publish, 120);
      await page.keyboard.press('Enter');
      await page.getByRole('link', { name: 'Open the publication' }).waitFor({ timeout: 120_000 });
    });
  });
});
