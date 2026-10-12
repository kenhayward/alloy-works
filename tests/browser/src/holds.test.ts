import type { Page } from 'playwright-core';
import { describe, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { withPage } from './testing/page.js';

/**
 * A legal hold placed on a space from Administration's Spaces and released from Legal holds, by
 * keyboard, as Ada, who administers development (the AH plan, Task 2). The space is the test's own.
 */

/** A section of Administration, opened from the module rail's foot by keyboard. */
async function openSection(page: Page, section: RegExp) {
  await page.goto(`${SERVICE}/#/`);
  await page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: 'Admin' })
    .press('Enter');
  const administration = page.getByRole('region', { name: 'Administration' });
  await administration
    .getByRole('navigation', { name: 'Sections of Administration' })
    .getByRole('link', { name: section })
    .press('Enter');
  return administration;
}

describe('Legal holds in a browser', () => {
  it('LIF-022 places a hold on a space and releases it, each asking why, by keyboard', async ({
    task,
  }) => {
    const space = `Held ${Date.now()}`;
    await withPage(async (page) => {
      let administration = await openSection(page, /^Spaces/);
      await administration.getByRole('table', { name: 'Spaces' }).waitFor();
      await administration.getByRole('button', { name: 'New space' }).press('Enter');
      await page.getByRole('dialog', { name: 'New space' }).getByRole('textbox').waitFor();
      await page.keyboard.type(space);
      await page.keyboard.press('Enter');
      await administration.getByText(`Made the space ${space}.`, { exact: true }).waitFor();

      await administration
        .getByRole('button', { name: `More actions for ${space}` })
        .press('Enter');
      await page.getByRole('menuitem', { name: 'Place a hold' }).press('Enter');
      const placing = page.getByRole('dialog', { name: `Place a hold on ${space}` });
      await checkAxe(page, 'Administration, placing a hold', task.meta, {
        shows: placing.getByRole('button', { name: 'Place hold' }),
      });
      // Focus starts on the reason.
      await page.keyboard.type('Matter 2026-14');
      await placing.getByRole('button', { name: 'Place hold' }).press('Enter');
      await administration.getByText(`Placed a hold on ${space}.`, { exact: true }).waitFor();

      administration = await openSection(page, /^Legal holds/);
      const table = administration.getByRole('table', { name: 'Legal holds' });
      const row = table.getByRole('row').filter({ hasText: space });
      await row.getByText('In force').waitFor();
      await checkAxe(page, 'Administration, Legal holds', task.meta, { shows: row });

      await row.getByRole('button', { name: `Release the hold on ${space}` }).press('Enter');
      const releasing = page.getByRole('dialog', { name: `Release the hold on ${space}` });
      await checkAxe(page, 'Administration, releasing a hold', task.meta, {
        shows: releasing.getByRole('button', { name: 'Release hold' }),
      });
      await page.keyboard.type('Matter closed');
      await releasing.getByRole('button', { name: 'Release hold' }).press('Enter');
      await administration.getByText(`Released the hold on ${space}.`, { exact: true }).waitFor();
      await row.getByText('Released', { exact: true }).waitFor();
      await checkAxe(page, 'Administration, Legal holds after a release', task.meta, {
        shows: row.getByText('Released', { exact: true }),
      });
    });
  });
});
