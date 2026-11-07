import { expect, it, describe } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * Duplicate redrawn, in the pinned Chromium (the duplicate handoff; ADR-0103): a document's starting
 * points as cards, its components listed with a switch each, an exception set by the keyboard and
 * cleared by another starting point, held to axe, and the dialog never scrolling with the list open.
 */

const para = (id: string, text: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value: text, marks: [] }],
});

describe("a document's Duplicate, in Chromium (ADR-0103)", () => {
  it('REU-057 starts from a card, sets one component the other way by the keyboard, and never scrolls, held to axe', async ({
    task,
  }) => {
    const client = api();
    const own = await makeComponent(client, 'Duplicate own part', [para('o1', 'Own words.')]);
    const shared = await makeComponent(client, 'Duplicate shared part', [
      para('s1', 'Shared words.'),
    ]);
    const place = (component: string, position: number) => ({
      operation: 'insert' as const,
      parent: null,
      position,
      node: { type: 'reference' as const, component, mode: { kind: 'latest' as const } },
    });
    await edit(client, await makeDocument(client, 'Placing it too', []), place(shared.id, 0));
    let original = await makeDocument(client, 'To duplicate', []);
    original = await edit(client, original, place(own.id, 0));
    original = await edit(client, original, place(shared.id, 1));

    await withPage(async (page) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${SERVICE}/#/documents`);
      await page.getByLabel('Sort by').selectOption({ label: 'Newest changed first' });
      await page
        .getByRole('button', { name: `More actions for ${original.outline.title}` })
        .click();
      const duplicating = page.getByRole('menuitem', { name: 'Duplicate...', exact: true });
      await expect.poll(() => duplicating.getAttribute('aria-disabled')).toBe('false');
      await duplicating.click();
      const dialog = page.getByRole('dialog', { name: 'Duplicate this document' });
      const starts = dialog.getByRole('group', { name: /^Components: start from/ });
      await starts.waitFor();
      const toggle = dialog.getByRole('button', { name: /1 copied 1 reused/ });
      await toggle.waitFor();
      await checkAxe(page, "Duplicate's starting points", task.meta, { shows: starts });

      await toggle.click();
      const list = dialog.getByRole('list', { name: 'Components' });
      await list.waitFor();
      await checkAxe(page, "Duplicate's components and their switches", task.meta, {
        shows: list,
      });
      // With the list open, the dialog fits the window and only the list may scroll.
      const fits = await page.evaluate(() => {
        const box = document.querySelector('[role="dialog"]')!;
        const scrim = box.parentElement!;
        return {
          dialog: box.scrollHeight <= box.clientHeight,
          scrim: scrim.scrollHeight <= scrim.clientHeight,
          bottom: box.getBoundingClientRect().bottom <= window.innerHeight,
        };
      });
      expect(fits).toEqual({ dialog: true, scrim: true, bottom: true });

      // In a switch, an arrow moves between Copy and Reuse: an exception.
      const switched = list.getByRole('radiogroup', { name: /^In the copy, Duplicate own part/ });
      await switched.getByRole('radio', { name: 'Copy' }).focus();
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(() => switched.getByRole('radio', { name: 'Reuse' }).isChecked())
        .toBe(true);
      await dialog.getByText('1 exception').waitFor();
      await dialog.getByRole('button', { name: /0 copied 2 reused/ }).waitFor();

      // Another starting point clears it.
      await starts.getByRole('radio', { name: /^Copy every component/ }).check();
      await expect.poll(() => dialog.getByText('1 exception').count()).toBe(0);
      await dialog.getByRole('button', { name: /2 copied 0 reused/ }).waitFor();

      await dialog.getByText(/^Into .*, as a new Draft\.$/).waitFor();
      await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
      await page.getByText(`Duplicated as ${original.outline.title} (copy).`).waitFor();
    });
  });
});
