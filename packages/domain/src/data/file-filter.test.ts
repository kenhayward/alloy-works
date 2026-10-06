import { describe, expect, it } from 'vitest';

import type { CanonicalValue } from './canonical.js';
import { checkQueryDefinition, type Column, type DraftDefinition, type Parameter } from './definition.js';
import {
  checkFileCondition,
  fileConditionSchema,
  fileFilter,
  sortRows,
  type FileCondition,
} from './file-filter.js';

const columns: Column[] = [
  { name: 'id', from: { header: 'id' }, type: { base: 'integer' } },
  { name: 'site', from: { header: 'site' }, type: { base: 'text' } },
  { name: 'depth', from: { header: 'depth' }, type: { base: 'decimal', precision: 8, scale: 2 } },
  { name: 'taken', from: { header: 'taken' }, type: { base: 'instant', fraction: 3 } },
  { name: 'active', from: { header: 'active' }, type: { base: 'boolean' } },
  { name: 'photo', from: { header: 'photo' }, type: { base: 'image', encoding: 'base64', description: 'decorative' } },
];

const rows: CanonicalValue[][] = [
  ['1', 'North weir', '12.5', '2026-01-02T03:04:05.5Z', true, null],
  ['2', 'South weir', '7.25', '2026-01-02T03:04:05Z', false, null],
  ['3', 'East gauge', '0.75', '2026-01-02T03:04:05.25Z', null, null],
  ['4', null, null, null, true, null],
];

const parameter = (name: string, over: Partial<Parameter> = {}): Parameter => ({
  name,
  type: { base: 'text' },
  required: true,
  list: false,
  ...over,
});

const kept = (where: FileCondition, values = {}, parameters: Parameter[] = []) =>
  rows.filter(fileFilter(where, columns, parameters, values)).map((row) => row[0]);

describe("a file's typed filter", () => {
  it('compares a time by its value, its fraction padded, never by its text', () => {
    // As text, ...05.5Z sorts before ...05Z; as an instant it is after.
    const after = { literal: '2026-01-02T03:04:05Z', type: { base: 'instant', fraction: 3 } } as const;
    expect(kept({ column: 'taken', is: 'greater', to: after })).toEqual(['1', '3']);
    expect(kept({ column: 'taken', is: 'equal', to: after })).toEqual(['2']);
    const depth = { literal: '7.250', type: { base: 'decimal', precision: 8, scale: 3 } } as const;
    expect(kept({ column: 'depth', is: 'greaterOrEqual', to: { ...depth, literal: '7.25' } })).toEqual([
      '1',
      '2',
    ]);
  });

  it("reads an empty cell as SQL's WHERE does: a comparison with it is neither true nor false, and an optional parameter given nothing keeps every row", () => {
    expect(kept({ column: 'active', is: 'equal', to: { literal: true, type: { base: 'boolean' } } })).toEqual([
      '1',
      '4',
    ]);
    expect(
      kept({ not: { column: 'active', is: 'equal', to: { literal: true, type: { base: 'boolean' } } } }),
    ).toEqual(['2']);
    expect(kept({ column: 'site', is: 'isNull' })).toEqual(['4']);
    expect(kept({ column: 'site', is: 'isNotNull' })).toEqual(['1', '2', '3']);
    const optional = [parameter('site', { required: false })];
    expect(kept({ column: 'site', is: 'equal', to: { parameter: 'site' } }, {}, optional)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(
      kept({ column: 'site', is: 'startsWith', to: { parameter: 'site' } }, { site: 'North' }, optional),
    ).toEqual(['1']);
    expect(
      kept(
        {
          or: [
            { column: 'site', is: 'contains', to: { literal: 'weir', type: { base: 'text' } } },
            { column: 'id', is: 'in', to: { parameter: 'ids' } },
          ],
        },
        { ids: ['3'] },
        [parameter('ids', { type: { base: 'integer' }, list: true })],
      ),
    ).toEqual(['1', '2', '3']);
  });

  it("refuses a filter that names no column, compares across types, takes a list but by in, or compares an image or text by its order", () => {
    const problems = (where: FileCondition, parameters: Parameter[] = []) => {
      const found: string[] = [];
      checkFileCondition(where, columns, parameters, (path, message) =>
        found.push(`${path}: ${message}`),
      );
      return found;
    };
    expect(problems({ column: 'river', is: 'isNull' })).toEqual([
      'fetch.where.column: The filter names river, which is not a column',
    ]);
    expect(problems({ column: 'id', is: 'equal', to: { literal: 'one', type: { base: 'text' } } })).toEqual([
      'fetch.where.to: id is integer, so it is compared with integer',
    ]);
    expect(problems({ column: 'id', is: 'equal', to: { parameter: 'ids' } }, [
      parameter('ids', { type: { base: 'integer' }, list: true }),
    ])).toEqual(['fetch.where.to: A list is compared by in alone']);
    expect(problems({ column: 'photo', is: 'equal', to: { parameter: 'x' } })).toEqual([
      'fetch.where.is: An image is filtered by is empty or is not empty alone',
    ]);
    expect(problems({ column: 'site', is: 'less', to: { literal: 'm', type: { base: 'text' } } })).toHaveLength(1);
    expect(
      problems({ column: 'depth', is: 'equal', to: { literal: '1.0', type: { base: 'decimal', precision: 8, scale: 2 } } }),
    ).toEqual(["fetch.where.to.literal: A value is written in its type's canonical form, and is never empty"]);
    expect(problems({ column: 'id', is: 'equal', to: { parameter: 'nobody' } })).toEqual([
      'fetch.where.to.parameter: The filter names nobody, which is not a declared parameter',
    ]);
  });

  it('walks a filter before it is parsed: one nested 100,000 deep is refused by name', () => {
    let deep: unknown = { column: 'id', is: 'isNull' };
    for (let at = 0; at < 100_000; at += 1) deep = { not: deep };
    const parsed = fileConditionSchema.safeParse(deep);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('A condition nests at most 8 deep');
  });

  it('puts rows in the declared order by the product comparison, an empty cell after every value ascending', () => {
    const order = [
      { column: 'taken', direction: 'ascending' },
      { column: 'id', direction: 'descending' },
    ] as const;
    expect(sortRows([...rows], { columns, order: [...order] }).map((row) => row[0])).toEqual([
      '2',
      '3',
      '1',
      '4',
    ]);
    expect(sortRows([...rows], { columns, order: 'multiset' })).toEqual(rows);
  });

  it("checks a file definition's filter against its declared columns and parameters", () => {
    const draft: DraftDefinition = {
      schemaVersion: 1,
      connection: '0e5b5d5a-6b8e-4c1e-9b3a-1f6a2b7c8d9e',
      parameters: [parameter('site')],
      fetch: {
        kind: 'file',
        key: [{ fixed: 'readings.csv' }],
        format: { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'empty' },
        where: { column: 'site', is: 'equal', to: { parameter: 'site' } },
      },
      columns,
      key: ['id'],
      order: [{ column: 'id', direction: 'ascending' }],
      empty: 'valid',
      limits: { rows: 100, bytes: 1_000_000, seconds: 10 },
    };
    expect(checkQueryDefinition(draft)).toEqual([]);
    expect(
      checkQueryDefinition({
        ...draft,
        fetch: { ...draft.fetch, where: { column: 'river', is: 'equal', to: { parameter: 'site' } } } as never,
      }).map((each) => each.message),
    ).toEqual([
      'The filter names river, which is not a column',
      'Neither the key nor the filter uses site',
    ]);
  });
});
