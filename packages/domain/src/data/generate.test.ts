import { describe, expect, it } from 'vitest';

import {
  BUILDER_FORMAT,
  type Comparison,
  type Condition,
  type Operand,
  type Query,
} from './builder.js';
import {
  checkQueryDefinition,
  type Column,
  type Parameter,
  type QueryDefinition,
} from './definition.js';
import { bindFetch } from './fetch.js';
import { generatedLength, generatePostgres } from './generate.js';
import { defaultLimits } from './limits.js';
import type { ParameterValues } from './parameters.js';
import { RAN_MAX_CHARACTERS } from './sql.js';

const CONNECTION = '00000000-0000-4000-8000-00000000c0c0';
const site = { alias: 's', table: { schema: 'sample', name: 'site' } };
const ref = (source: string, column: string) => ({ source, column });

function builder(
  query: Query,
  types: Record<string, Column['type']> = {},
  over: Partial<QueryDefinition> = {},
): QueryDefinition {
  const columns = query.select.map((item) => ({
    name: item.name,
    from: { column: item.name },
    type: types[item.name] ?? { base: 'integer' },
  }));
  return {
    schemaVersion: 1,
    title: 'Sites',
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

const parameter = (name: string, type: Parameter['type'], over: Partial<Parameter> = {}) => ({
  name,
  type,
  required: true,
  list: false,
  ...over,
});

/** A query of sites filtered by this condition, selecting the id alone. */
const filtered = (where: Condition, parameters: Parameter[] = []) =>
  builder(
    {
      sources: [site],
      joins: [],
      select: [{ name: 'id', of: ref('s', 'id') }],
      where,
      groupBy: [],
    },
    {},
    { parameters },
  );

const compare = (column: string, is: Comparison, to?: Operand): Condition => ({
  column: ref('s', column),
  is,
  ...(to ? { to } : {}),
});

/** The eight bases, each with two values of its type that differ, the second hostile where it can be. */
const TYPED: [Parameter['type'], string | boolean, string | boolean][] = [
  [{ base: 'text' }, 'Ada', "'); drop table sample.site; --"],
  [{ base: 'integer' }, '1', '-9223372036854775808'],
  [{ base: 'decimal', precision: 12, scale: 4 }, '1.25', '-99999999.9999'],
  [{ base: 'date' }, '2026-09-01', '1900-03-01'],
  [{ base: 'time', fraction: 3 }, '09:00:00', '23:59:59.999'],
  [{ base: 'localDateTime', fraction: 6 }, '2026-09-01T09:00:00', '1969-12-31T23:59:59.999999'],
  [{ base: 'instant', fraction: 3 }, '2026-09-01T08:00:00Z', '1970-01-01T00:00:00.001Z'],
  [{ base: 'boolean' }, true, false],
];

/** Which comparisons a value of each base takes, as the builder's checks allow them (D4-C, D4-G). */
function comparisonsFor(base: Parameter['type']['base']): Comparison[] {
  if (base === 'text') return ['equal', 'notEqual', 'contains', 'startsWith'];
  if (base === 'boolean') return ['equal', 'notEqual'];
  return ['equal', 'notEqual', 'less', 'lessOrEqual', 'greater', 'greaterOrEqual'];
}

describe("PostgreSQL's generator", () => {
  it("DAT-081 binds every value of a built query, a literal's too, as the driver's parameter and never places one in the text", () => {
    // Every comparison over every value type, as a parameter, as a literal and as a list in `in`,
    // optional and required, generated twice with different values.
    const parameters: Parameter[] = [];
    const conditions: Condition[] = [];
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = {};
    const literals: Condition[][] = [[], []];
    for (const [at, [type, one, two]] of TYPED.entries()) {
      for (const is of comparisonsFor(type.base)) {
        const name = `p${at}_${is.toLowerCase()}`;
        parameters.push(parameter(name, type, { required: is !== 'equal' }));
        conditions.push(compare('c', is, { parameter: name }));
        first[name] = one;
        second[name] = two;
        for (const [round, value] of [one, two].entries()) {
          literals[round]!.push(compare('c', is, { literal: value, type }));
        }
      }
      const list = `l${at}`;
      parameters.push(parameter(list, type, { list: true }));
      conditions.push(compare('c', 'in', { parameter: list }));
      first[list] = [one, two];
      second[list] = [two];
      for (const [round, value] of [[one, two], [two]].entries()) {
        literals[round]!.push(compare('c', 'in', { literal: value, type }));
      }
    }
    const nulls = [compare('c', 'isNull'), compare('c', 'isNotNull')];
    const definitions = [0, 1].map((round) =>
      filtered(
        {
          or: [
            { and: conditions.slice(0, 30) },
            { and: conditions.slice(30) },
            { and: literals[round]!.slice(0, 30) },
            { and: [...literals[round]!.slice(30), ...nulls] },
          ],
        },
        parameters,
      ),
    );
    // Every definition passes the builder's checks, so each comparison is one an author can write.
    for (const definition of definitions) expect(checkQueryDefinition(definition)).toEqual([]);

    const bound = [
      generatePostgres(definitions[0]!, first as ParameterValues, 'run'),
      generatePostgres(definitions[1]!, second as ParameterValues, 'run'),
    ];
    // One text, whatever the values and the literals.
    expect(bound[0]!.text).toBe(bound[1]!.text);
    // Each value, the literals' too, is a placeholder the driver binds, in its type.
    const placeholders = bound[0]!.text.match(/\(\$[0-9]+::pg_catalog\.[a-z0-9]+(?:\[\])?\)/g)!;
    expect(new Set(placeholders).size).toBe(bound[0]!.values.length);
    expect(bound[0]!.values.length).toBe(parameters.length + literals[0]!.length);
    for (const [round, values] of [first, second].entries()) {
      for (const [name, value] of Object.entries(values)) {
        const at = parameters.findIndex((each) => each.name === name);
        const expected = Array.isArray(value) ? value.map(String) : String(value);
        expect(bound[round]!.values[at]).toEqual(expected);
      }
    }
    // And none of them is in the text: not the hostile text, not a number, not a date.
    for (const [, one, two] of TYPED) {
      for (const value of [one, two]) {
        if (typeof value === 'string' && value.length > 2) {
          expect(bound[0]!.text).not.toContain(value);
        }
      }
    }
  });

  it("DAT-018 lets no parameter change a built query's shape", () => {
    const parameters = [
      parameter('site', { base: 'integer' }, { required: false }),
      parameter('names', { base: 'text' }, { required: false, list: true }),
      parameter('part', { base: 'text' }, { required: false }),
    ];
    const definition = filtered(
      {
        and: [
          compare('id', 'greaterOrEqual', { parameter: 'site' }),
          compare('name', 'in', { parameter: 'names' }),
          compare('name', 'contains', { parameter: 'part' }),
        ],
      },
      parameters,
    );
    expect(checkQueryDefinition(definition)).toEqual([]);
    const given = generatePostgres(
      definition,
      { site: '2', names: ['Ada', 'Grace'], part: 'a' },
      'run',
    );
    const notGiven = generatePostgres(definition, {}, 'run');
    const hostile = generatePostgres(
      definition,
      { site: '1', names: ['" or true --'], part: '%) or (1 = 1' },
      'run',
    );
    // An optional parameter given no value is true: the same text, its value null.
    expect(notGiven.text).toBe(given.text);
    expect(hostile.text).toBe(given.text);
    expect(notGiven.values).toEqual([null, null, null]);
    expect(given.text).toBe(
      [
        'SELECT "s"."id" AS "id"',
        'FROM (SELECT "id", "name" FROM "sample"."site") AS "s"',
        'WHERE ((($1::pg_catalog.int8) IS NULL OR "s"."id" OPERATOR(pg_catalog.>=) ($1::pg_catalog.int8)) AND (($2::pg_catalog.text[]) IS NULL OR ("s"."name")::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) ANY (($2::pg_catalog.text[]))) AND (($3::pg_catalog.text) IS NULL OR pg_catalog.strpos(("s"."name")::pg_catalog.text COLLATE pg_catalog."C", ($3::pg_catalog.text)) OPERATOR(pg_catalog.>) 0))',
        'ORDER BY "s"."id" ASC NULLS LAST',
      ].join('\n'),
    );
  });

  it('binds a parameter used twice once, and each literal apart', () => {
    const definition = filtered(
      {
        or: [
          compare('id', 'equal', { parameter: 'site' }),
          compare('id', 'greater', { parameter: 'site' }),
          compare('id', 'equal', { literal: '7', type: { base: 'integer' } }),
          compare('id', 'equal', { literal: '7', type: { base: 'integer' } }),
        ],
      },
      [parameter('site', { base: 'integer' })],
    );
    const { text, values } = generatePostgres(definition, { site: '3' }, 'run');
    expect(text).toContain(
      'WHERE ("s"."id" OPERATOR(pg_catalog.=) ($1::pg_catalog.int8) OR "s"."id" OPERATOR(pg_catalog.>) ($1::pg_catalog.int8) OR "s"."id" OPERATOR(pg_catalog.=) ($2::pg_catalog.int8) OR "s"."id" OPERATOR(pg_catalog.=) ($3::pg_catalog.int8))',
    );
    expect(values).toEqual(['3', '7', '7']);
  });

  it('quotes every identifier and reads it back whole, whatever it holds', () => {
    const names = ['a"b', '$1', 'x -- y', 'x /* y', "it's", 'café \u{20BB7}', 'select'];
    for (const name of names) {
      const definition = builder(
        {
          sources: [{ alias: 't', table: { schema: name, name } }],
          joins: [],
          select: [{ name, of: ref('t', name) }],
          where: { column: ref('t', name), is: 'equal', to: { parameter: 'v' } },
          groupBy: [],
        },
        {},
        { parameters: [parameter('v', { base: 'integer' })] },
      );
      expect(checkQueryDefinition(definition), name).toEqual([]);
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const { text, values } = generatePostgres(definition, { v: '1' }, 'run');
      expect(text).toBe(
        [
          `SELECT "t".${quoted} AS ${quoted}`,
          `FROM (SELECT ${quoted} FROM ${quoted}.${quoted}) AS "t"`,
          `WHERE "t".${quoted} OPERATOR(pg_catalog.=) ($1::pg_catalog.int8)`,
          `ORDER BY "t".${quoted} ASC NULLS LAST`,
        ].join('\n'),
      );
      expect(values).toEqual(['1']);
    }
  });

  it("names every function, operator and type by pg_catalog's", () => {
    const definition = builder(
      {
        sources: [site],
        joins: [],
        select: [
          { name: 'name', of: ref('s', 'name') },
          { name: 'sites', of: { aggregate: 'count' } },
          { name: 'opened', of: { aggregate: 'count', of: ref('s', 'opened') } },
          { name: 'total', of: { aggregate: 'sum', of: ref('s', 'depth') } },
          { name: 'mean', of: { aggregate: 'average', of: ref('s', 'depth'), places: 2 } },
          { name: 'low', of: { aggregate: 'minimum', of: ref('s', 'code') } },
          { name: 'high', of: { aggregate: 'maximum', of: ref('s', 'code') } },
        ],
        where: {
          and: [
            compare('code', 'startsWith', { parameter: 'prefix' }),
            { not: compare('opened', 'less', { literal: '2020-01-01', type: { base: 'date' } }) },
            compare('ratio', 'isNotNull'),
          ],
        },
        groupBy: [ref('s', 'name')],
      },
      {
        name: { base: 'text' },
        total: { base: 'decimal', precision: 10, scale: 2 },
        mean: { base: 'decimal', precision: 10, scale: 2 },
        low: { base: 'text' },
        high: { base: 'text' },
      },
      { parameters: [parameter('prefix', { base: 'text' })] },
    );
    expect(checkQueryDefinition(definition)).toEqual([]);
    for (const statement of ['shape', 'run'] as const) {
      const { text } = generatePostgres(definition, { prefix: 'N' }, statement);
      // Outside quoted names, every call, cast and operator is pg_catalog's.
      const unquoted = text.replace(/"(?:[^"]|"")*"/g, '""');
      for (const call of unquoted.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\(/g)) {
        expect(
          ['OPERATOR', 'ANY', 'IN'].includes(call[1]!) || call[1]!.startsWith('pg_catalog.'),
          call[1],
        ).toBe(true);
      }
      for (const cast of unquoted.matchAll(/::([A-Za-z_][A-Za-z0-9_.]*)/g)) {
        expect(cast[1]!.startsWith('pg_catalog.'), cast[1]).toBe(true);
      }
      for (const operator of unquoted.matchAll(/OPERATOR\(([^)]*)\)/g)) {
        expect(operator[1]!.startsWith('pg_catalog.'), operator[1]).toBe(true);
      }
      // And no bare operator stands between two operands.
      expect(unquoted.replace(/OPERATOR\([^)]*\)/g, '').replace(/::/g, '')).not.toMatch(/[<>=]/);
    }
  });

  it('keys a text-declared column by code point in its order, its grouping, its minimum and maximum, and no other', () => {
    const query: Query = {
      sources: [site],
      joins: [],
      select: [
        { name: 'name', of: ref('s', 'name') },
        { name: 'id', of: ref('s', 'id') },
        { name: 'low', of: { aggregate: 'minimum', of: ref('s', 'code') } },
        { name: 'first', of: { aggregate: 'minimum', of: ref('s', 'opened') } },
        { name: 'high', of: { aggregate: 'maximum', of: ref('s', 'code') } },
      ],
      groupBy: [ref('s', 'name'), ref('s', 'id')],
    };
    const definition = builder(
      query,
      {
        name: { base: 'text' },
        low: { base: 'text' },
        high: { base: 'text' },
        first: { base: 'date' },
      },
      {
        key: ['name', 'id'],
        order: [
          { column: 'name', direction: 'descending' },
          { column: 'high', direction: 'ascending' },
          { column: 'id', direction: 'ascending' },
        ],
      },
    );
    expect(checkQueryDefinition(definition)).toEqual([]);
    const C = 'pg_catalog.text COLLATE pg_catalog."C"';
    expect(generatePostgres(definition, {}, 'run').text).toBe(
      [
        `SELECT "s"."name" AS "name", "s"."id" AS "id", pg_catalog.min(("s"."code")::${C}) AS "low", pg_catalog.min("s"."opened") AS "first", pg_catalog.max(("s"."code")::${C}) AS "high"`,
        'FROM (SELECT "name", "id", "code", "opened" FROM "sample"."site") AS "s"',
        `GROUP BY "s"."name", ("s"."name")::${C}, "s"."id"`,
        `ORDER BY ("s"."name")::${C} DESC NULLS FIRST, (pg_catalog.max(("s"."code")::${C}))::${C} ASC NULLS LAST, "s"."id" ASC NULLS LAST`,
      ].join('\n'),
    );
    // The shape statement holds no key, no order and no limit (D4-H).
    expect(
      generatePostgres(
        {
          ...definition,
          fetch: { ...definition.fetch, query: { ...query, limit: 5 } } as QueryDefinition['fetch'],
        },
        {},
        'shape',
      ).text,
    ).toBe(
      [
        'SELECT "s"."name" AS "name", "s"."id" AS "id", pg_catalog.min("s"."code") AS "low", pg_catalog.min("s"."opened") AS "first", pg_catalog.max("s"."code") AS "high"',
        'FROM (SELECT "name", "id", "code", "opened" FROM "sample"."site") AS "s"',
        'GROUP BY "s"."name", "s"."id"',
      ].join('\n'),
    );
  });

  it("keys a nested query's column a text-declared column reads, and limits the top alone", () => {
    const inner: Query = {
      sources: [site],
      joins: [],
      select: [
        { name: 'name', of: ref('s', 'name') },
        { name: 'code', of: ref('s', 'code') },
        { name: 'deepest', of: { aggregate: 'maximum', of: ref('s', 'depth') } },
      ],
      groupBy: [ref('s', 'name'), ref('s', 'code')],
    };
    const definition = builder(
      {
        sources: [{ alias: 'n', query: inner }],
        joins: [],
        select: [
          { name: 'name', of: ref('n', 'name') },
          { name: 'deepest', of: ref('n', 'deepest') },
        ],
        groupBy: [],
        limit: 10,
      },
      { name: { base: 'text' }, deepest: { base: 'decimal', precision: 8, scale: 2 } },
    );
    expect(checkQueryDefinition(definition)).toEqual([]);
    const C = 'pg_catalog.text COLLATE pg_catalog."C"';
    expect(generatePostgres(definition, {}, 'run').text).toBe(
      [
        `SELECT "n"."name" AS "name", "n"."deepest" AS "deepest"`,
        `FROM (SELECT "s"."name" AS "name", "s"."code" AS "code", pg_catalog.max("s"."depth") AS "deepest" FROM (SELECT "name", "code", "depth" FROM "sample"."site") AS "s" GROUP BY "s"."name", ("s"."name")::${C}, "s"."code") AS "n"`,
        `ORDER BY ("n"."name")::${C} ASC NULLS LAST`,
        'LIMIT 10',
      ].join('\n'),
    );
  });

  it('reads every table through a derived table of the bare names of exactly the columns the tree names of it', () => {
    // A column named by a qualified reference to a table that lacks it would be read by PostgreSQL as
    // a function of the row, `"s"."f"` as f(s); a bare name in a one-table select list never is.
    const reading = { alias: 'r', table: { schema: 'sample', name: 'reading' } };
    const other = { alias: 'o', table: { schema: 'sample', name: 'site' } };
    const definition = builder(
      {
        sources: [site, reading, other],
        joins: [
          {
            kind: 'inner',
            source: 'r',
            on: { column: ref('r', 'site'), is: 'equal', to: { column: ref('s', 'id') } },
          },
          { kind: 'left', source: 'o', on: { column: ref('o', 'id'), is: 'isNotNull' } },
        ],
        select: [
          { name: 'id', of: ref('s', 'id') },
          { name: 'n', of: { aggregate: 'count' } },
          { name: 'again', of: { aggregate: 'count', of: ref('s', 'id') } },
        ],
        where: { column: ref('s', 'active'), is: 'isNotNull' },
        groupBy: [ref('s', 'id'), ref('s', 'region')],
      },
      {},
      { key: [], order: 'multiset' },
    );
    expect(checkQueryDefinition(definition)).toEqual([]);
    expect(generatePostgres(definition, {}, 'run').text).toBe(
      [
        'SELECT "s"."id" AS "id", pg_catalog.count(*) AS "n", pg_catalog.count("s"."id") AS "again"',
        'FROM (SELECT "id", "active", "region" FROM "sample"."site") AS "s"',
        'INNER JOIN (SELECT "site" FROM "sample"."reading") AS "r" ON "r"."site" OPERATOR(pg_catalog.=) "s"."id"',
        'LEFT JOIN (SELECT "id" FROM "sample"."site") AS "o" ON "o"."id" IS NOT NULL',
        'WHERE "s"."active" IS NOT NULL',
        'GROUP BY "s"."id", "s"."region"',
      ].join('\n'),
    );
    // A table no column is named of - a count of its rows - is read through a select of no columns.
    const counted = builder(
      {
        sources: [site],
        joins: [],
        select: [{ name: 'n', of: { aggregate: 'count' } }],
        groupBy: [],
      },
      {},
      { key: [], order: 'multiset' },
    );
    expect(generatePostgres(counted, {}, 'shape').text).toBe(
      ['SELECT pg_catalog.count(*) AS "n"', 'FROM (SELECT FROM "sample"."site") AS "s"'].join('\n'),
    );
  });

  it('rounds an average to its places', () => {
    const definition = builder(
      {
        sources: [site],
        joins: [],
        select: [
          { name: 'id', of: ref('s', 'id') },
          { name: 'whole', of: { aggregate: 'average', of: ref('s', 'depth'), places: 0 } },
          { name: 'fine', of: { aggregate: 'average', of: ref('s', 'depth'), places: 1000 } },
        ],
        groupBy: [ref('s', 'id')],
      },
      { whole: { base: 'integer' }, fine: { base: 'decimal', precision: 1000, scale: 1000 } },
    );
    expect(checkQueryDefinition(definition)).toEqual([]);
    const { text } = generatePostgres(definition, {}, 'run');
    expect(text).toContain('pg_catalog.round(pg_catalog.avg("s"."depth"), 0) AS "whole"');
    expect(text).toContain('pg_catalog.round(pg_catalog.avg("s"."depth"), 1000) AS "fine"');
  });

  it('refuses a definition whose run would generate more than the bound, and takes one at it', () => {
    // A maximum of a text-declared column reads its column twice, keyed, under a name of quotes that
    // doubles when quoted: about 200 characters an item, from about 260 bytes of definition.
    const column = '"'.repeat(63);
    const wide = (count: number) => {
      const select = Array.from({ length: count }, (_, at) => ({
        name: `c${String(at).padStart(4, '0')}`,
        of: { aggregate: 'maximum' as const, of: ref('s', column) },
      }));
      return builder(
        { sources: [site], joins: [], select, groupBy: [] },
        Object.fromEntries(select.map((item) => [item.name, { base: 'text' as const }])),
      );
    };
    const [one, two] = [wide(1), wide(2)].map((each) => generatedLength(each).run);
    const each = two! - one!;
    const most = 1 + Math.floor((RAN_MAX_CHARACTERS - one!) / each);
    expect(most).toBeLessThan(1664);
    expect(generatedLength(wide(most)).run).toBeLessThanOrEqual(RAN_MAX_CHARACTERS);
    expect(checkQueryDefinition(wide(most))).toEqual([]);
    expect(generatedLength(wide(most + 1)).run).toBeGreaterThan(RAN_MAX_CHARACTERS);
    expect(checkQueryDefinition(wide(most + 1))).toEqual([
      {
        rule: 'definition_invalid',
        path: 'fetch.query',
        message: `The query generates at most 300,000 characters of SQL; this one generates ${generatedLength(wide(most + 1)).run.toLocaleString('en-GB')}`,
      },
    ]);
  });

  it("binds a SQL fetch by D2's binder and a builder fetch by the generator", () => {
    const built = filtered(compare('id', 'equal', { parameter: 'site' }), [
      parameter('site', { base: 'integer' }),
    ]);
    expect(bindFetch(built, { site: '1' })).toEqual(generatePostgres(built, { site: '1' }, 'run'));
    expect(bindFetch(built, { site: '1' }, 'shape')).toEqual(
      generatePostgres(built, { site: '1' }, 'shape'),
    );
    const sql = {
      ...built,
      fetch: {
        kind: 'sql' as const,
        text: 'select id from sample.site where id = {{site}} order by id',
      },
    };
    expect(bindFetch(sql, { site: '1' }, 'shape')).toEqual({
      text: 'select id from sample.site where id =  ($1::int8)  order by id',
      values: ['1'],
    });
  });
});
