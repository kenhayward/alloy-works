import { describe, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { withPage } from './testing/page.js';

/**
 * Administration's People in a browser, as Ada (the AD plan, AD5): the people, a person's tokens in
 * the side panel, the waiting invitations and Invite people, each passing axe in Light and Dark and
 * reached by keyboard.
 */
describe("Administration's People in a browser", () => {
  it('passes axe on People, a person in the side panel, the waiting invitations and Invite people', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/admin/people`);
      const administration = page.getByRole('region', { name: 'Administration' });
      const people = administration.getByRole('table', { name: 'People' });
      const first = people.getByRole('row').nth(1);
      await first.waitFor();
      await checkAxe(page, 'Administration, People', task.meta, { shows: first });

      await people.getByRole('button', { name: 'API tokens of Ada' }).press('Enter');
      const panel = page.getByRole('complementary', { name: 'Ada' });
      const tokens = panel
        .getByRole('list', { name: 'Tokens of Ada' })
        .or(panel.getByText('Ada has no API tokens.'));
      await tokens.waitFor();
      await checkAxe(page, 'Administration, a person', task.meta, { shows: tokens });
      await page.keyboard.press('Escape');
      await panel.waitFor({ state: 'detached' });

      await administration.getByRole('tab', { name: /^Waiting invitations/ }).press('Enter');
      const waiting = administration
        .getByRole('table', { name: 'Waiting invitations' })
        .or(administration.getByText('Nobody is waiting to accept an invitation.'));
      await waiting.waitFor();
      await checkAxe(page, 'Administration, waiting invitations', task.meta, { shows: waiting });

      await administration.getByRole('button', { name: 'Invite people' }).press('Enter');
      const inviting = page.getByRole('dialog', { name: 'Invite people' });
      await inviting.getByRole('button', { name: 'Invite' }).waitFor();
      await checkAxe(page, 'Administration, inviting people', task.meta, {
        shows: inviting.getByRole('button', { name: 'Invite' }),
      });
      await page.keyboard.press('Escape');
    });
  });
});
