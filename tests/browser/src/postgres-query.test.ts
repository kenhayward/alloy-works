import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * A PostgreSQL definition's Query tab in the pinned Chromium (the PQ plan): a built query over the
 * `sources` profile's `sample.site`, grouped, with two filters and two summaries, laid out as one
 * card - the query line, Columns to return, Filters and Summaries a row each, Parameters, and the SQL
 * it runs closed at its foot - and held to axe in Light and Dark. Uncited: it changes how the tab
 * looks, not what it does.
 */

const READER = { account: 'reader', password: 'source-reader-dev-password' };
const column = (name: string) => ({ source: 't', column: name });

describe("a PostgreSQL definition's Query tab, in Chromium (the PQ plan)", () => {
  let definition = '';
  const client = api();
  beforeAll(async () => {
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
    const made = await client.POST('/v1/spaces/{space}/query-definitions', {
      params: { path: { space } },
      body: {
        definition: {
          schemaVersion: 1,
          title: `Depths by site ${stamp}`,
          description: 'How many readings each site has, and their mean depth.',
          connection: connection.data.id,
          parameters: [{ name: 'code', type: { base: 'text' }, required: true, list: false }],
          fetch: {
            kind: 'builder',
            format: 1,
            query: {
              sources: [{ alias: 't', table: { schema: 'sample', name: 'site' } }],
              joins: [],
              select: [
                { name: 'name', of: column('name') },
                { name: 'count', of: { aggregate: 'count' } },
                {
                  name: 'mean_depth',
                  of: { aggregate: 'average', of: column('depth'), places: 2 },
                },
              ],
              where: {
                and: [
                  { column: column('code'), is: 'equal', to: { parameter: 'code' } },
                  {
                    column: column('name'),
                    is: 'contains',
                    to: { literal: 'weir', type: { base: 'text' } },
                    ignoreCase: true,
                  },
                ],
              },
              groupBy: [column('name')],
            },
          },
          columns: [
            { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
            { name: 'count', from: { column: 'count' }, type: { base: 'integer' } },
            {
              name: 'mean_depth',
              from: { column: 'mean_depth' },
              type: { base: 'decimal', precision: 10, scale: 2 },
            },
          ],
          key: ['name'],
          order: [{ column: 'name', direction: 'ascending' }],
          empty: 'valid',
          limits: { rows: 100, bytes: 65_536, seconds: 10 },
          retired: false,
        },
      } as never,
    });
    if (!made.data) throw new Error(`a definition answered ${made.response.status}`);
    definition = (made.data as { id: string }).id;
  });

  it('lays out a grouped built query as one card, a filter and a summary a row each, held to axe', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SERVICE}/#/query-definitions/${definition}/query`);
      const card = page.getByRole('region', { name: 'Query' });
      const filters = card.getByRole('table', { name: 'Filters' });
      const summaries = card.getByRole('table', { name: 'Summaries' });
      await filters.getByText('The value of code').waitFor();
      await summaries.getByText('Only for an average').waitFor();
      await card.getByRole('radio', { name: 'Builder' }).waitFor();
      await checkAxe(page, 'a grouped built query', task.meta, {
        shows: [filters, summaries, card.getByRole('region', { name: 'Parameters' })],
      });
      const heights = await card
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
      expect(heights).toEqual([40, 40, 40, 40]);
      // The SQL it runs, opened from the card's foot (PQ-A).
      await card.locator('summary', { hasText: 'The SQL it runs' }).click();
      await card.getByText(/GROUP BY/).waitFor();
      // A parameter opened is a band of its fields on one line, in place of its line (PQ3).
      const parameters = card.getByRole('region', { name: 'Parameters' });
      await parameters.getByRole('button', { name: 'Edit parameter 1' }).click();
      const band = parameters.getByRole('group', { name: 'Parameter 1' });
      await band.getByLabel('Permits', { exact: true }).waitFor();
      await checkAxe(page, 'a parameter opened as a band', task.meta, { shows: [band] });
      const tops = await band
        .locator('input:not([type="checkbox"]), select')
        .evaluateAll((fields) =>
          fields.map((field) => Math.round(field.getBoundingClientRect().top)),
        );
      expect(new Set(tops).size).toBe(1);
    });
  });
});
