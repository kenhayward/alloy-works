import type { Page } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace, makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * The Data tab in the pinned Chromium (the B4 plan, task 4), against the development source the
 * `sources` profile runs: a floating binding resolved, its definition then moved on by the API, so the
 * check the page makes on opening finds a revision of the same rows (BI-K) without touching the source.
 * Uncited: the page's jsdom tests cite what a person sees, and this holds it to axe and the keyboard.
 */

const READER = { account: 'reader', password: 'source-reader-dev-password' };

/** A definition of a site's depth, as its body is sent: `description` alone differs between versions. */
const definitionBody = (connection: string, title: string, description: string) => ({
  schemaVersion: 1,
  title,
  description,
  connection,
  parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
  fetch: { kind: 'sql', text: 'select id, depth from sample.site where id = {{site}} order by id' },
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'depth', from: { column: 'depth' }, type: { base: 'decimal', precision: 8, scale: 2 } },
  ],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 100, bytes: 65_536, seconds: 10 },
  retired: false,
});

/** A document holding one floating value, resolved, and its definition moved on since. */
async function definitionMovedOn(client: Client): Promise<string> {
  const space = await generalSpace(client);
  const stamp = new Date().toISOString();
  const connection = await client.POST('/v1/spaces/{space}/connections', {
    params: { path: { space } },
    body: {
      settings: {
        schemaVersion: 1,
        name: `Data tab source ${stamp}`,
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
  const title = `Weir depth ${stamp}`;
  const definition = await client.POST('/v1/spaces/{space}/query-definitions', {
    params: { path: { space } },
    body: { definition: definitionBody(connection.data.id, title, 'One site.') } as never,
  });
  if (!definition.data) throw new Error(`a definition answered ${definition.response.status}`);
  const component = await makeComponent(client, 'Weir depth', [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [
        {
          type: 'binding',
          id: 'weir',
          query: definition.data.id,
          parameters: { site: { literal: '1' } },
          mode: 'checked',
          take: { column: 'depth' },
        },
        { type: 'text', value: ' metres at the weir.', marks: [] },
      ],
    },
  ]);
  let document = await makeDocument(client, 'Weir report', []);
  document = await edit(client, document, {
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  const node = nodesOf(document)[0]!.id;
  const resolved = await client.POST('/v1/documents/{id}/bindings/resolve', {
    params: { path: { id: document.id } },
    body: { bindings: [{ node, binding: 'weir' }] },
  });
  if (!resolved.data) throw new Error(`resolving answered ${resolved.response.status}`);
  const moved = await client.POST('/v1/query-definitions/{id}/versions', {
    params: { path: { id: definition.data.id } },
    body: {
      openedFrom: definition.data.version.id,
      definition: definitionBody(connection.data.id, title, 'One site, moved on.'),
    } as never,
  });
  if (!moved.data) throw new Error(`a definition version answered ${moved.response.status}`);
  return document.id;
}

describe('the Data tab, in Chromium (the B4 plan, task 4)', () => {
  let document: string;
  beforeAll(async () => {
    document = await definitionMovedOn(api());
  });

  const row = (page: Page) => page.locator('li[data-binding="weir"]');

  it('shows the revision the check on opening found, passes axe, and accepts it by the keyboard alone', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${document}`);
      const tab = page.getByRole('tab', { name: 'Data' });
      await tab.waitFor();
      // To the tab strip by the keyboard: Contents holds its one stop, and the arrow moves to Data.
      const contents = page.getByRole('tab', { name: 'Contents' });
      await contents.focus();
      await page.keyboard.press('ArrowRight');
      expect(await tab.getAttribute('aria-selected')).toBe('true');
      // The check made on opening finds the definition's new version, and its result waits.
      await row(page)
        .getByText(/^Waiting: /)
        .waitFor();
      await checkAxe(page, 'the Data tab with a revision waiting', task.meta, {
        shows: [page.getByRole('tabpanel', { name: 'Data' }), row(page)],
      });
      const accept = row(page).getByRole('button', { name: 'Accept' });
      for (let pressed = 0; pressed < 20; pressed++) {
        if (await accept.evaluate((element) => element === globalThis.document.activeElement)) {
          break;
        }
        await page.keyboard.press('Tab');
      }
      expect(
        await accept.evaluate((element) => element === globalThis.document.activeElement),
      ).toBe(true);
      await page.keyboard.press('Enter');
      await row(page).getByText('Holding').waitFor();
      expect(
        await row(page)
          .getByText(/^Waiting: /)
          .count(),
      ).toBe(0);
    });
  });
});
