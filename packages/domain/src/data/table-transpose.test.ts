import { describe, expect, it } from 'vitest';

import type { BoundTableNode } from '../content/model/blocks.js';
import { DEFAULT_VALUE_FORMATS } from '../theme/default.js';
import type { CanonicalResult, CanonicalValue } from './canonical.js';
import type { ColumnType } from './columns.js';
import type { Column } from './definition.js';
import { placeTableNotes } from './table-notes.js';
import { checkTable, layoutTable, TRANSPOSE_ROWS_MAX, type LaidOut } from './table.js';

/**
 * A bound table transposed (tables.md, "Transposition"; the TG plan, task 4): each row a column
 * headed by its value in the header column, each shown column a row headed by its header.
 */

const words = { noRows: 'No rows', notAvailable: 'Not available' };
const declared = (name: string, type: ColumnType): Column => ({
  name,
  from: { column: name },
  type,
});
const COLUMNS: Column[] = [
  declared('year', { base: 'text' }),
  declared('revenue', { base: 'decimal', precision: 10, scale: 2 }),
  declared('region', { base: 'text' }),
  declared('photo', { base: 'image', encoding: 'binary', description: 'decorative' }),
];
const result = (...rows: (readonly CanonicalValue[])[]): CanonicalResult => ({
  columns: [
    ['year', 'text'],
    ['revenue', 'decimal'],
    ['region', 'text'],
    ['photo', 'image'],
  ],
  rows,
});
const YEARS = result(['2024', '10.5', 'North', null], ['2025', '-2', 'South', null]);

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
  caption: [{ type: 'text', value: 'By year', marks: [] }],
  columns: [
    { column: 'year', header: 'Year' },
    { column: 'revenue', header: 'Revenue', unit: { text: 'GBP m', place: 'header' } },
    { column: 'region', header: 'Region', wrap: false },
  ],
  headerColumn: false,
  transpose: { header: 'year' },
  ...over,
});
const laid = (presentation: BoundTableNode, rows: CanonicalResult = YEARS): LaidOut => {
  const out = layoutTable(presentation, rows, COLUMNS, {}, DEFAULT_VALUE_FORMATS, words);
  if ('failures' in out) throw new Error(JSON.stringify(out.failures));
  return out;
};
const grid = (out: LaidOut) => [
  out.header.map((each) => each.text),
  ...out.rows.map((row) => row.cells.map((cell) => cell.text)),
];

describe('a bound table transposed', () => {
  it("TAB-021 turns each row into a column headed by its header column's value, and each shown column into a row headed by its header", () => {
    const out = laid(table());
    expect(grid(out)).toEqual([
      ['Year', '2024', '2025'],
      ['Revenue (GBP m)', '10.50', '-2.00'],
      ['Region', 'North', 'South'],
    ]);
    // Each row heads itself; each value keeps its own column's alignment and wrap, decimal at the end.
    expect(out.rows.map((row) => row.cells[0]!.scope)).toEqual(['row', 'row']);
    expect(out.rows[0]!.cells.slice(1).map((cell) => cell.align)).toEqual(['end', 'end']);
    expect(out.rows[1]!.cells.slice(1).map((cell) => [cell.align, cell.wrap])).toEqual([
      ['start', false],
      ['start', false],
    ]);
    expect(out.transposed).toMatchObject({ rows: [0, 1], columns: ['revenue', 'region'] });
  });

  it('TAB-021 orders the new columns by the sort, and heads them by the header column even where it is not shown', () => {
    const out = laid(
      table({
        columns: [{ column: 'revenue', header: 'Revenue' }],
        sort: [{ column: 'revenue', direction: 'ascending', nulls: 'last' }],
      }),
    );
    expect(grid(out)).toEqual([
      ['year', '2025', '2024'],
      ['Revenue', '-2.00', '10.50'],
    ]);
  });

  it(`TAB-021 transposes at most ${TRANSPOSE_ROWS_MAX} rows, transpose_too_long, and fails a header column gone or an image`, () => {
    const many = Array.from({ length: TRANSPOSE_ROWS_MAX + 1 }, (_, at) => [
      String(2000 + at),
      '1',
      'North',
      null,
    ]);
    const out = layoutTable(table(), result(...many), COLUMNS, {}, DEFAULT_VALUE_FORMATS, words);
    expect('failures' in out && out.failures).toEqual([
      { code: 'transpose_too_long', detail: String(TRANSPOSE_ROWS_MAX + 1) },
    ]);
    expect(checkTable(table({ transpose: { header: 'gone' } }), COLUMNS, 2, {})).toEqual([
      { code: 'column_missing', column: 'gone' },
    ]);
    expect(checkTable(table({ transpose: { header: 'photo' } }), COLUMNS, 2, {})).toEqual([
      { code: 'column_image', column: 'photo' },
    ]);
  });

  it('TAB-023 prints every value once, moved and never added', () => {
    const out = laid(table());
    const values = out.rows.flatMap((row) => row.cells.slice(1).map((cell) => cell.value));
    expect(values.sort()).toEqual(['-2', '10.5', 'North', 'South']);
  });

  it('places a keyed note on its value where it moved, and a column note on its row header', () => {
    const keyed = {
      type: 'footnote' as const,
      id: 'n1',
      anchor: { kind: 'keyed' as const, key: { year: '2025' }, column: 'region' },
      content: [],
    };
    const column = {
      type: 'footnote' as const,
      id: 'n2',
      anchor: { kind: 'column' as const, column: 'revenue' },
      content: [],
    };
    const noted = table({ notes: [keyed, column] });
    const placed = placeTableNotes(noted, laid(noted), new Map([['n1', 1]]));
    expect(placed.map(({ note, row, column: at, letter }) => [note.id, row, at, letter])).toEqual([
      ['n2', 0, 0, 'a'],
      ['n1', 1, 2, 'b'],
    ]);
  });
});
