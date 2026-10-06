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
 * A bound image in the pinned Chromium (the B6 plan, task 5), against the development source the
 * `sources` profile runs: the seed's `sample.site_photo` placed as a figure from the Value dialog by
 * the keyboard, drawn from its asset version above its caption, its panels held to axe, and the
 * component's version published - the PDF read back for the image painted. Uncited, as B1's were.
 */

const READER = { account: 'reader', password: 'source-reader-dev-password' };

/** A connection to the source, a definition of a site's photograph, and a document placing a component. */
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
        name: `Photograph source ${stamp}`,
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
  const title = `Site photograph ${stamp}`;
  const definition = await client.POST('/v1/spaces/{space}/query-definitions', {
    params: { path: { space } },
    body: {
      definition: {
        schemaVersion: 1,
        title,
        description: 'One photograph, by its id.',
        connection: connection.data.id,
        parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
        fetch: {
          kind: 'sql',
          text: 'select id, caption, photo from sample.site_photo where id = {{site}} order by id',
        },
        columns: [
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
          { name: 'caption', from: { column: 'caption' }, type: { base: 'text' } },
          {
            name: 'photo',
            from: { column: 'photo' },
            type: { base: 'image', encoding: 'binary', description: { column: 'caption' } },
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
  const component = await makeComponent(client, 'Site photograph', [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'The weir, seen from the north', marks: [] }],
    },
  ]);
  let document = await makeDocument(client, 'Site photograph report', []);
  document = await edit(client, document, {
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  return { document: document.id, component: component.id, title };
}

/** Tab pressed until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, most = 40) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

describe('a bound image, in Chromium (the B6 plan, task 5)', () => {
  let placed: { document: string; component: string; title: string };
  const client = api();
  beforeAll(async () => {
    placed = await placeComponent(client);
  });

  it('places a site photograph as a figure from the Value dialog, draws it, and publishes it', async ({
    task,
  }) => {
    await withPage(async (page) => {
      // Wide enough for the layout's measure beside the panels, so the canvas does not scroll.
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

      // The dialog by the keyboard: the definition, its parameter, the image column, Place as.
      const dialog = page.getByRole('dialog', { name: 'Value' });
      await dialog.waitFor();
      await page.keyboard.type(placed.title);
      await dialog.getByRole('radio', { name: new RegExp(placed.title) }).waitFor();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Space');
      const site = dialog.getByLabel('site', { exact: true });
      await tabTo(page, site);
      await page.keyboard.type('1');
      const column = dialog.getByLabel('Column');
      await tabTo(page, column);
      await column.selectOption('photo');
      const placeAs = dialog.getByRole('group', { name: 'Place as' });
      const inLine = placeAs.getByRole('radio', { name: 'In the line' });
      await tabTo(page, inLine);
      await page.keyboard.press('ArrowDown');
      expect(await placeAs.getByRole('radio', { name: 'As a figure' }).isChecked()).toBe(true);
      await checkAxe(page, 'the Value dialog placing an image as a figure', task.meta, {
        shows: [dialog, placeAs],
      });
      await tabTo(page, dialog.getByRole('button', { name: 'Insert' }));
      await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'hidden' });

      // Resolved from the editing session, its image admitted, and drawn above its caption.
      const image = surface.locator('figure[data-figure-binding] .aw-figure-image img');
      await expect
        .poll(async () => (await image.count()) > 0 && (await image.getAttribute('alt')), {
          timeout: 60_000,
        })
        .toBe('The weir from the north bank');
      expect(await image.getAttribute('src')).toMatch(
        /^\/v1\/asset-versions\/[0-9a-f-]+\/content$/,
      );
      expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(4);

      // Captioned, the cursor standing in its caption as it was placed: a figure is published with one.
      await page.keyboard.type('The weir');
      await surface.locator('figure figcaption', { hasText: 'The weir' }).waitFor();

      // Its panels: the Figure panel and the Value panel showing its binding.
      const figurePanel = page.getByRole('group', { name: 'Figure' });
      const valuePanel = page.getByRole('region', { name: 'Value' });
      await checkAxe(page, 'the panels of a bound figure', task.meta, {
        shows: [figurePanel, valuePanel],
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
    expect((await readPaint(pdf)).images.length).toBeGreaterThanOrEqual(1);
  });
});
