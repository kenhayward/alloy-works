import { describe, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { withPage } from './testing/page.js';

/**
 * Administration's Overview, the environment's Access beside it, Roles as a grid and About with its
 * release notes, in a browser as Ada (the AD plan, AD7), each passing axe in Light and Dark.
 */
describe("Administration's Overview, Roles and About in a browser", () => {
  it("passes axe on the environment's Access in the side panel, Roles as a grid and About", async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/admin/overview`);
      const administration = page.getByRole('region', { name: 'Administration' });
      const manage = administration.getByRole('button', {
        name: 'Manage access to the whole environment',
      });
      await manage.press('Enter');
      const panel = page.getByRole('complementary', { name: 'Access to the whole environment' });
      const level = panel.getByRole('region', { name: 'The whole environment', exact: true });
      await level.waitFor();
      await checkAxe(page, "Administration, the environment's access", task.meta, {
        shows: level,
      });
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });

      await page.goto(`${SERVICE}/#/admin/roles`);
      const grid = administration.getByRole('table', { name: 'Roles' });
      await grid.getByRole('row').nth(1).waitFor();
      await checkAxe(page, 'Administration, Roles as a grid', task.meta, { shows: grid });

      await page.goto(`${SERVICE}/#/admin/about`);
      const notes = administration.getByRole('heading', { name: /^What changed in / });
      await notes.waitFor();
      await checkAxe(page, 'Administration, About', task.meta, { shows: notes });
    });
  });
});
