import { readPaint } from '@alloy-works/conformance';
import type { Locator, Page } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf, readDocument, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace, makeComponent } from './testing/component.js';
import { publishPdf } from './testing/fixtures.js';
import { withPage } from './testing/page.js';

/**
 * A bound table's notes and Wide in the pinned Chromium (the TB3 plan, task 5), against the
 * development source the `sources` profile runs: a table of every site, too wide for a portrait page,
 * placed by the API and resolved; a note on a column and a note on a cell by its key added from the
 * Bound table panel by the keyboard and typed in place, Wide set to Rotate, the panel held to axe; and
 * the component's version published, the PDF read back for the letters, the notes and the landscape
 * page. Uncited: the requirements are the domain's and the publish's.
 */

const READER = { account: 'reader', password: 'source-reader-dev-password' };

/** Eight columns of each site's name, none wrapping: wider than a portrait page's measure. */
const NAMES = Array.from({ length: 8 }, (_, at) => `n${at + 1}`);

/** A connection to the source, a definition of every site, a component placing it as a table, resolved. */
async function placeTable(client: Client): Promise<{ document: string; component: string }> {
  const space = await generalSpace(client);
  const stamp = new Date().toISOString();
  const connection = await client.POST('/v1/spaces/{space}/connections', {
    params: { path: { space } },
    body: {
      settings: {
        schemaVersion: 1,
        name: `Noted source ${stamp}`,
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
  const definition = await client.POST('/v1/spaces/{space}/query-definitions', {
    params: { path: { space } },
    body: {
      definition: {
        schemaVersion: 1,
        title: `Every site in full ${stamp}`,
        description: 'Every site, by its id, its name many times over.',
        connection: connection.data.id,
        parameters: [],
        fetch: {
          kind: 'sql',
          text: `select id, ${NAMES.map((name) => `name as ${name}`).join(', ')}, depth from sample.site order by id`,
        },
        columns: [
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
          ...NAMES.map((name) => ({ name, from: { column: name }, type: { base: 'text' } })),
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
  const component = await makeComponent(client, 'Sites in full', [
    {
      type: 'boundTable',
      id: 'wide1',
      style: 'table',
      binding: {
        type: 'binding',
        id: 'wide-rows',
        query: definition.data.id,
        parameters: {},
        mode: 'checked',
      },
      caption: [{ type: 'text', value: 'Every site at length', marks: [] }],
      columns: [
        { column: 'id', header: 'Id' },
        ...NAMES.map((name) => ({ column: name, header: name.toUpperCase(), wrap: false })),
        { column: 'depth', header: 'Depth' },
      ],
      headerColumn: false,
    },
  ]);
  let document = await makeDocument(client, 'Sites in full', []);
  document = await edit(client, document, {
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  const node = nodesOf(document)[0]!.id;
  const resolved = await client.POST('/v1/documents/{id}/bindings/resolve', {
    params: { path: { id: document.id } },
    body: { bindings: [{ node, binding: 'wide-rows' }] },
  });
  if (!resolved.data) throw new Error(`resolving answered ${resolved.response.status}`);
  return { document: document.id, component: component.id };
}

/** Tab pressed until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, most = 120) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

/** Shift+F6 pressed until the focus stands in `region`. */
async function regionTo(page: Page, region: Locator) {
  for (let pressed = 0; pressed < 12; pressed++) {
    if (await region.evaluate((element) => element.contains(document.activeElement))) return;
    await page.keyboard.press('Shift+F6');
  }
  throw new Error(`${String(region)} never took the focus`);
}

describe("a bound table's notes and Wide, in Chromium (the TB3 plan, task 5)", () => {
  let placed: { document: string; component: string };
  const client = api();
  beforeAll(async () => {
    placed = await placeTable(client);
  });

  it('adds a column note and a keyed note by the keyboard, sets Wide to Rotate, and publishes the letters, the notes and a landscape page', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1700, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${placed.document}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const text = page.getByRole('region', { name: "The document's text" });
      // Its rows drawn from the result held before the editor opens.
      await text.locator('[data-bound-table-body] tbody tr').nth(2).waitFor({ timeout: 60_000 });
      const opens = text.locator('[data-opens="true"]').first();
      await opens.focus();
      await page.keyboard.press('Enter');
      const surface = page.getByRole('textbox', { name: /^Content of / });
      await surface.waitFor();
      await surface.focus();
      const panel = page.getByRole('group', { name: 'Bound table' });
      await panel.waitFor();
      const adding = panel.getByRole('group', { name: 'Add note' });

      // A note on the column N1, typed in place beneath the table.
      await regionTo(page, panel);
      await adding.getByLabel(/^Column/).selectOption('n1');
      await tabTo(page, adding.getByRole('button', { name: 'Add note' }));
      await page.keyboard.press('Enter');
      await page.keyboard.type('Named by the survey.');

      // A note on the depth of the site whose id is 2, its key typed.
      await regionTo(page, panel);
      await adding.getByLabel('Note on').selectOption('cell');
      await adding.getByLabel(/^Column/).selectOption('depth');
      await tabTo(page, adding.getByLabel('Where id is'));
      await page.keyboard.type('2');
      await tabTo(page, adding.getByRole('button', { name: 'Add note' }));
      await page.keyboard.press('Enter');
      await page.keyboard.type('Estimated at low water.');

      // Lettered in reading order once its session has saved it: the column's a, the cell's b.
      const header = surface.locator('[data-bound-table-body] thead th').nth(1);
      await expect.poll(async () => header.textContent(), { timeout: 30_000 }).toBe('N1a');
      const depth = surface.locator('[data-bound-table-body] tbody tr').nth(1).locator('td').last();
      await expect.poll(async () => depth.textContent(), { timeout: 30_000 }).toBe('3.75b');
      await expect
        .poll(async () =>
          surface
            .locator('[data-bound-table-note]')
            .evaluateAll((notes) => notes.map((each) => each.textContent)),
        )
        .toEqual(['aNamed by the survey.', 'bEstimated at low water.']);

      // Wide set to Rotate, and the panel held to axe.
      await regionTo(page, panel);
      await panel.getByLabel('Wide').selectOption('rotate');
      await checkAxe(page, "the Bound table panel's notes and Wide", task.meta, {
        shows: [panel, adding],
      });

      const before = (
        await client.GET('/v1/components/{id}', { params: { path: { id: placed.component } } })
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
    const paint = await readPaint(
      await publishPdf(client, await readDocument(client, placed.document)),
    );
    const runs = paint.texts.filter((each) => !each.artifact);
    const said = runs.map((each) => each.text).join(' ');
    for (const printed of ['Named by the survey.', 'Estimated at low water.']) {
      expect(said).toContain(printed);
    }
    // The table on a landscape page of its own, its letters printed with it.
    // The caption in the text, after the list of tables names it.
    const caption = runs.findLast((each) => each.text.includes('Every site at length'))!;
    // Pages counted from 1.
    const turned = paint.pages[caption.page - 1]!;
    expect(turned.width).toBeGreaterThan(turned.height);
    const onIt = runs.filter((each) => each.page === caption.page).map((each) => each.text);
    expect(onIt.filter((each) => each.trim() === 'a').length).toBeGreaterThan(0);
    expect(onIt.filter((each) => each.trim() === 'b').length).toBeGreaterThan(0);
  });
});
