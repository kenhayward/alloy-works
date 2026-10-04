import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';

/**
 * A built query over the whole system (the D4 plan, task 5): written by Grace, who may use the
 * development connection and write no SQL there (the development role Query builder, D4-J), against
 * the development source; stored as its tree; sampled; bound in a component and resolved in a document
 * through the connector; then changed by a second version, which resolves to new SQL generated from the
 * new tree. Ada makes the connection, as the environment's administrator.
 */
const READER = { account: 'reader', password: 'source-reader-dev-password' };

type Json = Record<string, unknown>;

/** The run's SQL the generator writes for the tree below, comparing the site as `operator`. */
const ranSql = (operator: '=' | '<>') =>
  [
    'SELECT "r"."site" AS "site", pg_catalog.count(*) AS "readings", pg_catalog.round(pg_catalog.avg("r"."value"), 2) AS "mean_value"',
    'FROM "sample"."reading" AS "r"',
    `WHERE "r"."site" OPERATOR(pg_catalog.${operator}) ($1::pg_catalog.int8)`,
    'GROUP BY "r"."site"',
    'ORDER BY "r"."site" ASC NULLS LAST',
    'LIMIT 10',
  ].join('\n');

/** Readings by site: how many, and their mean to two places, for the site given or the others. */
const query = (is: 'equal' | 'notEqual') => ({
  sources: [{ alias: 'r', table: { schema: 'sample', name: 'reading' } }],
  joins: [],
  select: [
    { name: 'site', of: { source: 'r', column: 'site' } },
    { name: 'readings', of: { aggregate: 'count' } },
    {
      name: 'mean_value',
      of: { aggregate: 'average', of: { source: 'r', column: 'value' }, places: 2 },
    },
  ],
  where: { column: { source: 'r', column: 'site' }, is, to: { parameter: 'site' } },
  groupBy: [{ source: 'r', column: 'site' }],
  limit: 10,
});
const parameters = [{ name: 'site', type: { base: 'integer' }, required: true, list: false }];

describe('a built query over the whole system', () => {
  const cookies: Record<string, string> = {};
  let general = '';

  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: {
        cookie: cookies[as]!,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
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
    cookies.ada = await signIn('ada');
    cookies.grace = await signIn('grace');
    const spaces = await call('ada', 'GET', '/v1/spaces');
    general = (spaces.body['items'] as { id: string; name: string }[]).find(
      (space) => space.name === 'General',
    )!.id;
  }, 180_000);

  it("DAT-099 stores a built query's structure and never its SQL, and generates the SQL from it each time it runs, over the whole system", async () => {
    const connection = ok(
      await call('ada', 'POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `Readings for the builder ${Date.now()}`,
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
    expect(
      ok(
        await call('ada', 'PUT', `/v1/connections/${connection}/credential`, {
          secret: READER.password,
        }),
      ),
    ).toMatchObject({ test: { outcome: 'ok', findings: [] } });

    // Grace may write no SQL on it.
    const asSql = await call('grace', 'POST', `/v1/connections/${connection}/describe`, {
      sql: { text: 'select 1 as one', parameters: [] },
    });
    expect(asSql.status).toBe(403);

    // She builds the query instead: described from the source without running it.
    expect(
      ok(
        await call('grace', 'POST', `/v1/connections/${connection}/describe`, {
          builder: { query: query('equal'), parameters },
        }),
      ),
    ).toMatchObject({
      columns: [
        { name: 'site', proposed: { base: 'integer' } },
        { name: 'readings', proposed: { base: 'integer' } },
        { name: 'mean_value', sourceType: 'numeric', proposed: null },
      ],
    });
    const definitionOf = (is: 'equal' | 'notEqual') => ({
      schemaVersion: 1,
      title: `Readings by site ${Date.now()}`,
      description: 'How many readings a site has, and their mean.',
      connection,
      parameters,
      fetch: { kind: 'builder', format: 1, query: query(is) },
      columns: [
        { name: 'site', from: { column: 'site' }, type: { base: 'integer' } },
        { name: 'readings', from: { column: 'readings' }, type: { base: 'integer' } },
        {
          name: 'mean_value',
          from: { column: 'mean_value' },
          type: { base: 'decimal', precision: 20, scale: 2 },
        },
      ],
      key: ['site'],
      order: [{ column: 'site', direction: 'ascending' }],
      empty: 'valid',
      limits: { rows: 100, bytes: 65_536, seconds: 10 },
      retired: false,
    });
    const made = ok(
      await call('grace', 'POST', `/v1/spaces/${general}/query-definitions`, {
        definition: definitionOf('equal'),
      }),
    ) as { id: string; version: { id: string }; definition: Json; mayEdit: boolean };
    expect(made.mayEdit).toBe(true);

    // The stored version holds the tree, and no SQL anywhere.
    const stored = ok(await call('grace', 'GET', `/v1/query-definitions/${made.id}`)) as {
      definition: Json;
    };
    expect(stored.definition['fetch']).toEqual({
      kind: 'builder',
      format: 1,
      query: query('equal'),
    });
    expect(JSON.stringify(stored.definition)).not.toMatch(/SELECT |FROM |pg_catalog|OPERATOR/);

    // Sampled: the SQL that ran is what the generator writes from the tree, the value bound apart.
    const draft: Json = definitionOf('equal');
    delete draft['title'];
    delete draft['description'];
    delete draft['retired'];
    expect(
      ok(
        await call('grace', 'POST', `/v1/connections/${connection}/sample`, {
          definition: draft,
          values: { site: '1' },
        }),
      ),
    ).toMatchObject({
      outcome: 'ok',
      rows: [['1', '2', '1.28']],
      ran: { sql: ranSql('=') },
    });

    // Bound in a component and resolved in a document, by Grace.
    const component = ok(
      await call('grace', 'POST', `/v1/spaces/${general}/components`, {
        title: 'Site readings',
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const session = randomUUID();
    ok(await call('grace', 'POST', `/v1/components/${component.id}/lock`, { session }));
    ok(
      await call('grace', 'PUT', `/v1/components/${component.id}/iterations/${session}/1`, {
        openedFrom: component.version.id,
        content: {
          schemaVersion: 1,
          title: 'Site readings',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [
                { type: 'text', value: 'The mean reading is ', marks: [] },
                {
                  type: 'binding',
                  id: 'mean',
                  query: made.id,
                  parameters: { site: { literal: '1' } },
                  mode: 'checked',
                  take: { column: 'mean_value' },
                },
              ],
            },
          ],
        },
      }),
    );
    expect(
      ok(
        await call(
          'grace',
          'DELETE',
          `/v1/components/${component.id}/lock?session=${session}&openedFrom=${component.version.id}`,
        ),
      ),
    ).toMatchObject({ outcome: 'cut' });
    const document = ok(
      await call('grace', 'POST', `/v1/spaces/${general}/documents`, {
        title: `Site readings report ${Date.now()}`,
        language: 'en-GB',
        direction: 'ltr',
      }),
    ) as { id: string; version: { id: string } };
    const outlined = ok(
      await call('grace', 'POST', `/v1/documents/${document.id}/outline`, {
        openedFrom: document.version.id,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
        },
      }),
    ) as { outline: { nodes: { id: string }[] } };
    const node = outlined.outline.nodes[0]!.id;
    const resolve = async () => {
      const answer = ok(
        await call('grace', 'POST', `/v1/documents/${document.id}/bindings/resolve`, {
          bindings: [{ node, binding: 'mean' }],
        }),
      ) as { results: { held: { version: string } }[] };
      return ok(
        await call(
          'grace',
          'GET',
          `/v1/documents/${document.id}/datasets/${answer.results[0]!.held.version}`,
        ),
      ) as { result: { rows: unknown[] }; provenance: Json };
    };
    const first = await resolve();
    expect(first.result.rows).toEqual([['1', '2', '1.28']]);
    expect(first.provenance).toMatchObject({
      queryDefinition: { artifact: made.id, version: made.version.id },
      parameters: { site: '1' },
      ran: { sql: ranSql('=') },
    });

    // A second version changes the filter: the next resolve runs the SQL its new tree generates, and
    // nothing but the tree was stored.
    const next = ok(
      await call('grace', 'POST', `/v1/query-definitions/${made.id}/versions`, {
        openedFrom: made.version.id,
        definition: definitionOf('notEqual'),
      }),
    ) as { version: { id: string }; definition: Json };
    expect(next.definition['fetch']).toEqual({
      kind: 'builder',
      format: 1,
      query: query('notEqual'),
    });
    const second = await resolve();
    expect(second.result.rows).toEqual([['2', '1', '0.8']]);
    expect(second.provenance).toMatchObject({
      queryDefinition: { artifact: made.id, version: next.version.id },
      ran: { sql: ranSql('<>') },
    });
  }, 180_000);
});
