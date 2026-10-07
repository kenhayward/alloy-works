import type { Locator, Page } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, nodesOf, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace, makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * A document's parameter feeding a value in the pinned Chromium (the TP2 plan, task 3), against the
 * development source the `sources` profile runs, by the keyboard alone: a document made from
 * development's Report with its `period`; a value placed from the Value dialog taking its date From the
 * document, `period` chosen among the parameters offered; `period` changed in the Parameters panel; the
 * Data tab saying which parameter changed the value; resolved again, and published. Axe on the dialog
 * and the tab. Uncited: the jsdom tests cite what a person sees.
 */

const READER = { account: 'reader', password: 'source-reader-dev-password' };

/** A definition of the site opened on a date, and a Report document placing a component to hold it. */
async function placeComponent(client: Client): Promise<{ document: string; title: string }> {
  const space = await generalSpace(client);
  const stamp = new Date().toISOString();
  const connection = await client.POST('/v1/spaces/{space}/connections', {
    params: { path: { space } },
    body: {
      settings: {
        schemaVersion: 1,
        name: `Period source ${stamp}`,
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
  const title = `Opened on ${stamp}`;
  const definition = await client.POST('/v1/spaces/{space}/query-definitions', {
    params: { path: { space } },
    body: {
      definition: {
        schemaVersion: 1,
        title,
        description: 'The site opened on a date.',
        connection: connection.data.id,
        parameters: [{ name: 'on', type: { base: 'date' }, required: true, list: false }],
        fetch: {
          kind: 'sql',
          text: 'select id, name from sample.site where opened = {{on}} order by id',
        },
        // The name first, so the dialog takes it unless another column is chosen.
        columns: [
          { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
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
  const component = await makeComponent(client, 'Site opened', [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'The site opened in the period is', marks: [] }],
    },
  ]);
  const { data: templates } = await client.GET('/v1/templates', {
    params: { query: { limit: '100' } },
  });
  const report = templates?.items.find((each) => each.name === 'Report');
  if (!report) throw new Error('The development environment has no Report template');
  const made = await client.POST('/v1/spaces/{space}/documents', {
    params: { path: { space } },
    body: {
      title: `Opened in the period ${stamp}`,
      language: 'en-GB',
      direction: 'ltr',
      template: report.id,
      parameters: { period: '2024-03-01' },
    } as never,
  });
  if (!made.data) throw new Error(`making a document answered ${made.response.status}`);
  const first = nodesOf(made.data)[0];
  const document = await edit(client, made.data, {
    operation: 'insert',
    parent: first?.id ?? null,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  return { document: document.id, title };
}

/** Tab pressed until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, most = 60) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

describe("a document's parameter feeding a value, in Chromium (the TP2 plan, task 3)", () => {
  let placed: { document: string; title: string };
  beforeAll(async () => {
    placed = await placeComponent(api());
  });

  it('places a value taking the period From the document, says in the Data tab that the period changed it, and publishes it resolved again, by the keyboard', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${placed.document}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      // The Parameters panel has read the template's declarations before the dialog is opened.
      const parameters = page.getByRole('region', { name: 'Parameters' });
      await parameters.getByLabel('period', { exact: true }).waitFor();
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

      // The dialog: the definition, then its date From the document, the period chosen.
      const dialog = page.getByRole('dialog', { name: 'Value' });
      await dialog.waitFor();
      await page.keyboard.type(placed.title);
      await dialog.getByRole('radio', { name: new RegExp(placed.title) }).waitFor();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Space');
      const fromDocument = dialog.getByRole('checkbox', { name: 'Take on from the document' });
      await fromDocument.waitFor();
      await tabTo(page, fromDocument);
      await page.keyboard.press('Space');
      const chosen = dialog.getByRole('combobox', { name: 'Document parameter for on' });
      await chosen.waitFor();
      // Report's date parameters fed to values, issued and period, and nothing else of its own.
      expect(await chosen.locator('option').allTextContents()).toEqual(['issued', 'period']);
      await tabTo(page, chosen);
      await page.keyboard.press('ArrowDown');
      expect(await chosen.inputValue()).toBe('period');
      // Within the dialog: the modal leaves the text behind it inert, and a Report's text scrolls, which
      // axe would call a scrollable region with nothing to focus.
      await checkAxe(page, 'the Value dialog taking a parameter From the document', task.meta, {
        within: '[role="dialog"]',
        shows: [dialog, chosen],
      });
      await tabTo(page, dialog.getByRole('button', { name: 'Insert' }));
      await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'hidden' });

      // Resolved at once with the document's period.
      await expect
        .poll(async () => (await surface.locator('[data-binding]').textContent()) ?? '', {
          timeout: 20_000,
        })
        .toContain('North weir');
      const done = page.getByRole('button', { name: 'Done editing' });
      await tabTo(page, done);
      await page.keyboard.press('Enter');
      await surface.waitFor({ state: 'hidden' });

      // The period changed in the Parameters panel. Filled, not typed: a date control orders its
      // parts by the browser's own language, as the TP1 test says.
      const period = parameters.getByLabel('period', { exact: true });
      await tabTo(page, period);
      await period.fill('2024-05-17');

      // The Data tab says which parameter changed the value.
      const tab = page.getByRole('tab', { name: 'Data' });
      await page.getByRole('tab', { name: 'Contents' }).focus();
      await page.keyboard.press('ArrowRight');
      expect(await tab.getAttribute('aria-selected')).toBe('true');
      const row = page.locator('li[data-binding]').first();
      await row.getByText("The document's period changed").waitFor({ timeout: 20_000 });
      expect(await row.textContent()).toContain('Changed since resolved');
      await checkAxe(page, 'the Data tab naming a changed parameter', task.meta, {
        shows: [page.getByRole('tabpanel', { name: 'Data' }), row],
      });

      // Resolved again, by the keyboard, it takes the new period.
      const resolve = row.getByRole('button', { name: 'Resolve' });
      await tabTo(page, resolve);
      await page.keyboard.press('Enter');
      await row.getByText('Holding').waitFor({ timeout: 20_000 });
      expect(await row.textContent()).toContain('South bank');
      expect(await row.getByText("The document's period changed").count()).toBe(0);

      // Published.
      const publish = page.getByRole('button', { name: /^Publish as/ }).first();
      await tabTo(page, publish, 120);
      await page.keyboard.press('Enter');
      await page.getByRole('link', { name: 'Open the publication' }).waitFor({ timeout: 120_000 });
    });
  });
});
