import { describe, expect, it } from 'vitest';

import type { BoundTableNode } from '../content/model/blocks.js';
import { DEFAULT_VALUE_FORMATS } from '../theme/default.js';
import type { CanonicalResult, CanonicalValue } from './canonical.js';
import type { ColumnType } from './columns.js';
import type { Column } from './definition.js';
import {
  checkTable,
  layoutTable,
  sortResult,
  tableOrder,
  TABLE_ROWS_MAX,
  type LaidOut,
} from './table.js';

/**
 * A bound table's groups (tables.md, "Groups"; the TG plan, task 1): headings in first-appearance
 * order, nested outermost first, the sort within each group, and the query's subtotal rows last.
 */

const words = { noRows: 'No rows', notAvailable: 'Not available' };

const declared = (name: string, type: ColumnType): Column => ({
  name,
  from: { column: name },
  type,
});
const COLUMNS: Column[] = [
  declared('region', { base: 'text' }),
  declared('product', { base: 'text' }),
  declared('amount', { base: 'decimal', precision: 10, scale: 2 }),
  declared('region_total', { base: 'boolean' }),
  declared('product_total', { base: 'boolean' }),
  declared('photo', { base: 'image', encoding: 'binary', description: 'decorative' }),
];
const result = (...rows: (readonly CanonicalValue[])[]): CanonicalResult => ({
  columns: [
    ['region', 'text'],
    ['product', 'text'],
    ['amount', 'decimal'],
    ['region_total', 'boolean'],
    ['product_total', 'boolean'],
    ['photo', 'image'],
  ],
  rows,
});
// South first in stored order, so first appearance and code point order disagree.
const SALES = result(
  ['South', 'Pears', '3', false, false, null],
  ['North', 'Apples', '4', false, false, null],
  ['South', 'Apples', '1', false, false, null],
  ['North', 'Pears', '2', false, false, null],
  ['South', null, '4', true, false, null],
  ['North', null, '6', true, false, null],
);

const table = (over: Partial<BoundTableNode> = {}): BoundTableNode => ({
  type: 'boundTable',
  id: 't1',
  style: 'table',
  binding: {
    type: 'binding',
    id: 'k1',
    query: '00000000-0000-4000-8000-00000000d001',
    parameters: {},
    mode: 'checked',
  },
  caption: [{ type: 'text', value: 'Sales', marks: [] }],
  columns: [
    { column: 'product', header: 'Product' },
    { column: 'amount', header: 'Amount' },
  ],
  headerColumn: false,
  ...over,
});

const laid = (presentation: BoundTableNode, rows: CanonicalResult = SALES): LaidOut => {
  const out = layoutTable(presentation, rows, COLUMNS, {}, DEFAULT_VALUE_FORMATS, words);
  if ('failures' in out) throw new Error(JSON.stringify(out.failures));
  return out;
};
const failures = (presentation: BoundTableNode, rows: CanonicalResult = SALES) => {
  const out = layoutTable(presentation, rows, COLUMNS, {}, DEFAULT_VALUE_FORMATS, words);
  return 'failures' in out ? out.failures : [];
};
// Each heading as `#` per level and its text, each row as its cells, a subtotal marked `=`.
const lines = (out: LaidOut) =>
  out.rows.flatMap((row) => [
    ...(row.opens ?? []).map((heading) => `${'#'.repeat(heading.level)} ${heading.text}`),
    `${row.subtotal === undefined ? '' : `=${row.subtotal} `}${row.cells.map((cell) => cell.text).join(' | ')}`,
  ]);

const byRegion: Partial<BoundTableNode> = { groups: [{ column: 'region' }] };
const withTotals: Partial<BoundTableNode> = {
  groups: [{ column: 'region', subtotal: 'region_total' }],
};

describe("a bound table's groups", () => {
  it('TAB-008 groups rows by a column, each group opening with a heading row holding its formatted value', () => {
    const detail = result(...SALES.rows.slice(0, 4));
    expect(lines(laid(table(byRegion), detail))).toEqual([
      '# South',
      'Pears | 3.00',
      'Apples | 1.00',
      '# North',
      'Apples | 4.00',
      'Pears | 2.00',
    ]);
  });

  it('TAB-043 nests groups outermost first, groups in first-appearance order, the sort applying within each group', () => {
    const rows = result(...SALES.rows.slice(0, 4), ['South', 'Pears', '5', false, false, null]);
    const out = laid(
      table({
        groups: [{ column: 'region' }, { column: 'product' }],
        columns: [{ column: 'amount', header: 'Amount' }],
        sort: [{ column: 'amount', direction: 'descending', nulls: 'last' }],
      }),
      rows,
    );
    expect(lines(out)).toEqual([
      '# South',
      '## Pears',
      '5.00',
      '3.00',
      '## Apples',
      '1.00',
      '# North',
      '## Apples',
      '4.00',
      '## Pears',
      '2.00',
    ]);
  });

  it('TAB-043 orders groups by first appearance whatever the sort, which orders rows only within them', () => {
    const out = laid(
      table({ ...byRegion, sort: [{ column: 'product', direction: 'ascending', nulls: 'last' }] }),
      result(...SALES.rows.slice(0, 4)),
    );
    expect(lines(out)).toEqual([
      '# South',
      'Apples | 1.00',
      'Pears | 3.00',
      '# North',
      'Apples | 4.00',
      'Pears | 2.00',
    ]);
  });

  it("TAB-054 prints a subtotal, the query's row, last in its group and unsorted, at its level", () => {
    const out = laid(
      table({
        ...withTotals,
        sort: [{ column: 'amount', direction: 'ascending', nulls: 'first' }],
      }),
    );
    expect(lines(out)).toEqual([
      '# South',
      'Apples | 1.00',
      'Pears | 3.00',
      '=1 Not available | 4.00',
      '# North',
      'Pears | 2.00',
      'Apples | 4.00',
      '=1 Not available | 6.00',
    ]);
  });

  it('TAB-054 places a subtotal by the values of its level and those above, whatever it holds below', () => {
    const out = laid(
      table({
        groups: [
          { column: 'region', subtotal: 'region_total' },
          { column: 'product', subtotal: 'product_total' },
        ],
        columns: [{ column: 'amount', header: 'Amount' }],
      }),
      result(
        ['North', 'Apples', '4', false, false, null],
        ['North', 'Apples', '1', false, false, null],
        ['North', 'Apples', '5', false, true, null],
        ['North', null, '5', true, false, null],
      ),
    );
    expect(lines(out)).toEqual(['# North', '## Apples', '4.00', '1.00', '=2 5.00', '=1 5.00']);
  });

  it('TAB-023 prints every value the rows hold, grouped, and adds none', () => {
    const out = laid(table(withTotals));
    expect(out.rows.map((row) => row.index).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("prints a null group's heading as its format's null text", () => {
    const out = laid(table(byRegion), result([null, 'Pears', '3', false, false, null]));
    expect(lines(out)).toEqual(['# Not available', 'Pears | 3.00']);
  });

  it('formats a heading by the group format over the style format for its type', () => {
    const out = laid(
      table({
        groups: [{ column: 'amount', format: { places: 0 } }],
        columns: [{ column: 'product', header: 'Product' }],
      }),
      result(['North', 'Pears', '3', false, false, null]),
    );
    expect(lines(out)).toEqual(['# 3', 'Pears']);
  });

  it('refuses a row that is a subtotal at two levels, subtotal_ambiguous', () => {
    const tables = table({
      groups: [
        { column: 'region', subtotal: 'region_total' },
        { column: 'product', subtotal: 'product_total' },
      ],
    });
    expect(failures(tables, result(['North', 'Pears', '3', true, true, null]))).toEqual([
      { code: 'subtotal_ambiguous', detail: '0' },
    ]);
  });

  it('refuses a subtotal column that is not boolean, and a grouped column that is gone or an image', () => {
    expect(
      checkTable(
        table({
          groups: [
            { column: 'region', subtotal: 'amount' },
            { column: 'gone' },
            { column: 'photo' },
          ],
        }),
        COLUMNS,
        1,
        {},
      ),
    ).toEqual([
      { code: 'subtotal_not_boolean', column: 'amount' },
      { code: 'column_missing', column: 'gone' },
      { code: 'column_image', column: 'photo' },
    ]);
  });

  it("counts headings against the table's ceiling, table_too_long", () => {
    const rows = Array.from({ length: TABLE_ROWS_MAX }, (_, i): CanonicalValue[] => [
      i < 2 ? 'North' : 'South',
      'Pears',
      '1',
      false,
      false,
      null,
    ]);
    expect(failures(table(byRegion), result(...rows))).toEqual([
      { code: 'table_too_long', detail: String(TABLE_ROWS_MAX + 2) },
    ]);
  });

  it("orders a reader's rows as the table lays them out, so a presorted layout agrees", () => {
    const grouped = table({
      ...withTotals,
      sort: [{ column: 'amount', direction: 'ascending', nulls: 'first' }],
    });
    expect(tableOrder(grouped, SALES, COLUMNS)).toEqual([2, 0, 4, 3, 1, 5]);
    const presorted = layoutTable(
      grouped,
      sortResult(grouped, SALES, COLUMNS),
      COLUMNS,
      {},
      DEFAULT_VALUE_FORMATS,
      words,
      { presorted: true },
    );
    expect(lines(presorted as LaidOut)).toEqual(lines(laid(grouped)));
  });

  it("keeps each heading on the first row a page's limit shows", () => {
    const out = layoutTable(table(byRegion), SALES, COLUMNS, {}, DEFAULT_VALUE_FORMATS, words, {
      limit: 2,
    });
    expect(lines(out as LaidOut)).toEqual(['# South', 'Pears | 3.00', 'Apples | 1.00']);
  });
});
