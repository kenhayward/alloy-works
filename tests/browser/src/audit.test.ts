import { describe, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { withPage } from './testing/page.js';

/**
 * Administration's Audit log in a browser, as Ada (the AU2 plan, AU2b): the log read, then filtered
 * to her own sign-ins from a row and exported, each passing axe in Light and Dark. It changes nothing
 * but the log, which records the export.
 */
describe("Administration's Audit log in a browser", () => {
  it('passes axe on the log, the log filtered to what one person did, and its export written', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/admin/audit`);
      const administration = page.getByRole('region', { name: 'Administration' });
      const table = administration.getByRole('table', { name: 'Audit log' });
      const first = table.getByRole('button', { name: /^Only what .+ did$/ }).first();
      await first.waitFor();
      await checkAxe(page, 'Administration, the audit log', task.meta, { shows: table });

      await first.press('Enter');
      const clear = administration.getByRole('button', { name: /^Stop showing only what .+ did$/ });
      await clear.waitFor();
      await administration
        .getByRole('combobox', { name: 'What happened' })
        .selectOption('authentication.');
      await table.waitFor();
      await checkAxe(page, 'Administration, the audit log filtered', task.meta, { shows: clear });

      // Exported as filtered, written by the stack's worker.
      await administration.getByRole('button', { name: 'Export' }).press('Enter');
      const download = administration.getByRole('button', { name: 'Download export' });
      await download.waitFor({ timeout: 30_000 });
      await checkAxe(page, 'Administration, the audit log exported', task.meta, {
        shows: download,
      });
    });
  });
});
