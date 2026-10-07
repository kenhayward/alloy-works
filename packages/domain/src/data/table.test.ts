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
  TABLE_ROWS_MAX,
  type LaidOut,
  type TablePresentation,
} from './table.js';

/**
 * A bound table laid out (tables.md; the TB1 plan, task 4): its columns chosen and headed, its rows
 * in stored order or sorted stably, each cell formatted, aligned, or the failures gathered by name.
 */

const NBSP = String.fromCodePoint(0xa0);
const words = { noRows: 'No rows', notAvailable: 'Not available' };
const style: TablePresentation = {};

const declared = (name: string, type: ColumnType): Column => ({
  name,
  from: { column: name },
  type,
});
const COLUMNS: Column[] = [
  declared('site', { base: 'text' }),
  declared('depth', { base: 'decimal', precision: 10, scale: 2 }),
  declared('measured_on', { base: 'date' }),
  declared('photo', { base: 'image', encoding: 'binary', description: 'decorative' }),
];
const result = (...rows: CanonicalValue[][]): CanonicalResult => ({
  columns: [
    ['site', 'text'],
    ['depth', 'decimal'],
    ['measured_on', 'date'],
    ['photo', 'image'],
  ],
  rows,
});
const READINGS = result(
  ['North', '4.5', '2026-10-01', null],
  ['South', '-1.25', '2026-10-02', null],
  ['East', null, '2026-10-03', null],
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
  caption: [{ type: 'text', value: 'Readings', marks: [] }],
  columns: [
    { column: 'site', header: 'Site' },
    { column: 'depth', header: 'Depth' },
  ],
  headerColumn: false,
  ...over,
});

const laid = (
  presentation: BoundTableNode,
  rows: CanonicalResult = READINGS,
  on: TablePresentation = style,
): LaidOut => {
  const out = layoutTable(presentation, rows, COLUMNS, on, DEFAULT_VALUE_FORMATS, words);
  if ('failures' in out) throw new Error(JSON.stringify(out.failures));
  return out;
};
const texts = (out: LaidOut) => out.rows.map((row) => row.cells.map((cell) => cell.text));

describe('a bound table, laid out', () => {
  it('TAB-002 heads each column as the table declares, in its order, whatever the result names it', () => {
    const out = laid(
      table({
        columns: [
          { column: 'depth', header: 'Depth below datum' },
          { column: 'site', header: 'Where' },
        ],
      }),
    );
    expect(out.header.map((each) => each.text)).toEqual(['Depth below datum', 'Where']);
    expect(texts(out)[0]).toEqual(['4.50', 'North']);
  });

  it('TAB-003 prints a unit in the header, in parentheses or in brackets as the style says, or after each value', () => {
    const inHeader = table({
      columns: [
        { column: 'site', header: 'Site' },
        { column: 'depth', header: 'Depth', unit: { text: 'm', place: 'header' } },
      ],
    });
    expect(laid(inHeader).header[1]!.text).toBe('Depth (m)');
    expect(laid(inHeader, READINGS, { unitBrackets: 'brackets' }).header[1]!.text).toBe(
      'Depth [m]',
    );
    const afterEach = table({
      columns: [{ column: 'depth', header: 'Depth', unit: { text: 'm', place: 'value' } }],
    });
    expect(laid(afterEach).header[0]!.text).toBe('Depth');
    expect(texts(laid(afterEach))).toEqual([
      [`4.50${NBSP}m`],
      [`-1.25${NBSP}m`],
      ['Not available'],
    ]);
  });

  it('TAB-004 fails a column shown, or sorted by, that the result does not have, column_missing, never an empty column', () => {
    const out = layoutTable(
      table({
        columns: [
          { column: 'site', header: 'Site' },
          { column: 'salinity', header: 'Salinity' },
        ],
        sort: [{ column: 'tide', direction: 'ascending', nulls: 'last' }],
      }),
      READINGS,
      COLUMNS,
      style,
      DEFAULT_VALUE_FORMATS,
      words,
    );
    expect(out).toEqual({
      failures: [
        { code: 'column_missing', column: 'salinity' },
        { code: 'column_missing', column: 'tide' },
      ],
    });
  });

  it('lays out 2,000 rows, the most the pinned Typst publishes at 8 columns within 1 GiB on Linux (TB1-K), and refuses one more', () => {
    expect(TABLE_ROWS_MAX).toBe(2_000);
    const rows = (count: number) =>
      result(...Array.from({ length: count }, (_, at) => [`S${at}`, String(at), null, null]));
    const at = (count: number) =>
      layoutTable(table(), rows(count), COLUMNS, style, DEFAULT_VALUE_FORMATS, words);
    const most = at(TABLE_ROWS_MAX);
    if ('failures' in most) throw new Error(JSON.stringify(most.failures));
    expect(most.rows).toHaveLength(2_000);
    expect(at(TABLE_ROWS_MAX + 1)).toEqual({
      failures: [{ code: 'table_too_long', detail: '2001' }],
    });
  });

  it('gathers every failure at once: an image column, a format meaningless for its type, and too many rows', () => {
    const many = result(
      ...Array.from({ length: TABLE_ROWS_MAX + 1 }, () => ['A', '1', null, null]),
    );
    const out = layoutTable(
      table({
        columns: [
          { column: 'photo', header: 'Photo' },
          { column: 'measured_on', header: 'Measured', format: { places: 2 } },
        ],
      }),
      many,
      COLUMNS,
      style,
      DEFAULT_VALUE_FORMATS,
      words,
    );
    expect(out).toEqual({
      failures: [
        { code: 'column_image', column: 'photo' },
        { code: 'format_mismatch', column: 'measured_on', detail: 'places' },
        { code: 'table_too_long', detail: String(TABLE_ROWS_MAX + 1) },
      ],
    });
  });

  it('TAB-006 keeps the stored order where no sort is declared', () => {
    expect(texts(laid(table())).map((row) => row[0])).toEqual(['North', 'South', 'East']);
  });

  it('TAB-007 sorts stably: 1,000 equal rows keep their stored order, descending, nulls first and last', () => {
    const rows = Array.from({ length: 1000 }, (_, at): CanonicalValue[] => [
      `row ${at}`,
      at % 10 === 0 ? null : '1',
      null,
      null,
    ]);
    const stored = rows.map((row) => row[0]);
    const nonNull = stored.filter((_, at) => at % 10 !== 0);
    const nulls = stored.filter((_, at) => at % 10 === 0);
    for (const direction of ['ascending', 'descending'] as const) {
      const sorted = (nullsAt: 'first' | 'last') =>
        texts(
          laid(table({ sort: [{ column: 'depth', direction, nulls: nullsAt }] }), result(...rows)),
        ).map((row) => row[0]);
      expect(sorted('last'), direction).toEqual([...nonNull, ...nulls]);
      expect(sorted('first'), direction).toEqual([...nulls, ...nonNull]);
    }
  });

  it('TAB-007 sorts by value for numbers, by canonical text for dates, and text by code point, Z before a', () => {
    const rows = result(
      ['apple', '10', '2026-01-02', null],
      ['Zebra', '9.5', '2025-12-31', null],
      ['zoo', '-3', '2026-01-01', null],
    );
    const by = (column: string, direction: 'ascending' | 'descending' = 'ascending') =>
      texts(laid(table({ sort: [{ column, direction, nulls: 'last' }] }), rows)).map(
        (row) => row[0],
      );
    expect(by('site')).toEqual(['Zebra', 'apple', 'zoo']);
    expect(by('depth')).toEqual(['zoo', 'Zebra', 'apple']);
    expect(by('depth', 'descending')).toEqual(['apple', 'Zebra', 'zoo']);
    // A sort column need not be shown.
    expect(by('measured_on')).toEqual(['Zebra', 'zoo', 'apple']);
  });

  it('TAB-011 lays out no rows as the headers and one statement spanning the table, a data cell even beside a header column', () => {
    const declaredStatement = [{ type: 'text' as const, value: 'Nothing measured', marks: [] }];
    for (const headerColumn of [false, true]) {
      const none = laid(table({ headerColumn }), result());
      expect(none.header.map((each) => each.text)).toEqual(['Site', 'Depth']);
      expect(none.rows).toEqual([]);
      expect(none.empty).toEqual({
        content: [{ type: 'text', value: 'No rows', marks: [] }],
        colspan: 2,
        scope: null,
      });
      expect(laid(table({ headerColumn, empty: declaredStatement }), result()).empty).toEqual({
        content: declaredStatement,
        colspan: 2,
        scope: null,
      });
    }
    expect(laid(table()).empty).toBeNull();
  });

  it('heads each row by its first cell where the table says so, and no other', () => {
    const out = laid(table({ headerColumn: true }));
    expect(out.rows[0]!.cells.map((cell) => cell.scope)).toEqual(['row', null]);
    expect(laid(table()).rows[0]!.cells.map((cell) => cell.scope)).toEqual([null, null]);
  });

  it("TAB-046 aligns a number column as the style's align says, on its decimal separator by default, and a column overrides it", () => {
    const columns = [
      { column: 'site', header: 'Site' },
      { column: 'depth', header: 'Depth' },
      { column: 'measured_on', header: 'Measured' },
    ];
    expect(laid(table({ columns })).columns.map((each) => each.align)).toEqual([
      'start',
      'decimal',
      'end',
    ]);
    expect(
      laid(table({ columns }), READINGS, { align: { decimal: 'end', text: 'centre' } }).columns.map(
        (each) => each.align,
      ),
    ).toEqual(['centre', 'end', 'end']);
    const overridden = columns.map((each) =>
      each.column === 'depth' ? { ...each, align: 'centre' as const } : each,
    );
    expect(laid(table({ columns: overridden })).columns[1]!.align).toBe('centre');
  });

  it("formats each cell by its column's format over the style's for its type, and keeps its canonical value", () => {
    const out = laid(
      table({
        columns: [
          { column: 'depth', header: 'Depth', format: { places: 1, negative: 'parentheses' } },
        ],
      }),
      READINGS,
      { fields: { decimal: { places: 3, negativeColour: true } } },
    );
    // The product's default for a decimal, the style's over it, the column's over both.
    expect(out.columns[0]!.format).toEqual({
      style: 'number',
      rounding: 'halfAwayFromZero',
      places: 1,
      negative: 'parentheses',
      negativeColour: true,
    });
    expect(out.rows.map((row) => row.cells[0])).toEqual([
      { text: '4.5', value: '4.5', scope: null, negative: false, parenthesised: false },
      { text: '(1.3)', value: '-1.25', scope: null, negative: true, parenthesised: true },
      { text: 'Not available', value: null, scope: null, negative: false, parenthesised: false },
    ]);
  });
});

describe('a bound table checked without its rows, and laid out in part (the TB2 plan, TB2-B)', () => {
  const failing: BoundTableNode[] = [
    table({ columns: [{ column: 'tide', header: 'Tide' }] }),
    table({ columns: [{ column: 'photo', header: 'Photo' }] }),
    table({ columns: [{ column: 'measured_on', header: 'On', format: { places: 2 } }] }),
    table({ sort: [{ column: 'tide', direction: 'ascending', nulls: 'last' }] }),
    table({ sort: [{ column: 'photo', direction: 'ascending', nulls: 'last' }] }),
    table({
      columns: [
        { column: 'photo', header: 'Photo' },
        { column: 'gone', header: 'Gone' },
        {
          column: 'depth',
          header: 'Depth',
          format: { currency: { symbol: '$', position: 'before', space: false } },
        },
      ],
      sort: [{ column: 'gone', direction: 'descending', nulls: 'first' }],
    }),
  ];

  it("agrees with layoutTable's failures for every failure, in its order", () => {
    for (const each of [table(), ...failing]) {
      const laidOut = layoutTable(each, READINGS, COLUMNS, style, DEFAULT_VALUE_FORMATS, words);
      const checked = checkTable(each, COLUMNS, READINGS.rows.length, style);
      expect(checked).toEqual('failures' in laidOut ? laidOut.failures : []);
    }
    // A declared column the result lacks is missing to both, as `layoutTable` intersects them.
    const fewer: CanonicalResult = { columns: READINGS.columns.slice(0, 1), rows: [['North']] };
    const laidOut = layoutTable(table(), fewer, COLUMNS, style, DEFAULT_VALUE_FORMATS, words);
    expect('failures' in laidOut && laidOut.failures).toEqual(
      checkTable(table(), COLUMNS.slice(0, 1), 1, style),
    );
  });

  it('answers table_too_long from the row count alone', () => {
    expect(checkTable(table(), COLUMNS, TABLE_ROWS_MAX, style)).toEqual([]);
    expect(checkTable(table(), COLUMNS, TABLE_ROWS_MAX + 1, style)).toEqual([
      { code: 'table_too_long', detail: String(TABLE_ROWS_MAX + 1) },
    ]);
  });

  it('sorts every row and formats only the first limit', () => {
    const rows = result(
      ...Array.from({ length: 120 }, (_, at): CanonicalValue[] => [
        `S${at}`,
        String(at),
        null,
        null,
      ]),
    );
    const sorted = table({ sort: [{ column: 'depth', direction: 'descending', nulls: 'last' }] });
    const out = layoutTable(sorted, rows, COLUMNS, style, DEFAULT_VALUE_FORMATS, words, {
      limit: 50,
    });
    if ('failures' in out) throw new Error(JSON.stringify(out.failures));
    expect(out.rows).toHaveLength(50);
    expect(out.rows[0]!.cells[0]!.text).toBe('S119');
    expect(out.rows[49]!.cells[0]!.text).toBe('S70');
    expect(out.empty).toBeNull();
  });

  it('sorts a result as layoutTable does, stably, so a presorted one lays out without its sort columns', () => {
    const sorted = table({
      columns: [{ column: 'site', header: 'Site' }],
      sort: [{ column: 'depth', direction: 'descending', nulls: 'last' }],
    });
    const ordered = sortResult(sorted, READINGS, COLUMNS);
    expect(ordered.rows.map((row) => row[0])).toEqual(['North', 'South', 'East']);
    // The sort column left out, as the rows route sends it to a reader (the TB2 final review).
    const sent: CanonicalResult = {
      columns: [['site', 'text']],
      rows: ordered.rows.map((row) => [row[0]!]),
    };
    expect(layoutTable(sorted, sent, COLUMNS, style, DEFAULT_VALUE_FORMATS, words)).toMatchObject({
      failures: [{ code: 'column_missing', column: 'depth' }],
    });
    const out = layoutTable(sorted, sent, COLUMNS, style, DEFAULT_VALUE_FORMATS, words, {
      presorted: true,
    });
    if ('failures' in out) throw new Error(JSON.stringify(out.failures));
    expect(out.rows.map((row) => row.cells[0]!.text)).toEqual(['North', 'South', 'East']);
  });
});
