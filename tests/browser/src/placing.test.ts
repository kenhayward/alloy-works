import type { Locator, Page } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace, makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * Placing and changing a value in the pinned Chromium (the B2 plan, task 5), against the development
 * source the `sources` profile runs: a value placed from the Value dialog by the keyboard alone in a
 * component open in a document, resolved at once from the editing session, and the warning a change
 * that loses a document's value gives, each held to axe.
 */

const READER = { account: 'reader', password: 'source-reader-dev-password' };

/** A connection to the source, a definition of a site's depth, and a document placing a component. */
async function placeComponent(client: Client): Promise<{ document: string; title: string }> {
  const space = await generalSpace(client);
  const stamp = new Date().toISOString();
  const connection = await client.POST('/v1/spaces/{space}/connections', {
    params: { path: { space } },
    body: {
      settings: {
        schemaVersion: 1,
        name: `Placing source ${stamp}`,
        description: 'The development source.',
        type: 'postgres',
        source: {
          host: 'source-postgres',
          port: 5432,
          database: 'readings',
          account: READER.account,
          tls: 'require',
        },
        identity: { kind: 'service' },
        retired: false,
      },
    },
  });
  if (!connection.data) throw new Error(`a connection answered ${connection.response.status}`);
  const credential = await client.PUT('/v1/connections/{id}/credential', {
    params: { path: { id: connection.data.id } },
    body: { secret: READER.password },
  });
  if (!credential.data) throw new Error(`its credential answered ${credential.response.status}`);
  const title = `Placed depth ${stamp}`;
  const definition = await client.POST('/v1/spaces/{space}/query-definitions', {
    params: { path: { space } },
    body: {
      definition: {
        schemaVersion: 1,
        title,
        description: 'One site, by its id.',
        connection: connection.data.id,
        parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
        fetch: {
          kind: 'sql',
          text: 'select id, depth from sample.site where id = {{site}} order by id',
        },
        columns: [
          {
            name: 'depth',
            from: { column: 'depth' },
            type: { base: 'decimal', precision: 8, scale: 2 },
          },
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
        ],
        key: ['id'],
        order: [{ column: 'id', direction: 'ascending' }],
        empty: 'valid',
        limits: { rows: 100, bytes: 65_536, seconds: 10 },
        retired: false,
      },
    } as never,
  });
  if (!definition.data) throw new Error(`a definition answered ${definition.response.status}`);
  const component = await makeComponent(client, 'Placed depth', [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'The depth at the weir is', marks: [] }],
    },
  ]);
  let document = await makeDocument(client, 'Placed depth report', []);
  document = await edit(client, document, {
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  void nodesOf(document);
  return { document: document.id, title };
}

/** Tab pressed until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, most = 40) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

describe('placing and changing a value, in Chromium (the B2 plan, task 5)', () => {
  let placed: { document: string; title: string };
  beforeAll(async () => {
    placed = await placeComponent(api());
  });

  it('DAT-022 the browser shows Runs as in the Value dialog', async ({ task }) => {
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
      await page.keyboard.press('Control+Shift+6');

      // The dialog by the keyboard alone: the search, the definition, its parameter, its column.
      const dialog = page.getByRole('dialog', { name: 'Value' });
      await dialog.waitFor();
      await page.keyboard.type(placed.title);
      const definition = dialog.getByRole('radio', { name: new RegExp(placed.title) });
      await definition.waitFor();
      expect(
        await definition.evaluate((element) => element.closest('label')?.textContent),
      ).toContain('Runs as the service account');
      await checkAxe(page, 'the Value dialog', task.meta, { shows: dialog });
      await page.keyboard.press('Tab');
      await page.keyboard.press('Space');
      await dialog.getByText('Runs as the service account.').waitFor();
      const site = dialog.getByLabel('site', { exact: true });
      await tabTo(page, site);
      await page.keyboard.type('1');
      await tabTo(page, dialog.getByRole('button', { name: 'Insert' }));
      await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'hidden' });

      // Resolved at once from the editing session: the value shows where it was placed.
      await expect
        .poll(async () => (await surface.locator('[data-binding]').textContent()) ?? '', {
          timeout: 20_000,
        })
        .toContain('12.50');

      // Changed so it loses the document's value: the dialog says so before Change.
      const panel = page.getByRole('region', { name: 'Value' });
      await panel.getByRole('button', { name: 'Change' }).click();
      await dialog.waitFor();
      const again = dialog.getByLabel('site', { exact: true });
      await again.fill('2');
      const warning = dialog.getByText(/will hold no value for it until resolved again/);
      await warning.waitFor();
      expect(await warning.textContent()).toMatch(
        /^One document will hold no value for it until resolved again: Placed depth report .+\.$/,
      );
      await checkAxe(page, 'the Value dialog warning of a change', task.meta, {
        shows: [dialog, warning],
      });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    });
  });
});
