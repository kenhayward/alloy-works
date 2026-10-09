import { readPaint } from '@alloy-works/conformance';
import type { Locator, Page } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, readDocument, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace, makeComponent } from './testing/component.js';
import { publishPdf } from './testing/fixtures.js';
import { withPage } from './testing/page.js';

/**
 * A bound table in the pinned Chromium (the TB2 plan, task 5), against the development source the
 * `sources` profile runs: the seed's `sample.site` placed as a table from the Value dialog by the
 * keyboard alone, shaped in the Bound table panel - a column given a header, a unit and its places, the
 * rows sorted - captioned in place, its dialog, panel and Format dialog held to axe, and the
 * component's version published, the PDF read back for the table. Uncited, as B6's were.
 */

const READER = { account: 'reader', password: 'source-reader-dev-password' };

/** A connection to the source, a definition of every site, and a document placing a component. */
async function placeComponent(
  client: Client,
): Promise<{ document: string; component: string; title: string }> {
  const space = await generalSpace(client);
  const stamp = new Date().toISOString();
  const connection = await client.POST('/v1/spaces/{space}/connections', {
    params: { path: { space } },
    body: {
      settings: {
        schemaVersion: 1,
        name: `Site source ${stamp}`,
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
  const title = `Every site ${stamp}`;
  const definition = await client.POST('/v1/spaces/{space}/query-definitions', {
    params: { path: { space } },
    body: {
      definition: {
        schemaVersion: 1,
        title,
        description: 'Every site, by its id.',
        connection: connection.data.id,
        parameters: [],
        fetch: { kind: 'sql', text: 'select id, name, depth from sample.site order by id' },
        columns: [
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
          { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
          {
            name: 'depth',
            from: { column: 'depth' },
            type: { base: 'decimal', precision: 8, scale: 2 },
          },
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
  const component = await makeComponent(client, 'Site depths', [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'The sites, deepest first', marks: [] }],
    },
  ]);
  let document = await makeDocument(client, 'Site depth report', []);
  document = await edit(client, document, {
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  return { document: document.id, component: component.id, title };
}

/** Tab pressed until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, most = 80) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

/** Each row of a body's table as its cells' text, spaces made plain. */
const rowsOf = (body: Locator) =>
  body.evaluate((element) =>
    [...element.querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll('th, td')].map((cell) =>
        (cell.textContent ?? '').replace(/\s/gu, ' '),
      ),
    ),
  );

describe('a bound table, in Chromium (the TB2 plan, task 5)', () => {
  let placed: { document: string; component: string; title: string };
  const client = api();
  beforeAll(async () => {
    placed = await placeComponent(client);
  });

  it('places every site as a table from the Value dialog by the keyboard, shapes and captions it, and publishes it', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1700, height: 1000 });
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

      // The dialog by the keyboard: the definition, then Place as a table.
      const dialog = page.getByRole('dialog', { name: 'Value' });
      await dialog.waitFor();
      await page.keyboard.type(placed.title);
      await dialog.getByRole('radio', { name: new RegExp(placed.title) }).waitFor();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Space');
      const placeAs = dialog.getByRole('group', { name: 'Place as' });
      const inLine = placeAs.getByRole('radio', { name: 'In the line' });
      await tabTo(page, inLine);
      await page.keyboard.press('ArrowDown');
      expect(await placeAs.getByRole('radio', { name: 'As a table' }).isChecked()).toBe(true);
      expect(await dialog.getByLabel('Column').count()).toBe(0);
      await checkAxe(page, 'the Value dialog placing a result as a table', task.meta, {
        shows: [dialog, placeAs],
      });
      await tabTo(page, dialog.getByRole('button', { name: 'Insert' }));
      await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'hidden' });

      // Resolved from the editing session, and drawn: its headers and its three rows.
      const body = surface.locator('[data-bound-table-body]');
      await expect.poll(async () => (await rowsOf(body)).length, { timeout: 60_000 }).toBe(4);
      expect((await rowsOf(body))[0]).toEqual(['id', 'name', 'depth']);

      // Captioned in place, the cursor standing in its caption as it was placed.
      await page.keyboard.type('Sites by depth');
      await surface.locator('figure', { hasText: 'Sites by depth' }).first().waitFor();

      // To the Bound table panel by F6, past the Value panel.
      const panel = page.getByRole('group', { name: 'Bound table' });
      const valuePanel = page.getByRole('region', { name: 'Value' });
      await panel.waitFor();
      for (let pressed = 0; pressed < 12; pressed++) {
        if (await panel.evaluate((element) => element.contains(document.activeElement))) break;
        await page.keyboard.press('Shift+F6');
      }
      expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );

      // The depth column: a header, a unit, its places.
      const depth = panel.getByRole('group', { name: 'Column 3' });
      const header = depth.getByLabel('Header', { exact: true });
      await tabTo(page, header);
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Depth');
      await page.keyboard.press('Tab');
      await page.keyboard.type('m');
      await expect.poll(async () => (await rowsOf(body))[0]).toEqual(['id', 'name', 'Depth (m)']);
      const format = depth.getByRole('button', { name: 'Format' });
      await tabTo(page, format);
      await page.keyboard.press('Enter');
      const formatDialog = page.getByRole('dialog', { name: 'Format of Depth' });
      await formatDialog.waitFor();
      const places = formatDialog.getByLabel('Decimal places');
      await tabTo(page, places);
      await page.keyboard.type('1');
      await checkAxe(page, "the Format dialog of a bound table's column", task.meta, {
        shows: [formatDialog, places],
      });
      await tabTo(page, formatDialog.getByRole('button', { name: 'Apply' }));
      await page.keyboard.press('Enter');
      await formatDialog.waitFor({ state: 'hidden' });
      await expect.poll(async () => (await rowsOf(body))[1]).toEqual(['1', 'North weir', '12.5']);

      // Sorted by depth, deepest first, the site with none last: the Sort tab, by the arrows from
      // the tab chosen (ADR-0051).
      await tabTo(page, panel.getByRole('tab', { selected: true }));
      await page.keyboard.press('ArrowRight');
      await panel.getByRole('tabpanel', { name: /^Sort/ }).waitFor();
      await tabTo(page, panel.getByRole('button', { name: 'Add sort' }));
      await page.keyboard.press('Enter');
      const key = panel.getByRole('group', { name: 'Sort 1' });
      await key.getByLabel('Column').selectOption('depth');
      await key
        .getByRole('radiogroup', { name: 'Direction of Sort 1' })
        .getByRole('radio', { name: 'Descending' })
        .click();
      await expect
        .poll(async () => (await rowsOf(body)).slice(1).map((row) => row[1]))
        .toEqual(['North weir', 'South bank', 'Old mill']);
      await checkAxe(page, 'the panels of a bound table', task.meta, {
        shows: [panel, valuePanel],
      });

      // Its version cut, and the document published from it.
      const before = (
        await client.GET('/v1/components/{id}', {
          params: { path: { id: placed.component } },
        })
      ).data!.version.id;
      await page.getByRole('button', { name: 'Save version' }).click();
      await expect
        .poll(
          async () =>
            (
              await client.GET('/v1/components/{id}', {
                params: { path: { id: placed.component } },
              })
            ).data!.version.id,
          { timeout: 20_000 },
        )
        .not.toBe(before);
    });
    const pdf = await publishPdf(client, await readDocument(client, placed.document));
    const runs = (await readPaint(pdf)).texts.filter((each) => !each.artifact);
    const said = runs.map((each) => each.text).join(' ');
    for (const printed of ['Sites by depth', 'Depth (m)', '12.5', '3.8']) {
      expect(said).toContain(printed);
    }
    // Deepest first, the site with no depth last: each lower on the page than the one before.
    const heights = ['North weir', 'South bank', 'Old mill'].map(
      (name) => runs.find((each) => each.text.includes(name))!.y,
    );
    expect(heights[0]).toBeGreaterThan(heights[1]!);
    expect(heights[1]).toBeGreaterThan(heights[2]!);
  });
});
