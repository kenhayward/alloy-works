import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../stored/canonical.js';
import { BUILDER_FORMAT, treeProblem, type Condition, type Query } from './builder.js';
import {
  DefinitionRefused,
  parseDraftDefinition,
  parseQueryDefinition,
  parseQueryDefinitionForWrite,
  type Column,
  type Parameter,
  type QueryDefinition,
} from './definition.js';
import { generatePostgres } from './generate.js';
import { defaultLimits, limitCeilings } from './limits.js';

const CONNECTION = '00000000-0000-4000-8000-00000000c0c0';

const site = { alias: 's', table: { schema: 'sample', name: 'site' } };
const reading = { alias: 'r', table: { schema: 'sample', name: 'reading' } };
const ref = (source: string, column: string) => ({ source, column });

/** A builder definition of this query, each select item declared as a column of the type given. */
function builder(
  query: Query,
  types: Record<string, Column['type']>,
  over: Partial<QueryDefinition> = {},
): QueryDefinition {
  const columns = query.select.map((item) => ({
    name: item.name,
    from: { column: item.name },
    type: types[item.name] ?? { base: 'text' },
  }));
  return {
    schemaVersion: 1,
    title: 'Readings by site',
    description: '',
    connection: CONNECTION,
    parameters: [],
    fetch: { kind: 'builder', format: BUILDER_FORMAT, query },
    columns,
    key: [columns[0]!.name],
    order: [{ column: columns[0]!.name, direction: 'ascending' }],
    empty: 'valid',
    limits: { ...defaultLimits },
    retired: false,
    ...over,
  };
}

/** A builder definition's query. */
function queryOf(definition: QueryDefinition): Query {
  if (definition.fetch.kind !== 'builder') throw new Error('Not a builder definition');
  return definition.fetch.query;
}

/** Sites, each with its name: the smallest builder definition. */
const sites = (over: Partial<Query> = {}, rest: Partial<QueryDefinition> = {}) =>
  builder(
    {
      sources: [site],
      joins: [],
      select: [
        { name: 'id', of: ref('s', 'id') },
        { name: 'name', of: ref('s', 'name') },
      ],
      groupBy: [],
      ...over,
    },
    { id: { base: 'integer' } },
    rest,
  );

const parameter = (name: string, over: Partial<Parameter> = {}): Parameter => ({
  name,
  type: { base: 'integer' },
  required: true,
  list: false,
  ...over,
});

/** Every path the shape and the checks refuse a definition at. */
function refusedAt(value: unknown): string[] {
  try {
    parseQueryDefinitionForWrite(value);
  } catch (error) {
    if (error instanceof DefinitionRefused) return error.problems.map((each) => each.path);
    throw error;
  }
  return [];
}

describe("The builder's format", () => {
  it('DAT-100 admits in a stored query several sources joined, grouping, aggregates and nested queries', () => {
    // Per site, the readings a nested query counts and averages by site, beside the readings joined
    // whole: grouped by the site, each of the five aggregates taken.
    const perSite: Query = {
      sources: [reading],
      joins: [],
      select: [
        { name: 'site', of: ref('r', 'site') },
        { name: 'readings', of: { aggregate: 'count' } },
        { name: 'mean', of: { aggregate: 'average', of: ref('r', 'value'), places: 2 } },
      ],
      groupBy: [ref('r', 'site')],
    };
    const definition = builder(
      {
        sources: [
          site,
          { alias: 'p', query: perSite },
          { alias: 'x', table: { schema: 'sample', name: 'reading' } },
        ],
        joins: [
          {
            kind: 'inner',
            source: 'p',
            on: { column: ref('p', 'site'), is: 'equal', to: { column: ref('s', 'id') } },
          },
          {
            kind: 'left',
            source: 'x',
            on: { column: ref('x', 'site'), is: 'equal', to: { column: ref('s', 'id') } },
          },
        ],
        select: [
          { name: 'id', of: ref('s', 'id') },
          { name: 'name', of: ref('s', 'name') },
          { name: 'readings', of: ref('p', 'readings') },
          { name: 'mean', of: ref('p', 'mean') },
          { name: 'counted', of: { aggregate: 'count', of: ref('x', 'id') } },
          { name: 'flags', of: { aggregate: 'sum', of: ref('x', 'flag') } },
          { name: 'average', of: { aggregate: 'average', of: ref('x', 'value'), places: 2 } },
          { name: 'first', of: { aggregate: 'minimum', of: ref('x', 'taken') } },
          { name: 'last', of: { aggregate: 'maximum', of: ref('x', 'taken') } },
        ],
        where: {
          column: ref('s', 'active'),
          is: 'equal',
          to: { literal: true, type: { base: 'boolean' } },
        },
        groupBy: [ref('s', 'id'), ref('s', 'name'), ref('p', 'readings'), ref('p', 'mean')],
      },
      {
        id: { base: 'integer' },
        readings: { base: 'integer' },
        mean: { base: 'decimal', precision: 20, scale: 2 },
        counted: { base: 'integer' },
        flags: { base: 'integer' },
        average: { base: 'decimal', precision: 20, scale: 2 },
        first: { base: 'instant', fraction: 3 },
        last: { base: 'instant', fraction: 3 },
      },
    );

    // Written, parsed and checked as every write path parses one, and stored as written.
    const parsed = parseQueryDefinitionForWrite(definition);
    expect(parsed).toEqual(definition);
    expect(parseQueryDefinition(JSON.parse(canonicalJson(parsed)))).toEqual(definition);

    // And generated: the joins, the nested query, the grouping and each aggregate in the SQL.
    const { text, values } = generatePostgres(parsed, {}, 'run');
    expect(text).toBe(
      [
        'SELECT "s"."id" AS "id", "s"."name" AS "name", "p"."readings" AS "readings", "p"."mean" AS "mean", pg_catalog.count("x"."id") AS "counted", pg_catalog.sum("x"."flag") AS "flags", pg_catalog.round(pg_catalog.avg("x"."value"), 2) AS "average", pg_catalog.min("x"."taken") AS "first", pg_catalog.max("x"."taken") AS "last"',
        'FROM (SELECT "id", "name", "active" FROM "sample"."site") AS "s"',
        'INNER JOIN (SELECT "r"."site" AS "site", pg_catalog.count(*) AS "readings", pg_catalog.round(pg_catalog.avg("r"."value"), 2) AS "mean" FROM (SELECT "site", "value" FROM "sample"."reading") AS "r" GROUP BY "r"."site") AS "p" ON "p"."site" OPERATOR(pg_catalog.=) "s"."id"',
        'LEFT JOIN (SELECT "id", "flag", "value", "taken", "site" FROM "sample"."reading") AS "x" ON "x"."site" OPERATOR(pg_catalog.=) "s"."id"',
        'WHERE "s"."active" OPERATOR(pg_catalog.=) ($1::pg_catalog.bool)',
        'GROUP BY "s"."id", "s"."name", ("s"."name")::pg_catalog.text COLLATE pg_catalog."C", "p"."readings", "p"."mean"',
        'ORDER BY "s"."id" ASC NULLS LAST',
      ].join('\n'),
    );
    expect(values).toEqual(['true']);
  });

  it('refuses each member of the stored shape by its rule', () => {
    const cases: [string, QueryDefinition, string][] = [
      // Row 1: the fetch, format 1 alone.
      [
        'format',
        { ...sites(), fetch: { kind: 'builder', format: 2, query: queryOf(sites()) } } as never,
        'fetch.format',
      ],
      // Row 3: an alias D2's name pattern, unique in its query; a schema named always.
      ['alias', sites({ sources: [{ ...site, alias: 'Site' }] }), 'fetch.query.sources.0.alias'],
      [
        'schema',
        sites({ sources: [{ alias: 's', table: { name: 'site' } } as never] }),
        'fetch.query.sources.0',
      ],
      [
        'alias twice',
        sites({
          sources: [site, { ...reading, alias: 's' }],
          joins: [
            {
              kind: 'inner',
              source: 's',
              on: { column: ref('s', 'id'), is: 'isNotNull' },
            },
          ],
        }),
        'fetch.query.sources.1.alias',
      ],
      // Row 4: each source after the first joined once, in the order listed.
      ['no join', sites({ sources: [site, reading] }), 'fetch.query.joins'],
      [
        'join out of order',
        sites({
          sources: [site, reading],
          joins: [{ kind: 'inner', source: 's', on: { column: ref('s', 'id'), is: 'isNotNull' } }],
        }),
        'fetch.query.joins.0.source',
      ],
      [
        'join on a later source',
        sites({
          sources: [site, reading, { alias: 'z', table: { schema: 'sample', name: 'typed' } }],
          joins: [
            {
              kind: 'inner',
              source: 'r',
              on: { column: ref('z', 'k'), is: 'equal', to: { column: ref('s', 'id') } },
            },
            { kind: 'left', source: 'z', on: { column: ref('z', 'k'), is: 'isNotNull' } },
          ],
        }),
        'fetch.query.joins.0.on.column.source',
      ],
      [
        'join kind',
        sites({
          sources: [site, reading],
          joins: [{ kind: 'full', source: 'r', on: { column: ref('r', 'id'), is: 'isNotNull' } }],
        } as never),
        'fetch.query.joins.0.kind',
      ],
      // Row 5: select names unique; `of` required but for count; places on average alone.
      [
        'select name twice',
        sites({
          select: [
            { name: 'id', of: ref('s', 'id') },
            { name: 'id', of: ref('s', 'name') },
          ],
        }),
        'fetch.query.select.1.name',
      ],
      [
        'sum of nothing',
        sites({
          select: [
            { name: 'id', of: ref('s', 'id') },
            { name: 'name', of: { aggregate: 'sum' } },
          ],
          groupBy: [ref('s', 'id')],
        }),
        'fetch.query.select.1.of.of',
      ],
      [
        'places on a sum',
        sites({
          select: [
            { name: 'id', of: ref('s', 'id') },
            { name: 'name', of: { aggregate: 'sum', of: ref('s', 'depth'), places: 2 } },
          ],
          groupBy: [ref('s', 'id')],
        }),
        'fetch.query.select.1.of.places',
      ],
      [
        'average without places',
        sites({
          select: [
            { name: 'id', of: ref('s', 'id') },
            { name: 'name', of: { aggregate: 'average', of: ref('s', 'depth') } },
          ],
          groupBy: [ref('s', 'id')],
        }),
        'fetch.query.select.1.of.places',
      ],
      // Row 6: a column reference names a source in scope, and a nested source's own select name.
      [
        'source out of scope',
        sites({
          select: [
            { name: 'id', of: ref('q', 'id') },
            { name: 'name', of: ref('s', 'name') },
          ],
        }),
        'fetch.query.select.0.of.source',
      ],
      [
        'a column a nested query does not select',
        sites({
          sources: [
            {
              alias: 'n',
              query: {
                sources: [site],
                joins: [],
                select: [{ name: 'id', of: ref('s', 'id') }],
                groupBy: [],
              },
            },
          ],
          select: [
            { name: 'id', of: ref('n', 'id') },
            { name: 'name', of: ref('n', 'name') },
          ],
        }),
        'fetch.query.select.1.of.column',
      ],
      // Row 7: `to` absent exactly for the null tests; a literal canonical, not null; in a list.
      [
        'to on isNull',
        sites({
          where: {
            column: ref('s', 'id'),
            is: 'isNull',
            to: { literal: '1', type: { base: 'integer' } },
          },
        }),
        'fetch.query.where.to',
      ],
      ['no to', sites({ where: { column: ref('s', 'id'), is: 'equal' } }), 'fetch.query.where.to'],
      [
        'literal not canonical',
        sites({
          where: {
            column: ref('s', 'id'),
            is: 'equal',
            to: { literal: '01', type: { base: 'integer' } },
          },
        }),
        'fetch.query.where.to.literal',
      ],
      [
        'literal null',
        sites({
          where: {
            column: ref('s', 'id'),
            is: 'equal',
            to: { literal: null, type: { base: 'integer' } },
          },
        }),
        'fetch.query.where.to.literal',
      ],
      [
        'in a value',
        sites({
          where: {
            column: ref('s', 'id'),
            is: 'in',
            to: { literal: '1', type: { base: 'integer' } },
          },
        }),
        'fetch.query.where.to.literal',
      ],
      [
        'in an empty list',
        sites({
          where: {
            column: ref('s', 'id'),
            is: 'in',
            to: { literal: [], type: { base: 'integer' } },
          },
        }),
        'fetch.query.where.to.literal',
      ],
      [
        'less than text',
        sites({
          where: {
            column: ref('s', 'name'),
            is: 'less',
            to: { literal: 'm', type: { base: 'text' } },
          },
        }),
        'fetch.query.where.is',
      ],
      [
        'contains a number',
        sites({
          where: {
            column: ref('s', 'id'),
            is: 'contains',
            to: { literal: '1', type: { base: 'integer' } },
          },
        }),
        'fetch.query.where.is',
      ],
      [
        'contains a column',
        sites({
          where: { column: ref('s', 'name'), is: 'contains', to: { column: ref('s', 'code') } },
        }),
        'fetch.query.where.to',
      ],
      [
        'an and of one',
        sites({ where: { and: [{ column: ref('s', 'id'), is: 'isNotNull' }] } }),
        'fetch.query',
      ],
      // Row 8: grouping distinct; where grouped, every column selected is grouped.
      [
        'grouped twice',
        sites({ groupBy: [ref('s', 'id'), ref('s', 'name'), ref('s', 'id')] }),
        'fetch.query.groupBy.2',
      ],
      ['a column not grouped', sites({ groupBy: [ref('s', 'id')] }), 'fetch.query.select.1.of'],
      // Row 9: a builder's parameter declares no variation, is used, and only as its kind allows.
      [
        'variation',
        sites(
          { where: { column: ref('s', 'name'), is: 'equal', to: { parameter: 'v' } } },
          {
            parameters: [
              parameter('v', { type: { base: 'text' }, variation: [{ key: 'a', sql: 'a' }] }),
            ],
          },
        ),
        'parameters.0.variation',
      ],
      ['unused', sites({}, { parameters: [parameter('site')] }), 'parameters.0'],
      [
        'undeclared',
        sites({ where: { column: ref('s', 'id'), is: 'equal', to: { parameter: 'site' } } }),
        'fetch.query.where.to.parameter',
      ],
      [
        'a list by equal',
        sites(
          { where: { column: ref('s', 'id'), is: 'equal', to: { parameter: 'ids' } } },
          { parameters: [parameter('ids', { list: true })] },
        ),
        'fetch.query.where.to.parameter',
      ],
      [
        'text by greater',
        sites(
          { where: { column: ref('s', 'name'), is: 'greater', to: { parameter: 'n' } } },
          { parameters: [parameter('n', { type: { base: 'text' } })] },
        ),
        'fetch.query.where.is',
      ],
      // Row 10: each column from a select name, each select name declared once; an average's column
      // a decimal of scale at least its places, or an integer at 0.
      [
        'a column from nothing selected',
        sites(
          {},
          {
            columns: [
              { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
              { name: 'name', from: { column: 'code' }, type: { base: 'text' } },
            ],
          },
        ),
        'columns.1.from.column',
      ],
      [
        'a select name declared twice',
        sites(
          {},
          {
            columns: [
              { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
              { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
              { name: 'again', from: { column: 'name' }, type: { base: 'text' } },
            ],
          },
        ),
        'columns.2.from.column',
      ],
      [
        'a select name not declared',
        sites(
          {},
          {
            columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
          },
        ),
        'fetch.query.select.1',
      ],
      [
        'an average to fewer places than declared',
        builder(
          {
            sources: [site],
            joins: [],
            select: [
              { name: 'id', of: ref('s', 'id') },
              { name: 'depth', of: { aggregate: 'average', of: ref('s', 'depth'), places: 3 } },
            ],
            groupBy: [ref('s', 'id')],
          },
          { id: { base: 'integer' }, depth: { base: 'decimal', precision: 10, scale: 2 } },
        ),
        'columns.1.type',
      ],
      [
        'an average to places declared an integer',
        builder(
          {
            sources: [site],
            joins: [],
            select: [
              { name: 'id', of: ref('s', 'id') },
              { name: 'depth', of: { aggregate: 'average', of: ref('s', 'depth'), places: 1 } },
            ],
            groupBy: [ref('s', 'id')],
          },
          { id: { base: 'integer' }, depth: { base: 'integer' } },
        ),
        'columns.1.type',
      ],
      // Row 11: a limit at the top alone, a whole number to the ceiling, only beside an order.
      ['limit over the ceiling', sites({ limit: limitCeilings.rows + 1 }), 'fetch.query.limit'],
      ['limit on a multiset', sites({ limit: 10 }, { order: 'multiset' }), 'fetch.query.limit'],
      [
        'limit nested',
        sites({
          sources: [
            {
              alias: 'n',
              query: {
                sources: [site],
                joins: [],
                select: [
                  { name: 'id', of: ref('s', 'id') },
                  { name: 'name', of: ref('s', 'name') },
                ],
                groupBy: [],
                limit: 5,
              },
            },
          ],
          select: [
            { name: 'id', of: ref('n', 'id') },
            { name: 'name', of: ref('n', 'name') },
          ],
        }),
        'fetch.query.sources.0.query.limit',
      ],
    ];
    for (const [what, definition, path] of cases) {
      expect(refusedAt(definition), what).toContain(path);
    }
    // And the smallest definition passes, with a limit beside its order.
    expect(refusedAt(sites({ limit: 10 }))).toEqual([]);
  });

  it('refuses a tree 100,000 deep by name and never throws a RangeError', () => {
    // Written as JSON text, as a hostile body arrives: JSON.parse reads 100,000 levels, where neither
    // JSON.stringify nor a recursive schema could.
    const depth = 100_000;
    const leaf = JSON.stringify({ column: ref('s', 'id'), is: 'isNotNull' });
    const where = `${'{"not":'.repeat(depth)}${leaf}${'}'.repeat(depth)}`;
    const top = queryOf(sites());
    const rest = JSON.stringify({ joins: [], select: top.select, groupBy: [] }).slice(1);
    const query = `${'{"sources":[{"alias":"s","query":'.repeat(depth)}${JSON.stringify(top)}${`}],${rest}`.repeat(depth)}`;
    for (const tree of [
      `{"sources":${JSON.stringify(top.sources)},${rest.slice(0, -1)},"where":${where}}`,
      query,
    ]) {
      const body = JSON.parse(JSON.stringify(sites())) as { fetch: { query: unknown } };
      body.fetch.query = JSON.parse(tree);
      let refused: unknown;
      try {
        parseQueryDefinition(body);
      } catch (error) {
        refused = error;
      }
      expect(refused).toBeInstanceOf(DefinitionRefused);
      expect((refused as DefinitionRefused).problems[0]!.path).toBe('fetch.query');
      expect((refused as DefinitionRefused).problems[0]!.message).toMatch(
        /nests at most (4|8) deep/,
      );
    }
  });

  it('walks the tree before the schema recurses: 1,000 deep is refused, not thrown', () => {
    let where: Condition = { column: ref('s', 'id'), is: 'isNotNull' };
    for (let at = 0; at < 1000; at += 1) where = { and: [where, where] };
    expect(treeProblem({ ...queryOf(sites()), where })).toMatch(/A condition nests at most 8 deep/);
    expect(refusedAt(sites({ where }))).toEqual(['fetch.query']);
  });

  it("holds the walk's bounds either side", () => {
    const nest = (depth: number): Condition => {
      let where: Condition = { column: ref('s', 'id'), is: 'isNotNull' };
      for (let at = 1; at < depth; at += 1) where = { not: where };
      return where;
    };
    expect(treeProblem(queryOf(sites({ where: nest(8) })))).toBeUndefined();
    expect(treeProblem(queryOf(sites({ where: nest(9) })))).toMatch(/at most 8 deep/);

    const nested = (depth: number): Query => {
      let query = queryOf(sites());
      for (let at = 1; at < depth; at += 1) {
        query = { ...queryOf(sites()), sources: [{ alias: 's', query }] };
      }
      return query;
    };
    expect(treeProblem(nested(4))).toBeUndefined();
    expect(
      refusedAt({ ...sites(), fetch: { kind: 'builder', format: 1, query: nested(4) } }),
    ).toEqual([]);
    expect(treeProblem(nested(5))).toMatch(/A query nests at most 4 deep/);

    const sources = (count: number) =>
      Array.from({ length: count }, (_, at) => ({
        alias: `t${at}`,
        table: { schema: 'sample', name: 'site' },
      }));
    expect(treeProblem({ ...queryOf(sites()), sources: sources(16) })).toBeUndefined();
    expect(treeProblem({ ...queryOf(sites()), sources: sources(17) })).toMatch(
      /at most 16 sources/,
    );

    // Whole groups of 32 in an `and` each, and any left over beside them in the `or`.
    const comparison = { column: ref('s', 'id'), is: 'isNotNull' as const };
    const comparisons = (count: number): Condition => ({
      or: [
        ...Array.from({ length: Math.floor(count / 32) }, () => ({
          and: Array.from({ length: 32 }, () => comparison),
        })),
        ...Array.from({ length: count % 32 }, () => comparison),
      ],
    });
    expect(treeProblem(queryOf(sites({ where: comparisons(256) })))).toBeUndefined();
    expect(treeProblem(queryOf(sites({ where: comparisons(257) })))).toMatch(
      /at most 256 comparisons/,
    );
    expect(
      treeProblem(queryOf(sites({ where: { and: Array.from({ length: 33 }, () => nest(1)) } }))),
    ).toMatch(/2 to 32/);
  });

  it("words an average's places past their bounds as the product's own sentence", () => {
    const averaged = (places: number) =>
      sites({
        select: [
          { name: 'id', of: ref('s', 'id') },
          { name: 'name', of: { aggregate: 'average', of: ref('s', 'depth'), places } },
        ],
        groupBy: [ref('s', 'id')],
      });
    for (const places of [1001, -1]) {
      let refused: unknown;
      try {
        parseQueryDefinitionForWrite(averaged(places));
      } catch (error) {
        refused = error;
      }
      expect(refused).toBeInstanceOf(DefinitionRefused);
      const problem = (refused as DefinitionRefused).problems.find(
        (each) => each.path === 'fetch.query.select.1.of.places',
      );
      expect(problem?.message).toBe(
        'An average is rounded to a whole number of places, 0 to 1,000',
      );
    }
  });

  it('refuses text not in NFC in an alias, a name and a literal', () => {
    const decomposed = 'café';
    expect(refusedAt(sites({ sources: [{ ...site, alias: decomposed }] }))).toContain(
      'fetch.query.sources.0.alias',
    );
    expect(
      refusedAt(
        sites({ sources: [{ alias: 's', table: { schema: 'sample', name: decomposed } }] }),
      ),
    ).toContain('fetch.query.sources.0.table.name');
    expect(
      refusedAt(
        sites({
          where: {
            column: ref('s', 'name'),
            is: 'equal',
            to: { literal: decomposed, type: { base: 'text' } },
          },
        }),
      ),
    ).toContain('fetch.query.where.to.literal');
  });

  it('keeps the order of an and: two orders, two digests; two member orders, one', () => {
    const a = { column: ref('s', 'id'), is: 'isNotNull' as const };
    const b = { column: ref('s', 'name'), is: 'isNotNull' as const };
    const one = sites({ where: { and: [a, b] } });
    const other = sites({ where: { and: [b, a] } });
    expect(canonicalJson(one)).not.toBe(canonicalJson(other));
    const reordered = sites({ where: { and: [{ is: 'isNotNull', column: ref('s', 'id') }, b] } });
    expect(canonicalJson(reordered)).toBe(canonicalJson(one));
  });

  it('takes a builder draft as a sample does', () => {
    const draft: Record<string, unknown> = { ...sites() };
    for (const member of ['title', 'description', 'retired']) delete draft[member];
    expect(parseDraftDefinition(draft)).toEqual(draft);
  });
});
