import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { readPdf, spoken } from './pdf.js';
import { SERVICE, signIn, untilReady } from './session.js';
import { followSignedLink } from './signed-link.js';

/**
 * HTTP and S3 over the whole system (the D6 plan's verification): an HTTP connection to the
 * `sources` profile's fake API and an S3 connection to its SeaweedFS, a definition of each - case 6's
 * table as XLSX over HTTP, the readings as CSV from S3 - resolved in a document through the connector
 * and published, the values printed read back from the PDF. Every key and value is the development
 * sources' own, invented.
 */

type Json = Record<string, unknown>;

const HTTP_KEY = 'source-http-dev-key';
const S3_READER = {
  accessKeyId: 'source-s3-reader',
  secretAccessKey: 'source-s3-reader-dev-secret',
};

describe('HTTP and S3 sources over the whole system', () => {
  let cookie = '';
  let general = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const ok = (answer: { status: number; body: Json }) => {
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body;
  };

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn('ada');
    const spaces = await call('GET', '/v1/spaces');
    general = (spaces.body['items'] as { id: string; name: string }[]).find(
      (space) => space.name === 'General',
    )!.id;
  }, 180_000);

  /** A connection made and its credential set, which tests it. */
  async function connection(name: string, type: string, source: Json, credential: Json) {
    const id = ok(
      await call('POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `${name} ${Date.now()}`,
          description: 'A development source.',
          type,
          source,
          identity: { kind: 'service' },
          retired: false,
        },
      }),
    )['id'] as string;
    expect(ok(await call('PUT', `/v1/connections/${id}/credential`, credential))).toMatchObject({
      test: { outcome: 'ok' },
    });
    return id;
  }

  /** A definition saved, keyed and ordered by its first column. */
  async function definition(connection: string, title: string, fetch: Json, columns: Json[]) {
    const first = columns[0]!['name'] as string;
    return ok(
      await call('POST', `/v1/spaces/${general}/query-definitions`, {
        definition: {
          schemaVersion: 1,
          title: `${title} ${Date.now()}`,
          description: '',
          connection,
          parameters: [],
          fetch,
          columns,
          key: [first],
          order: [{ column: first, direction: 'ascending' }],
          empty: 'invalid',
          limits: { rows: 100, bytes: 65_536, seconds: 20 },
          retired: false,
        },
      }),
    )['id'] as string;
  }

  it('resolves a definition over HTTP reading XLSX and one over S3 reading CSV in a document, and publishes the values', async () => {
    const api = await connection(
      'Readings API',
      'http',
      { baseUrl: 'https://source-http/v1', secretHeader: 'x-api-key' },
      { secret: HTTP_KEY },
    );
    const bucket = await connection(
      'Readings bucket',
      's3',
      {
        endpoint: 'https://source-s3:8333',
        region: 'us-east-1',
        bucket: 'alloy-readings',
        pathStyle: true,
      },
      S3_READER,
    );
    const header = (name: string, type: Json) => ({ name, from: { header: name }, type });
    const workbook = await definition(
      api,
      'Case 6 as a workbook',
      {
        kind: 'http',
        request: {
          method: 'GET',
          path: [{ fixed: 'files' }, { fixed: 'typed.xlsx' }],
          query: [],
          headers: [],
        },
        format: { kind: 'xlsx', sheet: 'Typed', headerRow: true },
      },
      [
        header('k', { base: 'integer' }),
        header('dec', { base: 'decimal', precision: 28, scale: 10 }),
        header('d', { base: 'date' }),
        header('ldt', { base: 'localDateTime', fraction: 6 }),
        header('tm', { base: 'time', fraction: 6 }),
        header('txt', { base: 'text' }),
      ],
    );
    const readings = await definition(
      bucket,
      'Readings as CSV',
      {
        kind: 'file',
        key: [{ fixed: 'readings' }, { fixed: '2026' }, { fixed: 'readings.csv' }],
        format: { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'empty' },
      },
      [
        header('id', { base: 'integer' }),
        header('site', { base: 'text' }),
        header('depth', { base: 'decimal', precision: 8, scale: 2 }),
      ],
    );

    // A component binding a value of each, placed by the editing routes.
    const component = ok(
      await call('POST', `/v1/spaces/${general}/components`, {
        title: 'Two sources',
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const session = randomUUID();
    ok(await call('POST', `/v1/components/${component.id}/lock`, { session }));
    const bound = (id: string, query: string, take: Json) => ({
      type: 'binding',
      id,
      query,
      parameters: {},
      mode: 'checked',
      take,
    });
    ok(
      await call('PUT', `/v1/components/${component.id}/iterations/${session}/1`, {
        openedFrom: component.version.id,
        content: {
          schemaVersion: 1,
          title: 'Two sources',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [
                { type: 'text', value: 'The workbook says ', marks: [] },
                bound('word', workbook, { key: { k: '2' }, column: 'txt' }),
                { type: 'text', value: ' and the bucket says ', marks: [] },
                bound('site', readings, { key: { id: '2' }, column: 'site' }),
                { type: 'text', value: '.', marks: [] },
              ],
            },
          ],
        },
      }),
    );
    ok(
      await call(
        'DELETE',
        `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version.id}`,
      ),
    );
    const made = ok(
      await call('POST', `/v1/spaces/${general}/documents`, {
        title: `Two sources ${Date.now()}`,
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const placed = ok(
      await call('POST', `/v1/documents/${made.id}/outline`, {
        openedFrom: made.version.id,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
        },
      }),
    ) as { version: { id: string }; outline: { nodes: { id: string }[] } };
    const node = placed.outline.nodes[0]!.id;

    // Resolved through the connector: the workbook's serials read in its date system, exactly.
    const resolved = ok(
      await call('POST', `/v1/documents/${made.id}/bindings/resolve`, {
        bindings: [
          { node, binding: 'word' },
          { node, binding: 'site' },
        ],
      }),
    ) as { results: { binding: string; held: { version: string } }[] };
    const rowsOf = async (binding: string) => {
      const version = resolved.results.find((each) => each.binding === binding)!.held.version;
      return (
        ok(await call('GET', `/v1/documents/${made.id}/datasets/${version}`)) as {
          result: { rows: unknown[][] };
        }
      ).result.rows;
    };
    const fromWorkbook = await rowsOf('word');
    const fromBucket = await rowsOf('site');
    process.stdout.write(`${JSON.stringify({ fromWorkbook, fromBucket })}\n`);
    expect(fromWorkbook).toEqual([
      [
        '1',
        '123456789012345678.1234567891',
        '2026-03-29',
        '2026-03-29T01:30:00.123456',
        '23:59:59.999999',
        'Αθήνα 東京 𠮷',
      ],
      ['2', '-0.0000000001', '1900-03-01', '1900-03-01T00:00:00', '00:00:00', 'café'],
      ['3', '0', '2000-02-29', '2026-10-25T01:30:00', '12:00:00.5', 'café'],
    ]);
    expect(fromBucket).toEqual([
      ['1', 'North weir', '12.5'],
      ['2', 'South weir', '7.25'],
      ['3', 'East gauge', '0.75'],
    ]);

    // Published: the worker reads the stored results, and the PDF prints each value.
    const asked = ok(
      await call('POST', `/v1/documents/${made.id}/publications`, {
        version: placed.version.id,
        formats: ['pdf'],
      }),
    ) as { id: string };
    let publication = '';
    await vi.waitFor(
      async () => {
        const request = ok(await call('GET', `/v1/publication-requests/${asked.id}`));
        expect(request).toMatchObject({ state: 'done', failures: [] });
        publication = request['publication'] as string;
      },
      { timeout: 60_000, interval: 250 },
    );
    const kept = ok(await call('GET', `/v1/publications/${publication}`)) as {
      outputs: { format: string; download: string }[];
    };
    const pdf = (
      await followSignedLink(new URL(kept.outputs.find((each) => each.format === 'pdf')!.download))
    ).body;
    const printed = spoken((await readPdf(pdf)).taggedText.flat());
    process.stdout.write(`${JSON.stringify({ printed })}\n`);
    expect(printed).toContain('The workbook says café and the bucket says South weir.');
  });
});
