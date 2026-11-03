import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, makeDocument, readDocument } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { withPage } from './testing/page.js';

/**
 * Moving a document to another space in the pinned Chromium (the MV plan): the Document menu's command,
 * what the dialog says first, Axe on it, and the page showing the space it moved to. Uncited: the HTTP
 * and jsdom tests cite what is demonstrated.
 */
describe('moving a document to another space, in Chromium', () => {
  it('says first what would come along, then moves it and shows where it went', async ({
    task,
  }) => {
    const client = api();
    const stamp = new Date().toISOString();
    const space = await client.POST('/v1/spaces', { body: { name: `Moved to ${stamp}` } });
    if (!space.data) throw new Error(`making a space answered ${space.response.status}`);
    const made = await makeDocument(client, `To be moved ${stamp}`, ['Introduction']);

    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${made.id}`);
      await page
        .getByRole('menubar')
        .getByRole('menuitem', { name: 'Document', exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Move to another space...' }).click();
      const dialog = page.getByRole('dialog', { name: 'Move to another space' });
      await dialog.getByRole('combobox', { name: 'Move to' }).selectOption(space.data.id);
      await dialog.getByText('This moves one item.').waitFor();

      await checkAxe(page, 'the Move dialog', task.meta, { shows: [dialog] });
      const look = process.env['ALLOY_BROWSER_MOVE_LOOK'];
      if (look !== undefined) writeFileSync(look, await page.screenshot());

      await dialog.getByRole('button', { name: 'Move', exact: true }).click();
      await page.getByText(/^Moved one item to /).waitFor();
    });
    expect((await readDocument(client, made.id)).space.id).toBe(space.data.id);
  });
});
