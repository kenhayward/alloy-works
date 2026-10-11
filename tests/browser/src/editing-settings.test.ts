import { describe, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { withPage } from './testing/page.js';

/**
 * Administration's Editing in a browser, as Ada (the PL plan, PL3): the lock's two periods and the
 * window saved changes are kept, passing axe in Light and Dark. It reads and changes nothing.
 */
describe("Administration's Editing in a browser", () => {
  it('passes axe on the editing settings', async ({ task }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/admin/editing`);
      const field = page.getByRole('region', { name: 'Administration' }).getByLabel(/A lock lasts/);
      await field.waitFor();
      await checkAxe(page, 'Administration, editing settings', task.meta, { shows: field });
    });
  });
});
