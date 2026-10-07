import { randomUUID } from 'node:crypto';

import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { readPdf, spoken } from './pdf.js';
import { SERVICE, signIn, untilReady } from './session.js';
import { followSignedLink } from './signed-link.js';
import { atTheSource } from './source.js';

/**
 * A bound table over the whole system (the TB1 plan, task 7): placed in a component by the API over a
 * table of the test's own at the development source, resolved in a document through the connector,
 * and published to the PDF and Word, its cells, its source and `provenance.json` read back; and a
 * result its definition declares may be empty publishing its headers and the statement. Uncited, as
 * B3's are: the suites below the system demonstrate each requirement.
 */
const READER = { account: 'reader', password: 'source-reader-dev-password' };

type Json = Record<string, unknown>;

describe('a bound table over the whole system', () => {
  const table = `sample.tb1_readings_${Date.now()}`;
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
    atTheSource(
      `create table ${table} (site text primary key, reading numeric(10, 2));
       insert into ${table} values ('North weir', 1.11), ('South quay', 3.45), ('West dock', -2.5);
       grant select on ${table} to reader;`,
    );
  }, 180_000);

  afterAll(() => {
    atTheSource(`drop table if exists ${table};`);
  });

  it('places a bound table by the API, resolves it, and publishes its laid-out rows, its source and provenance.json, and an empty result as its statement', async () => {
    const connection = ok(
      await call('POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `Readings for tables ${Date.now()}`,
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
      }),
    )['id'] as string;
    ok(await call('PUT', `/v1/connections/${connection}/credential`, { secret: READER.password }));
    const define = async (title: string, where: string) =>
      ok(
        await call('POST', `/v1/spaces/${general}/query-definitions`, {
          definition: {
            schemaVersion: 1,
            title: `${title} ${Date.now()}`,
            description: 'Readings by site.',
            connection,
            parameters: [],
            fetch: {
              kind: 'sql',
              text: `select site, reading from ${table} ${where} order by site`,
            },
            columns: [
              { name: 'site', from: { column: 'site' }, type: { base: 'text' } },
              {
                name: 'reading',
                from: { column: 'reading' },
                type: { base: 'decimal', precision: 10, scale: 2 },
              },
            ],
            key: ['site'],
            order: [{ column: 'site', direction: 'ascending' }],
            empty: 'valid',
            limits: { rows: 100, bytes: 65_536, seconds: 10 },
            retired: false,
          },
        }),
      )['id'] as string;
    const every = await define('Every reading', '');
    const none = await define('No reading', 'where reading > 1000');

    const bound = (id: string, query: string, extra: Json) => ({
      type: 'boundTable',
      id,
      binding: { type: 'binding', id: `${id}-rows`, query, parameters: {}, mode: 'checked' },
      columns: [
        { column: 'site', header: 'Site' },
        {
          column: 'reading',
          header: 'Reading',
          unit: { text: 'kPa', place: 'header' },
          format: { negative: 'parentheses' },
        },
      ],
      headerColumn: false,
      ...extra,
    });
    const component = ok(
      await call('POST', `/v1/spaces/${general}/components`, {
        title: 'Readings',
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const session = randomUUID();
    ok(await call('POST', `/v1/components/${component.id}/lock`, { session }));
    ok(
      await call('PUT', `/v1/components/${component.id}/iterations/${session}/1`, {
        openedFrom: component.version.id,
        content: {
          schemaVersion: 1,
          title: 'Readings',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            bound('readings', every, {
              caption: [{ type: 'text', value: 'Readings by site', marks: [] }],
              sort: [{ column: 'reading', direction: 'descending', nulls: 'last' }],
              source: [{ type: 'text', value: 'The gauge survey', marks: [] }],
            }),
            bound('quiet', none, {
              caption: [{ type: 'text', value: 'Readings over a thousand', marks: [] }],
              empty: [{ type: 'text', value: 'No site read over a thousand.', marks: [] }],
            }),
          ],
        },
      }),
    );
    expect(
      ok(
        await call(
          'DELETE',
          `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version.id}`,
        ),
      ),
    ).toMatchObject({ outcome: 'cut' });

    const made = ok(
      await call('POST', `/v1/spaces/${general}/documents`, {
        title: `Reading report ${Date.now()}`,
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const edited = ok(
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
    const node = edited.outline.nodes[0]!.id;
    ok(
      await call('POST', `/v1/documents/${made.id}/bindings/resolve`, {
        bindings: [
          { node, binding: 'readings-rows' },
          { node, binding: 'quiet-rows' },
        ],
      }),
    );

    // The rows route's gate over HTTP (the TB2 plan, task 5): the page's rows, in the columns the
    // table names, for the version the bindings view holds; the same rows again a 304; any other
    // version refused by name; nobody signed in, and a document that is not there, refused.
    const held = (
      ok(await call('GET', `/v1/documents/${made.id}/bindings`))['bindings'] as {
        binding: { id: string };
        held: { version: string };
      }[]
    ).find((each) => each.binding.id === 'readings-rows')!.held.version;
    const rowsPath = (document: string, version: string) =>
      `/v1/documents/${document}/bindings/${node}/readings-rows/rows?version=${version}`;
    const rows = await fetch(`${SERVICE}${rowsPath(made.id, held)}`, { headers: { cookie } });
    expect(rows.status).toBe(200);
    expect(rows.headers.get('cache-control')).toBe('private, no-cache');
    // To a reader, in the table's order: its reading descending, sorted on the service.
    expect(await rows.json()).toEqual({
      version: held,
      presorted: true,
      result: {
        columns: [
          ['site', 'text'],
          ['reading', 'decimal'],
        ],
        rows: [
          ['South quay', '3.45'],
          ['North weir', '1.11'],
          ['West dock', '-2.5'],
        ],
      },
    });
    const again = await fetch(`${SERVICE}${rowsPath(made.id, held)}`, {
      headers: { cookie, 'if-none-match': rows.headers.get('etag')! },
    });
    expect(again.status).toBe(304);
    const other = await call('GET', rowsPath(made.id, randomUUID()));
    expect([other.status, other.body['code']]).toEqual([409, 'version_not_held']);
    expect((await fetch(`${SERVICE}${rowsPath(made.id, held)}`)).status).toBe(401);
    expect((await call('GET', rowsPath(randomUUID(), held))).status).toBe(404);

    const asked = ok(
      await call('POST', `/v1/documents/${made.id}/publications`, {
        version: edited.version.id,
        formats: ['pdf', 'docx'],
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
    expect(kept.outputs.map((each) => each.format)).toEqual(['pdf', 'docx', 'provenance']);
    const bytesOf = async (format: string) =>
      (
        await followSignedLink(
          new URL(kept.outputs.find((each) => each.format === format)!.download),
        )
      ).body;

    // The rows sorted, each reading at its places, a negative in parentheses; the source after its
    // word; the empty result as its headers and the statement.
    const said = spoken((await readPdf(await bytesOf('pdf'))).taggedText.flat());
    for (const printed of [
      'Site Reading (kPa) South quay 3.45 North weir 1.11 West dock (2.50)',
      'Source: The gauge survey',
      'Site Reading (kPa) No site read over a thousand.',
    ]) {
      expect(said).toContain(printed);
    }
    const word = [
      ...strFromU8(unzipSync(new Uint8Array(await bytesOf('docx')))['word/document.xml']!).matchAll(
        /<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g,
      ),
    ]
      .map((match) => match[1])
      .join('');
    for (const printed of [
      'SiteReading (kPa)South quay3.45North weir1.11West dock(2.50)',
      'Source: The gauge survey',
      'No site read over a thousand.',
    ]) {
      expect(word).toContain(printed);
    }

    // provenance.json: each printed cell beside the canonical value the source returned.
    const provenance = JSON.parse((await bytesOf('provenance')).toString('utf8')) as {
      schemaVersion: number;
      values: Json[];
    };
    expect(provenance.schemaVersion).toBe(3);
    expect(provenance.values).toMatchObject([
      {
        node,
        binding: 'readings-rows',
        table: {
          rows: [
            [
              { printed: 'South quay', value: 'South quay' },
              { printed: '3.45', value: '3.45' },
            ],
            [
              { printed: 'North weir', value: 'North weir' },
              { printed: '1.11', value: '1.11' },
            ],
            [
              { printed: 'West dock', value: 'West dock' },
              { printed: '(2.50)', value: '-2.5' },
            ],
          ],
        },
      },
      { node, binding: 'quiet-rows', table: { rows: [] } },
    ]);
  }, 180_000);
});
