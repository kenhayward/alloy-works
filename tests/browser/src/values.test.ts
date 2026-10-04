import { formatsFor, formatValue, readTheme, type ValueType } from '@alloy-works/domain';
import type { Locator, Page } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace, makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * Values in a document's text in the pinned Chromium (the B1 plan, task 6), against the development
 * source the `sources` profile runs: a binding taking a site's depth, and one taking a site the source
 * does not hold, placed and resolved through the API as no screen does yet. Uncited: the page's jsdom
 * tests cite what a person sees, and these hold it to axe, the keyboard alone and the formatter Node
 * runs.
 */

const READER = { account: 'reader', password: 'source-reader-dev-password' };

/** Two bindings of one definition: the depth at the weir, and at a site the source does not hold. */
const bound = (id: string, definition: string, site: string) => ({
  type: 'binding',
  id,
  query: definition,
  parameters: { site: { literal: site } },
  mode: 'checked',
  take: { column: 'depth' },
});

interface Placed {
  readonly document: string;
  readonly node: string;
  readonly component: string;
}

/** A connection to the source, a definition of a site's depth, and a document resolving both values. */
async function placeValues(client: Client): Promise<Placed> {
  const space = await generalSpace(client);
  const stamp = new Date().toISOString();
  const connection = await client.POST('/v1/spaces/{space}/connections', {
    params: { path: { space } },
    body: {
      settings: {
        schemaVersion: 1,
        name: `Values source ${stamp}`,
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
        title: `Site depth ${stamp}`,
        description: 'One site, by its id.',
        connection: connection.data.id,
        parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
        fetch: {
          kind: 'sql',
          text: 'select id, depth from sample.site where id = {{site}} order by id',
        },
        columns: [
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
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
      content: [
        bound('weir', definition.data.id, '1'),
        { type: 'text', value: ' metres at the weir, and at the far site ', marks: [] },
        bound('far', definition.data.id, '99'),
        { type: 'text', value: '.', marks: [] },
      ],
    },
  ]);
  let document = await makeDocument(client, 'Site depths report', []);
  document = await edit(client, document, {
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  const node = nodesOf(document)[0]!.id;
  const resolved = await client.POST('/v1/documents/{id}/bindings/resolve', {
    params: { path: { id: document.id } },
    body: {
      bindings: [
        { node, binding: 'weir' },
        { node, binding: 'far' },
      ],
    },
  });
  if (!resolved.data) throw new Error(`resolving answered ${resolved.response.status}`);
  return { document: document.id, node, component: component.id };
}

/** Tab pressed, forwards or back, until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, { back = false, most = 40 } = {}) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

const isFocused = (target: Locator) =>
  target.evaluate((element) => element === document.activeElement);

describe('values in a document, in Chromium (the B1 plan, task 6)', () => {
  let placed: Placed;
  beforeAll(async () => {
    placed = await placeValues(api());
  });

  const text = (page: Page) => page.getByRole('region', { name: "The document's text" });
  const value = (page: Page) => text(page).getByRole('button', { name: /, bound value$/ });
  const failed = (page: Page) =>
    text(page).getByRole('button', { name: /^No value - the query returned no rows/ });
  const provenance = (page: Page) => page.getByRole('region', { name: 'Provenance' });

  it('passes axe in Reading and Authoring with a value, a failed one and a provenance open', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${placed.document}`);
      await value(page).waitFor();
      await failed(page).waitFor();
      for (const mode of ['Reading', 'Authoring'] as const) {
        await page.getByRole('radio', { name: mode }).check();
        await checkAxe(page, `values in ${mode}`, task.meta, {
          shows: [
            value(page),
            failed(page),
            page.getByRole('article', { name: new RegExp(`in ${mode}$`) }),
          ],
        });
        await value(page).click();
        await checkAxe(page, `a provenance open in ${mode}`, task.meta, {
          shows: [provenance(page), value(page)],
        });
        await provenance(page).getByRole('button', { name: 'Show the result' }).click();
        await provenance(page).getByRole('table').waitFor();
        await checkAxe(page, `a provenance's result shown in ${mode}`, task.meta, {
          shows: provenance(page).getByRole('table'),
        });
        await provenance(page).getByRole('button', { name: 'Close' }).click();
        await provenance(page).waitFor({ state: 'hidden' });
      }
    });
  });

  it("opens a value's provenance and closes it by the keyboard alone, and reaches a binding in the editor by the arrow keys and its Value panel's Provenance by Tab", async () => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${placed.document}`);
      await page.getByRole('radio', { name: 'Reading' }).check();
      await value(page).waitFor();

      // Tab to the value, Enter: the panel's heading takes the focus; Escape gives it back.
      await page.locator('body').focus();
      await tabTo(page, value(page));
      await page.keyboard.press('Enter');
      const heading = provenance(page).getByRole('heading', { name: 'Provenance' });
      await heading.waitFor();
      expect(await isFocused(heading)).toBe(true);
      await page.keyboard.press('Escape');
      await provenance(page).waitFor({ state: 'hidden' });
      expect(await isFocused(value(page))).toBe(true);

      // In Authoring the text opens its editor by Enter, the binding is reached by the arrow keys as a
      // whole, and the Value panel's Provenance is reached by F6 and Tab.
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const opens = text(page).locator('[data-opens="true"]').first();
      await opens.waitFor();
      await opens.focus();
      await page.keyboard.press('Enter');
      const surface = page.getByRole('textbox', { name: /^Content of / });
      await surface.waitFor();
      const panel = page.getByRole('region', { name: 'Value' });
      // Opened at the text's start, the caret stands before the binding that begins it: an arrow on
      // selects it whole (B1-L).
      for (let pressed = 0; pressed < 3 && !(await panel.isVisible()); pressed++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(100);
      }
      await panel.waitFor();
      const button = panel.getByRole('button', { name: 'Provenance' });
      for (let pressed = 0; pressed < 12; pressed++) {
        if (await panel.evaluate((element) => element.contains(document.activeElement))) break;
        await page.keyboard.press('F6');
      }
      await tabTo(page, button, { most: 5 });
      await page.keyboard.press('Enter');
      await heading.waitFor();
      expect(await isFocused(heading)).toBe(true);
    });
  });

  it("shows a value in Chromium as the domain's formatValue prints it in Node", async () => {
    const client = api();
    const { data: view } = await client.GET('/v1/documents/{id}/bindings', {
      params: { path: { id: placed.document } },
    });
    const weir = view!.bindings.find((each) => each.binding.id === 'weir')!;
    const taken = weir.held!.taken as { value: string; column: { type: ValueType } };
    const { data: presentation } = await client.GET('/v1/documents/{id}/presentation', {
      params: { path: { id: placed.document } },
    });
    const theme = readTheme(
      presentation!.theme.content,
      new Map(presentation!.theme.catalogues.map((each) => [each.versionId, each.content])),
    );
    if (!theme.ok) throw new Error('The document theme does not read');
    const expected = formatValue(
      taken.value,
      taken.column.type,
      formatsFor(theme.theme.valueCatalogue, 'en-GB'),
    );
    expect(expected).toBe('12.50');
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${placed.document}`);
      await value(page).waitFor();
      const seen = await value(page).evaluate((element) => {
        const copy = element.cloneNode(true) as Element;
        copy.querySelectorAll('.aw-binding-hidden').forEach((each) => each.remove());
        return copy.textContent;
      });
      expect(seen).toBe(expected);
    });
  });
});
