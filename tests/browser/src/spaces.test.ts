import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { withPage } from './testing/page.js';

/**
 * A space made, renamed, archived and restored from Administration's Spaces by keyboard alone, as Ada,
 * who administers development (the SP1 plan, task 3): archived, it is gone from New component's
 * choice of where; restored, it is back. The space is the test's own, so General is never touched.
 */

/** Administration's Spaces, opened from the module rail's foot by keyboard, then its menu. */
async function openSpaces(page: Page) {
  await page.goto(`${SERVICE}/#/`);
  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: 'Admin' })
    .press('Enter');
  const administration = page.getByRole('region', { name: 'Administration' });
  await administration
    .getByRole('navigation', { name: 'Sections of Administration' })
    .getByRole('link', { name: /^Spaces/ })
    .press('Enter');
  await administration.getByRole('table', { name: 'Spaces' }).waitFor();
  return administration;
}

/** The names New component offers as where a component may be made. */
async function offeredWhere(page: Page): Promise<string[]> {
  await page.goto(`${SERVICE}/#/components`);
  await page.getByRole('button', { name: 'New component' }).press('Enter');
  const where = page.getByRole('dialog', { name: 'New component' }).getByLabel('Where');
  await where.getByRole('option').first().waitFor({ state: 'attached' });
  const offered = await where.getByRole('option').allTextContents();
  await page.keyboard.press('Escape');
  return offered;
}

describe("Administration's Spaces in a browser", () => {
  it('ADM-049 makes, renames, archives and restores a space by keyboard, and an archived space is not offered to create in', async ({
    task,
  }) => {
    const made = `Made ${Date.now()}`;
    const renamed = `${made} renamed`;
    await withPage(async (page) => {
      let administration = await openSpaces(page);
      const status = (said: string) => administration.getByText(said, { exact: true }).waitFor();

      await administration.getByRole('button', { name: 'New space' }).press('Enter');
      const making = page.getByRole('dialog', { name: 'New space' });
      await making.getByRole('textbox', { name: 'Name' }).waitFor();
      await checkAxe(page, 'Administration, a new space', task.meta, {
        shows: making.getByRole('button', { name: 'Make space' }),
      });
      // Focus starts on the name.
      await page.keyboard.type(made);
      await page.keyboard.press('Enter');
      await status(`Made the space ${made}.`);

      await administration.getByRole('button', { name: `Rename ${made}` }).press('Enter');
      await page.getByRole('dialog', { name: `Rename ${made}` }).waitFor();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type(renamed);
      await page.keyboard.press('Enter');
      await status(`Renamed ${made} to ${renamed}.`);

      // Archive is under the row's More actions, a menu opened on its first item.
      await administration
        .getByRole('button', { name: `More actions for ${renamed}` })
        .press('Enter');
      await page.getByRole('menuitem', { name: 'Archive' }).press('Enter');
      const archiving = page.getByRole('dialog', { name: `Archive ${renamed}?` });
      await checkAxe(page, 'Administration, archiving a space', task.meta, {
        shows: archiving.getByRole('button', { name: 'Archive space' }),
      });
      await archiving.getByRole('button', { name: 'Archive space' }).press('Enter');
      await status(`Archived ${renamed}.`);
      await page.keyboard.press('Escape');

      expect(await offeredWhere(page)).not.toContain(renamed);

      administration = await openSpaces(page);
      await administration.getByRole('button', { name: `Restore ${renamed}` }).press('Enter');
      await page
        .getByRole('dialog', { name: `Restore ${renamed}?` })
        .getByRole('button', { name: 'Restore space' })
        .press('Enter');
      await status(`Restored ${renamed}.`);
      await page.keyboard.press('Escape');

      // Its Access, in the side panel beside the list; Escape closes it.
      await administration
        .getByRole('button', { name: `Access to the space ${renamed}` })
        .press('Enter');
      const panel = page.getByRole('complementary', { name: `Access to ${renamed}` });
      await panel.getByRole('region', { name: `The space ${renamed}`, exact: true }).waitFor();
      await checkAxe(page, "Administration, a space's access", task.meta, {
        shows: panel.getByRole('region', { name: `The space ${renamed}`, exact: true }),
      });
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });

      expect(await offeredWhere(page)).toContain(renamed);
    });
  });
});
