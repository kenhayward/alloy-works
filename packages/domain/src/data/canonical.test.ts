import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_FORM,
  canonicalResultBytes,
  compareCanonical,
  isCanonical,
  orderRows,
  type CanonicalResult,
} from './canonical.js';
import type { ColumnType } from './columns.js';
import type { Column } from './definition.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Case 6's one logical result (spikes/data-connectors/lib/fixtures.mjs), its columns declared in the
 * domain's own base names. `sample.typed` in deploy/sources/postgres.sql holds the same three rows in
 * PostgreSQL's types, and the connector's checksum test reads them back to this checksum.
 */
const CASE_6_COLUMNS: Column[] = [
  { name: 'k', from: { column: 'k' }, type: { base: 'integer' } },
  { name: 'dec', from: { column: 'dec' }, type: { base: 'decimal', precision: 28, scale: 10 } },
  { name: 'big', from: { column: 'big' }, type: { base: 'integer' } },
  {
    name: 'amount',
    from: { column: 'amount' },
    type: { base: 'decimal', precision: 19, scale: 4 },
  },
  { name: 'd', from: { column: 'd' }, type: { base: 'date' } },
  { name: 'ldt', from: { column: 'ldt' }, type: { base: 'localDateTime', fraction: 6 } },
  { name: 'inst', from: { column: 'inst' }, type: { base: 'instant', fraction: 6 } },
  { name: 'tm', from: { column: 'tm' }, type: { base: 'time', fraction: 6 } },
  { name: 'flag', from: { column: 'flag' }, type: { base: 'boolean' } },
  { name: 'note', from: { column: 'note' }, type: { base: 'text' } },
  { name: 'empty', from: { column: 'empty' }, type: { base: 'text' } },
  { name: 'txt', from: { column: 'txt' }, type: { base: 'text' } },
];

const composed = `caf${String.fromCodePoint(0xe9)}`;
const decomposed = `cafe${String.fromCodePoint(0x301)}`;

const CASE_6_RESULT: CanonicalResult = {
  columns: CASE_6_COLUMNS.map((column) => [column.name, column.type.base]),
  rows: [
    [
      '1',
      '123456789012345678.1234567891',
      '9223372036854775807',
      '1234.56',
      '2026-03-29',
      '2026-03-29T01:30:00.123456',
      '2026-03-29T00:30:00.123456Z',
      '23:59:59.999999',
      true,
      null,
      '',
      `${String.fromCodePoint(0x391, 0x3b8, 0x3ae, 0x3bd, 0x3b1)} ${String.fromCodePoint(0x6771, 0x4eac)} ${String.fromCodePoint(0x20bb7)}`,
    ],
    [
      '2',
      '-0.0000000001',
      '-9223372036854775808',
      '922337203685477.5807',
      '1900-03-01',
      '1900-03-01T00:00:00',
      '1969-12-31T23:59:59.999999Z',
      '00:00:00',
      false,
      'x',
      '',
      composed,
    ],
    [
      '3',
      '0',
      '9007199254740993',
      '0.1',
      '2000-02-29',
      '2026-10-25T01:30:00',
      '2026-10-25T00:30:00Z',
      '12:00:00.5',
      null,
      '',
      null,
      decomposed,
    ],
  ],
};

/** The checksum of case 6's three rows in canonical form version 1, computed apart from this module. */
const CASE_6_CHECKSUM = '985fbb2b96898288bbcd686a7cc1cd452d8d1c15280184abcc86b8c2d9c043e2';

describe("a result's canonical form, version 1 (ADR-0035)", () => {
  it('is version 1', () => {
    expect(CANONICAL_FORM).toBe(1);
  });

  it('takes one spelling of each value and refuses every other', () => {
    const cases: readonly [ColumnType, readonly unknown[], readonly unknown[]][] = [
      [
        { base: 'integer' },
        ['0', '7', '-7', '9223372036854775808', '123456789012345678901234567890'],
        ['-0', '07', '+7', '1.0', '1e3', ' 1', '', 7, true, null],
      ],
      [
        { base: 'decimal', precision: 6, scale: 2 },
        ['0', '1234.5', '-0.01', '9999.99', '12'],
        ['1.50', '-0', '-0.0', '01.5', '.5', '1.', '1e2', '12345.6', '0.001', 'NaN', 1.5],
      ],
      [
        { base: 'date' },
        ['2026-09-30', '0001-01-01', '9999-12-31', '2000-02-29'],
        ['2026-9-30', '2026-02-30', '1900-02-29', '0000-01-01', '2026-09-30T00:00:00'],
      ],
      [
        { base: 'time', fraction: 3 },
        ['00:00:00', '23:59:59.999', '12:00:00.5'],
        ['24:00:00', '12:00:00.50', '12:00:00.', '12:00:00.1234', '12:00', '12:00:00Z'],
      ],
      [
        { base: 'localDateTime', fraction: 6 },
        ['2026-09-30T08:00:00', '2026-09-30T08:00:00.123456'],
        ['2026-09-30 08:00:00', '2026-09-30T08:00:00Z', '2026-09-30T08:00:00.1234567'],
      ],
      [
        { base: 'instant', fraction: 6 },
        ['2026-09-30T08:00:00Z', '2026-09-30T08:00:00.5Z'],
        [
          '2026-09-30T08:00:00',
          '2026-09-30T08:00:00+00:00',
          '2026-09-30T08:00:00.000Z',
          '2026-09-30T08:00:00.1234567Z',
          '2026-09-30T08:00:60Z',
        ],
      ],
      [{ base: 'boolean' }, [true, false], ['true', 'false', 1, 0, null]],
      [{ base: 'text' }, ['', 'x', composed, decomposed], [1, true, null, ['x']]],
      // An image is its SHA-256, in lowercase hexadecimal, and never its bytes.
      [
        { base: 'image', encoding: 'binary', description: 'decorative' },
        ['0'.repeat(64), 'ab'.repeat(32)],
        [
          'AB'.repeat(32),
          'ab'.repeat(31),
          'ab'.repeat(33),
          String.raw`\x89504e47`,
          'iVBORw0KGgo=',
          true,
        ],
      ],
    ];
    for (const [type, taken, refused] of cases) {
      for (const value of taken)
        expect(isCanonical(type, value as never), `${type.base} ${String(value)}`).toBe(true);
      for (const value of refused)
        expect(isCanonical(type, value as never), `${type.base} ${String(value)}`).toBe(false);
    }
  });

  it('compares numbers and times by value, false before true, text by code point, and null after everything', () => {
    const instant: ColumnType = { base: 'instant', fraction: 6 };
    expect(
      compareCanonical(instant, '2026-09-30T08:00:00.5Z', '2026-09-30T08:00:00Z'),
    ).toBeGreaterThan(0);
    expect(
      compareCanonical(instant, '2026-09-30T08:00:00Z', '2026-09-30T08:00:00.000001Z'),
    ).toBeLessThan(0);
    const time: ColumnType = { base: 'time', fraction: 6 };
    expect(compareCanonical(time, '12:00:00.5', '12:00:00')).toBeGreaterThan(0);
    expect(compareCanonical(time, '12:00:00.5', '12:00:00.49')).toBeGreaterThan(0);
    const decimal: ColumnType = { base: 'decimal', precision: 10, scale: 3 };
    expect(compareCanonical(decimal, '10', '9.999')).toBeGreaterThan(0);
    expect(compareCanonical(decimal, '-10', '-9.5')).toBeLessThan(0);
    expect(compareCanonical(decimal, '0.5', '0.50'.replace(/0$/, ''))).toBe(0);
    const integer: ColumnType = { base: 'integer' };
    expect(compareCanonical(integer, '10', '9')).toBeGreaterThan(0);
    expect(compareCanonical(integer, '-9223372036854775808', '9223372036854775807')).toBeLessThan(
      0,
    );
    expect(compareCanonical({ base: 'boolean' }, false, true)).toBeLessThan(0);
    // U+FF5E is one UTF-16 unit, and U+20BB7 two starting 0xD842: by code units the astral character
    // sorts first, by code points last.
    const text: ColumnType = { base: 'text' };
    expect(
      compareCanonical(text, String.fromCodePoint(0x20bb7), String.fromCodePoint(0xff5e)),
    ).toBeGreaterThan(0);
    expect(compareCanonical(text, 'B', 'a')).toBeLessThan(0);
    expect(compareCanonical(text, 'a', null)).toBeLessThan(0);
    expect(compareCanonical(text, null, null)).toBe(0);
  });

  it("serialises as RFC 8785 JSON with no normalisation, and case 6's rows read to one checksum", () => {
    const bytes = canonicalResultBytes(CASE_6_RESULT);
    expect(bytes.startsWith('{"columns":[["k","integer"],["dec","decimal"],')).toBe(true);
    expect(bytes).toContain('"rows":[["1","123456789012345678.1234567891"');
    // Composed and decomposed are kept apart: text is its code points.
    expect(bytes).toContain(`"${composed}"]`);
    expect(bytes).toContain(`"${decomposed}"]`);
    expect(bytes).not.toMatch(/\s(?=[[\]{},:"])/);
    expect(sha256(bytes)).toBe(CASE_6_CHECKSUM);
    const normalised = canonicalResultBytes({
      ...CASE_6_RESULT,
      rows: CASE_6_RESULT.rows.map((row) =>
        row.map((cell) => (typeof cell === 'string' ? cell.normalize('NFC') : cell)),
      ),
    });
    expect(sha256(normalised)).not.toBe(CASE_6_CHECKSUM);
  });

  it('checks a declared order and a key, and sorts a multiset by its canonical text', () => {
    const columns: Column[] = [
      { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
      { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
    ];
    const result = (rows: CanonicalResult['rows']): CanonicalResult => ({
      columns: [
        ['id', 'integer'],
        ['name', 'text'],
      ],
      rows,
    });
    const byId = {
      columns,
      key: ['id'],
      order: [{ column: 'id', direction: 'ascending' as const }],
    };
    const ordered = result([
      ['9', 'b'],
      ['10', 'a'],
    ]);
    expect(orderRows(ordered, byId)).toEqual(ordered);
    expect(
      orderRows(
        result([
          ['10', 'a'],
          ['9', 'b'],
        ]),
        byId,
      ),
    ).toEqual({
      mismatch: 'order',
      row: 2,
    });
    expect(
      orderRows(
        result([
          ['9', 'a'],
          ['9', 'b'],
        ]),
        byId,
      ),
    ).toEqual({ mismatch: 'key', row: 2 });
    expect(orderRows(result([[null, 'a']]), byId)).toEqual({
      mismatch: 'null_key',
      row: 1,
      column: 'id',
    });
    // Nulls last ascending and first descending, as PostgreSQL orders by default.
    const byName = {
      columns,
      key: ['id'],
      order: [
        { column: 'name', direction: 'descending' as const },
        { column: 'id', direction: 'ascending' as const },
      ],
    };
    const descending = result([
      ['3', null],
      ['1', 'b'],
      ['2', 'B'],
    ]);
    expect(orderRows(descending, byName)).toEqual(descending);
    // A key repeated anywhere, not only beside itself.
    expect(
      orderRows(
        result([
          ['1', 'b'],
          ['2', 'a'],
          ['1', 'a'],
        ]),
        { ...byName, order: byName.order },
      ),
    ).toEqual({
      mismatch: 'order',
      row: 3,
    });
    expect(
      orderRows(
        result([
          ['1', 'c'],
          ['2', 'b'],
          ['1', 'a'],
        ]),
        byName,
      ),
    ).toEqual({ mismatch: 'key', row: 3 });
    const multiset = { columns, key: [], order: 'multiset' as const };
    expect(
      orderRows(
        result([
          ['2', 'a'],
          ['10', 'a'],
          ['1', null],
        ]),
        multiset,
      ),
    ).toEqual(
      result([
        ['1', null],
        ['10', 'a'],
        ['2', 'a'],
      ]),
    );
  });
});
