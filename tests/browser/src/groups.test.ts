import { describe, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { withPage } from './testing/page.js';

/**
 * Administration's Groups in a browser, as Ada (the AD plan, AD6): a group made, its Members in the
 * side panel, and Delete asking first, each passing axe in Light and Dark and worked by keyboard. The
 * group is the test's own, so nothing else is touched.
 */
describe("Administration's Groups in a browser", () => {
  it('passes axe on a group made, its members in the side panel, and deleting it after asking', async ({
    task,
  }) => {
    const name = `Reviewers ${Date.now()}`;
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/admin/groups`);
      const administration = page.getByRole('region', { name: 'Administration' });
      await administration.getByRole('button', { name: 'New group' }).press('Enter');
      const making = page.getByRole('dialog', { name: 'New group' });
      await making.getByRole('textbox', { name: 'Name' }).waitFor();
      await page.keyboard.type(name);
      await making.getByRole('button', { name: 'Make group' }).press('Enter');
      await administration.getByText(`Made the group ${name}.`, { exact: true }).waitFor();

      const table = administration.getByRole('table', { name: 'Groups' });
      await table.getByRole('button', { name: `Members of ${name}` }).press('Enter');
      const panel = page.getByRole('complementary', { name: `Members of ${name}` });
      const people = panel.getByRole('checkbox').first();
      await people.waitFor();
      await checkAxe(page, "Administration, a group's members", task.meta, { shows: people });
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });

      await table.getByRole('button', { name: `More actions for ${name}` }).press('Enter');
      await page.getByRole('menuitem', { name: 'Delete' }).press('Enter');
      const asking = page.getByRole('dialog', { name: `Delete ${name}?` });
      await asking.getByRole('button', { name: 'Delete group' }).waitFor();
      await checkAxe(page, 'Administration, deleting a group', task.meta, {
        shows: asking.getByRole('button', { name: 'Delete group' }),
      });
      await asking.getByRole('button', { name: 'Delete group' }).press('Enter');
      await administration
        .getByText(`Deleted the group ${name}, and everything granted to it.`, { exact: true })
        .waitFor();
    });
  });
});
