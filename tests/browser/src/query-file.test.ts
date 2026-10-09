import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * A file's Query tab in the pinned Chromium (the QF plan): a definition reading the `sources`
 * profile's readings from S3, its key in two segments, a parameter and two filters, laid out as one
 * card - segments and filters a row each, the format on one line - and held to axe in Light and Dark.
 * Uncited: it changes how the tab looks, not what it does.
 */

const READER = { accessKeyId: 'source-s3-reader', secretAccessKey: 'source-s3-reader-dev-secret' };

describe("a file's Query tab, in Chromium (the QF plan)", () => {
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
          name: `Readings bucket ${stamp}`,
          description: 'The development bucket.',
          type: 's3',
          source: {
            endpoint: 'https://source-s3:8333',
            region: 'us-east-1',
            bucket: 'alloy-readings',
            pathStyle: true,
          },
          identity: { kind: 'service' },
          retired: false,
        },
      } as never,
    });
    if (!connection.data) throw new Error(`a connection answered ${connection.response.status}`);
    const credential = await client.PUT('/v1/connections/{id}/credential', {
      params: { path: { id: connection.data.id } },
      body: READER as never,
    });
    if (!credential.data) throw new Error(`its credential answered ${credential.response.status}`);
    const made = await client.POST('/v1/spaces/{space}/query-definitions', {
      params: { path: { space } },
      body: {
        definition: {
          schemaVersion: 1,
          title: `Readings of a year ${stamp}`,
          description: 'The readings, from a file a year.',
          connection: connection.data.id,
          parameters: [{ name: 'site', type: { base: 'text' }, required: false, list: false }],
          fetch: {
            kind: 'file',
            key: [{ fixed: 'readings' }, { fixed: '2026' }, { fixed: 'readings.csv' }],
            format: { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'empty' },
            where: {
              and: [
                {
                  column: 'site',
                  is: 'startsWith',
                  to: { literal: 'North', type: { base: 'text' } },
                },
                { column: 'site', is: 'equal', to: { parameter: 'site' } },
              ],
            },
          },
          columns: [
            { name: 'id', from: { header: 'id' }, type: { base: 'integer' } },
            { name: 'site', from: { header: 'site' }, type: { base: 'text' } },
            { name: 'depth', from: { header: 'depth' }, type: { base: 'text' } },
          ],
          key: ['id'],
          order: [{ column: 'id', direction: 'ascending' }],
          empty: 'valid',
          limits: { rows: 100, bytes: 65_536, seconds: 10 },
          retired: false,
        },
      } as never,
    });
    if (!made.data) throw new Error(`a definition answered ${made.response.status}`);
    definition = (made.data as { id: string }).id;
  });

  it('lays out the key, the format, the filters and the parameters as one card, held to axe', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SERVICE}/#/query-definitions/${definition}/query`);
      const place = page.getByRole('region', { name: 'Where the file is in the bucket' });
      const filters = page.getByRole('table', { name: 'Filters' });
      await place.getByText('readings/2026/readings.csv').waitFor();
      await page.getByLabel('Fields are separated by', { exact: true }).waitFor();
      await filters.getByText('The value of site').waitFor();
      await checkAxe(page, "a file's Query tab", task.meta, {
        shows: [place.getByRole('table', { name: 'Segments of the key' }), filters],
      });
      // Each row is one line of the drawn height, however long its fields' words.
      const heights = await filters
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
      expect(heights).toEqual([40, 40]);
      // The format is one line across the card, its parameters a line each at its foot (QF2).
      const format = page.getByRole('region', { name: 'Format' });
      const middles = await format.locator('select, input').evaluateAll((fields) =>
        fields.map((field) => {
          const box = field.getBoundingClientRect();
          return box.top + box.height / 2;
        }),
      );
      expect(Math.max(...middles) - Math.min(...middles)).toBeLessThan(2);
      const parameters = page.getByRole('region', { name: 'Parameters' });
      await parameters.getByText('Text, not required, any value of its type').waitFor();
      await parameters.getByRole('button', { name: 'Edit parameter 1' }).click();
      const fields = parameters.getByRole('group', { name: 'Parameter 1' });
      await checkAxe(page, "a file's parameter opened", task.meta, { shows: [fields] });
    });
  });
});
