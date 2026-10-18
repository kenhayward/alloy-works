import { describe, expect, it } from 'vitest';

import type { Query } from './builder.js';
import type { ColumnType } from './columns.js';
import { checkDatasetQuery, evaluateDatasetQuery, type DatasetSource } from './dataset-query.js';
import type { Parameter } from './definition.js';

const integer = { base: 'integer' } as const satisfies ColumnType;
const text = { base: 'text' } as const satisfies ColumnType;
const decimal = (precision: number, scale: number) =>
  ({ base: 'decimal', precision, scale }) as const satisfies ColumnType;

/** Site readings, as a stored result holds them. */
const readings: DatasetSource = {
  columns: [
    ['site', text],
    ['region', text],
    ['reading', decimal(6, 2)],
    ['visits', integer],
  ],
  rows: [
    ['Leeds', 'North', '10.5', '3'],
    ['York', 'North', '12.25', '1'],
    ['Bath', 'South', '7', '4'],
    ['Truro', 'South', null, '2'],
    ['Hull', 'North', '9.75', null],
  ],
};

const ref = (column: string) => ({ source: 'r', column });
const query = (over: Partial<Query>): Query => ({
  sources: [{ alias: 'r', table: { schema: 'dataset', name: 'rows' } }],
  joins: [],
  select: [{ name: 'site', of: ref('site') }],
  groupBy: [],
  ...over,
});
const run = (q: Query, parameters: Parameter[] = [], values: Record<string, unknown> = {}) =>
  evaluateDatasetQuery(q, readings, parameters, values as never);

describe('a stored result queried as a source of its own (DAT-094; the R21 plan, R21-A)', () => {
  it('DAT-094 selects, filters and compares a stored result as the builder does, a parameter left unset keeping every row', () => {
    const north = run(
      query({
        select: [
          { name: 'site', of: ref('site') },
          { name: 'reading', of: ref('reading') },
        ],
        where: {
          and: [
            { column: ref('region'), is: 'equal', to: { parameter: 'region' } },
            { column: ref('reading'), is: 'greater', to: { literal: '10', type: decimal(6, 2) } },
          ],
        },
      }),
      [{ name: 'region', type: { base: 'text' }, required: false, list: false }],
      { region: 'North' },
    );
    expect(north).toEqual({
      columns: ['site', 'reading'],
      rows: [
        ['Leeds', '10.5'],
        ['York', '12.25'],
      ],
    });
    // An optional parameter given no value keeps every row; a comparison with an empty cell is
    // unknown, so the row with no reading goes.
    const unset = run(
      query({
        where: {
          and: [
            { column: ref('region'), is: 'equal', to: { parameter: 'region' } },
            { column: ref('reading'), is: 'less', to: { literal: '100', type: decimal(6, 2) } },
          ],
        },
      }),
      [{ name: 'region', type: { base: 'text' }, required: false, list: false }],
    );
    expect(unset.rows.map((row) => row[0])).toEqual(['Leeds', 'York', 'Bath', 'Hull']);
    // A column compared with a column, and case ignored where asked.
    const same = run(
      query({
        where: {
          or: [
            {
              column: ref('site'),
              is: 'startsWith',
              to: { literal: 'le', type: text },
              ignoreCase: true,
            },
            { column: ref('visits'), is: 'isNull' },
          ],
        },
      }),
    );
    expect(same.rows).toEqual([['Leeds'], ['Hull']]);
  });

  it('DAT-094 groups a stored result and counts, sums, averages and bounds it, exactly', () => {
    const grouped = run(
      query({
        select: [
          { name: 'region', of: ref('region') },
          { name: 'sites', of: { aggregate: 'count' } },
          { name: 'read', of: { aggregate: 'count', of: ref('reading') } },
          { name: 'total', of: { aggregate: 'sum', of: ref('reading') } },
          { name: 'visits', of: { aggregate: 'sum', of: ref('visits') } },
          { name: 'mean', of: { aggregate: 'average', of: ref('reading'), places: 1 } },
          { name: 'least', of: { aggregate: 'minimum', of: ref('site') } },
          { name: 'most', of: { aggregate: 'maximum', of: ref('reading') } },
        ],
        groupBy: [ref('region')],
      }),
    );
    expect(grouped.columns).toEqual([
      'region',
      'sites',
      'read',
      'total',
      'visits',
      'mean',
      'least',
      'most',
    ]);
    expect(grouped.rows).toEqual([
      // 10.5 + 12.25 + 9.75 = 32.5 over 3 = 10.8333, to one place 10.8; Hull's visits empty.
      ['North', '3', '3', '32.5', '4', '10.8', 'Hull', '12.25'],
      // Truro's reading empty: counted as a site, not as a reading; 7 over 1 is 7.
      ['South', '2', '1', '7', '6', '7', 'Bath', '7'],
    ]);
    // An aggregate over no rows at all is one row: none counted, nothing summed.
    const none = run(
      query({
        select: [
          { name: 'sites', of: { aggregate: 'count' } },
          { name: 'total', of: { aggregate: 'sum', of: ref('reading') } },
        ],
        where: { column: ref('site'), is: 'equal', to: { literal: 'Nowhere', type: text } },
      }),
    );
    expect(none.rows).toEqual([['0', null]]);
    // Halves round away from zero, as the database's round does.
    const half = evaluateDatasetQuery(
      query({ select: [{ name: 'mean', of: { aggregate: 'average', of: ref('v'), places: 0 } }] }),
      { columns: [['v', integer]], rows: [['1'], ['2']] },
      [],
      {},
    );
    expect(half.rows).toEqual([['2']]);
  });

  it('DAT-094 holds a dataset query to one source and to columns the result has, summing only numbers', () => {
    const problems = (q: Query) => {
      const found: string[] = [];
      checkDatasetQuery(q, readings.columns, [], (path, message) =>
        found.push(`${path}: ${message}`),
      );
      return found;
    };
    expect(problems(query({}))).toEqual([]);
    expect(
      problems(
        query({
          sources: [
            { alias: 'r', table: { schema: 'dataset', name: 'rows' } },
            { alias: 's', table: { schema: 'dataset', name: 'rows' } },
          ],
          joins: [{ kind: 'inner', source: 's', on: { column: ref('site'), is: 'isNull' } }],
        }),
      ),
    ).toEqual(['fetch.query.sources: A stored result is queried as one source, joined to nothing']);
    expect(problems(query({ select: [{ name: 'x', of: ref('nowhere') }] }))).toEqual([
      'fetch.query.select.0.of: The stored result has no column nowhere',
    ]);
    expect(
      problems(query({ select: [{ name: 'x', of: { aggregate: 'sum', of: ref('site') } }] })),
    ).toEqual(['fetch.query.select.0.of: Only a number is summed or averaged: site is text']);
  });

  it('DAT-094 refuses a comparison whose operand is not of the column it is compared with, before it runs', () => {
    const problems: string[] = [];
    const check = (where: Query['where'], parameters: Parameter[] = []) => {
      problems.length = 0;
      checkDatasetQuery(query({ where }), readings.columns, parameters, (path, message) =>
        problems.push(`${path}: ${message}`),
      );
      return [...problems];
    };
    expect(
      check({ column: ref('visits'), is: 'equal', to: { literal: 'abc', type: { base: 'text' } } }),
    ).toEqual(['fetch.query.where.to: visits is integer, compared only with integer']);
    expect(
      check({ column: ref('visits'), is: 'equal', to: { parameter: 'who' } }, [
        { name: 'who', type: { base: 'text' }, required: true, list: false },
      ]),
    ).toEqual(['fetch.query.where.to: visits is integer, compared only with integer']);
    expect(check({ column: ref('visits'), is: 'equal', to: { column: ref('site') } })).toEqual([
      'fetch.query.where.to: visits is integer, compared only with integer',
    ]);
    expect(
      check({
        column: ref('visits'),
        is: 'contains',
        to: { literal: '1', type: { base: 'text' } },
      }),
    ).toEqual([
      'fetch.query.where.is: Only text is searched for contained text: visits is integer',
    ]);
    // A whole number is compared with a decimal as the database would.
    expect(
      check({ column: ref('reading'), is: 'greater', to: { literal: '10', type: integer } }),
    ).toEqual([]);
  });
});
