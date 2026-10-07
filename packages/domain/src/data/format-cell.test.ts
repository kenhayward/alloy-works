import { describe, expect, it } from 'vitest';

import { tableBindingSchema } from '../content/model/inline.js';
import { DEFAULT_VALUE_FORMATS } from '../theme/default.js';
import type { ValueFormats } from '../theme/schema.js';
import type { ColumnType } from './columns.js';
import { fieldFormatSchema, type FieldFormat } from './field-format.js';
import { colouredNegative, formatCell, formatMismatch, mergeFormat } from './format-cell.js';

/**
 * A table's cell as it is printed (tables.md, "Formatting"; the TB1 plan, task 3): exact decimal
 * arithmetic on the canonical text, the value catalogue's separators, never a float or `Intl`.
 */

const NBSP = String.fromCodePoint(0xa0);
const NNBSP = String.fromCodePoint(0x202f);
const MINUS = String.fromCodePoint(0x2212);

const words = { notAvailable: 'Not available' };
const f = DEFAULT_VALUE_FORMATS;
const integer: ColumnType = { base: 'integer' };
const decimal = (scale: number, precision = 40): ColumnType => ({
  base: 'decimal',
  precision,
  scale,
});
const cell = (
  value: string | boolean | null,
  type: ColumnType,
  format: FieldFormat = {},
  formats: ValueFormats = f,
  unit?: string,
) => formatCell(value, type, format, formats, words, unit);

/** French formats: a comma for the decimal, a narrow no-break space grouping, the true minus. */
const fr: ValueFormats = {
  ...f,
  number: { decimal: ',', group: 'U+202F', groupFrom: 4, minus: 'U+2212' },
  date: { order: 'dmy', separator: '/', pad: true },
};

/**
 * The reference rounding, by another method than `formatCell`'s: the digits read as written, the one
 * after the cut and whether any after it is not zero deciding, and the kept digits incremented as a
 * big integer. Places at most the value's own.
 */
function referenceRound(
  value: string,
  places: number,
  rule: 'halfAwayFromZero' | 'halfEven',
): string {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const digits = fraction.padEnd(places + 1, '0');
  const kept = BigInt(`${whole}${digits.slice(0, places)}`);
  const next = Number(digits[places]);
  const rest = /[1-9]/.test(digits.slice(places + 1));
  const up = next > 5 || (next === 5 && (rest || rule === 'halfAwayFromZero' || kept % 2n === 1n));
  const rounded = (up ? kept + 1n : kept).toString().padStart(places + 1, '0');
  const printed = places === 0 ? rounded : `${rounded.slice(0, -places)}.${rounded.slice(-places)}`;
  return negative && /[1-9]/.test(rounded) ? `-${printed}` : printed;
}

/** A canonical decimal from a seed: up to 24 whole digits and 12 places, half the time negative. */
function decimalFrom(seed: number): string {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
  const length = 1 + (next() % 24);
  let whole = String(1 + (next() % 9));
  for (let at = 1; at < length; at += 1) whole += String(next() % 10);
  if (next() % 4 === 0) whole = '0';
  let fraction = '';
  const places = next() % 13;
  for (let at = 0; at < places; at += 1) fraction += String(next() % 10);
  // Halves made often, since they are where the rules differ.
  if (next() % 3 === 0) fraction = `${fraction.slice(0, Math.max(0, places - 1))}5`;
  fraction = fraction.replace(/0+$/, '');
  const value = fraction === '' ? whole : `${whole}.${fraction}`;
  return next() % 2 === 0 && value !== '0' ? `-${value}` : value;
}

describe('a table cell, formatted', () => {
  it("TAB-012 prints a column with no format in its type's style format, and one with a format in its own", () => {
    const style: FieldFormat = { style: 'number', places: 2 };
    expect(cell('1.5', decimal(4), mergeFormat(style, undefined))).toBe('1.50');
    expect(cell('1.5', decimal(4), mergeFormat(style, { places: 0 }))).toBe('2');
    expect(cell('1.5', decimal(4), mergeFormat(undefined, undefined))).toBe('1.5000');
  });

  it("TAB-037 merges a column's override member by member: places changed, the style's currency, negative form and separators kept", () => {
    const style: FieldFormat = {
      style: 'currency',
      currency: { symbol: '$', position: 'before', space: false },
      negative: 'parentheses',
      places: 2,
    };
    const merged = mergeFormat(style, { places: 0 });
    expect(merged).toEqual({ ...style, places: 0 });
    expect(cell('-1234.56', decimal(2), merged)).toBe('($1,235)');
    expect(cell('-1234.56', decimal(2), merged, fr)).toBe(`($1${NNBSP}235)`);
  });

  it('TAB-013 prints a number, a currency before and after, a percentage from a fraction and from a hundred, a date, a time, a duration and a unit', () => {
    expect(cell('1234567', integer)).toBe('1,234,567');
    const dollars = { symbol: '$', position: 'before', space: false } as const;
    const euros = { symbol: 'EUR', position: 'after', space: true } as const;
    expect(cell('12.5', decimal(2), { style: 'currency', currency: dollars })).toBe('$12.50');
    expect(cell('12.5', decimal(2), { style: 'currency', currency: euros })).toBe(
      `12.50${NBSP}EUR`,
    );
    expect(cell('0.2513', decimal(4), { style: 'percent', percent: 'fraction' })).toBe('25.13%');
    expect(cell('25', integer, { style: 'percent', percent: 'hundred' })).toBe('25%');
    expect(cell('2026-10-07', { base: 'date' })).toBe('2026-10-07');
    expect(cell('2026-10-07', { base: 'date' }, {}, fr)).toBe('07/10/2026');
    expect(cell('12:30:15.25', { base: 'time', fraction: 3 }, { fraction: 1 })).toBe('12:30:15.2');
    expect(cell('12:30:15.25', { base: 'time', fraction: 3 })).toBe('12:30:15.250');
    const seconds = (show: 'h:mm' | 'h:mm:ss') =>
      ({ style: 'duration', duration: { from: 'seconds', show } }) as const;
    expect(cell('3725', integer, seconds('h:mm:ss'))).toBe('1:02:05');
    expect(cell('3725', integer, seconds('h:mm'))).toBe('1:02');
    expect(
      cell('90', integer, { style: 'duration', duration: { from: 'minutes', show: 'h:mm' } }),
    ).toBe('1:30');
    expect(cell('12.5', decimal(2), {}, f, 'kg')).toBe(`12.50${NBSP}kg`);
  });

  it('TAB-014 prints every value in a column at its places, padding and rounding', () => {
    expect(cell('1.5', decimal(4), { places: 3 })).toBe('1.500');
    expect(cell('2.7183', decimal(4), { places: 2 })).toBe('2.72');
    expect(cell('7', integer, { places: 2 })).toBe('7.00');
    expect(cell('1999.995', decimal(3), { places: 2 })).toBe('2,000.00');
  });

  it('TAB-015 rounds at the half by the rule declared, half away from zero or half to even', () => {
    const at = (value: string, places: number, rounding: FieldFormat['rounding']) =>
      cell(value, decimal(4), { places, rounding });
    expect(['2.5', '3.5', '-2.5'].map((v) => at(v, 0, 'halfAwayFromZero'))).toEqual([
      '3',
      '4',
      '-3',
    ]);
    expect(['2.5', '3.5', '-2.5'].map((v) => at(v, 0, 'halfEven'))).toEqual(['2', '4', '-2']);
    expect(at('0.125', 2, 'halfAwayFromZero')).toBe('0.13');
    expect(at('0.125', 2, 'halfEven')).toBe('0.12');
    // A negative value rounding to zero prints unsigned.
    expect(at('-0.004', 2, 'halfAwayFromZero')).toBe('0.00');
    expect(at('-0.005', 2, 'halfEven')).toBe('0.00');
  });

  it('TAB-015 rounds as a big-integer reference does, over 2,000 values at every place', () => {
    const plain = { ...f, number: { ...f.number, group: 'none' as const } };
    for (let seed = 1; seed <= 2000; seed += 1) {
      const value = decimalFrom(seed);
      const scale = value.split('.')[1]?.length ?? 0;
      for (const rounding of ['halfAwayFromZero', 'halfEven'] as const) {
        const places = seed % (scale + 1);
        expect(cell(value, decimal(12), { places, rounding }, plain), `${value} ${places}`).toBe(
          referenceRound(value, places, rounding),
        );
      }
    }
  });

  it('TAB-016 prints a negative with a minus or in parentheses, and its colour only beside either, never alone', () => {
    expect(cell('-1.5', decimal(2), { negative: 'minus' })).toBe('-1.50');
    expect(cell('-1.5', decimal(2), { negative: 'minus' }, fr)).toBe(`${MINUS}1,50`);
    expect(cell('-1.5', decimal(2), { negative: 'parentheses' })).toBe('(1.50)');
    for (const negative of ['minus', 'parentheses'] as const) {
      const format: FieldFormat = { negative, negativeColour: true };
      expect(cell('-1.5', decimal(2), format)).toBe(negative === 'minus' ? '-1.50' : '(1.50)');
      expect(colouredNegative('-1.5', decimal(2), format)).toBe(true);
      expect(colouredNegative('1.5', decimal(2), format)).toBe(false);
      // A negative that rounds to zero prints unsigned, and so uncoloured.
      expect(colouredNegative('-0.004', decimal(3), { ...format, places: 2 })).toBe(false);
    }
    expect(colouredNegative('-1.5', decimal(2), { negative: 'minus' })).toBe(false);
  });

  it("TAB-017 prints a null as its declared text, else the layout's word, apart from zero and from an empty text", () => {
    expect(cell(null, decimal(2))).toBe('Not available');
    expect(cell(null, decimal(2), { null: 'none' })).toBe('none');
    expect(cell('0', decimal(2))).toBe('0.00');
    expect(cell('', { base: 'text' })).toBe('');
    expect(cell(null, { base: 'text' })).toBe('Not available');
    expect(fieldFormatSchema.safeParse({ null: '0' }).success).toBe(false);
    // Digits of any script, and a currency's symbol beside them, read as a number too.
    const fullwidth = String.fromCodePoint(0xff15);
    const arabicIndic = String.fromCodePoint(0x0665, 0x066b, 0x0660);
    const euro = String.fromCodePoint(0x20ac);
    for (const looks of [fullwidth, arabicIndic, '$5', `5 ${euro}`, `(${euro}5)`]) {
      expect(fieldFormatSchema.safeParse({ null: looks }).success, looks).toBe(false);
    }
    expect(fieldFormatSchema.safeParse({ null: 'n/a' }).success).toBe(true);
  });

  it('TAB-019 rounds a 30-digit decimal for print and leaves its canonical value as it was', () => {
    const value = '123456789012345678901234567890.123456789';
    const printed = cell(value, decimal(9), { places: 2 });
    expect(printed).toBe('123,456,789,012,345,678,901,234,567,890.12');
    expect(value).toBe('123456789012345678901234567890.123456789');
  });

  it('TAB-038 prints a unit as a label, changing no digit', () => {
    for (const format of [{}, { places: 0 }, { style: 'percent', percent: 'hundred' }] as const) {
      const bare = cell('12.5', decimal(2), format);
      expect(cell('12.5', decimal(2), format, f, 'm')).toBe(`${bare}${NBSP}m`);
    }
    // A null is not a quantity, so carries no unit.
    expect(cell(null, decimal(2), {}, f, 'm')).toBe('Not available');
  });

  it("DAT-033 formats a table's cell by the style over the value catalogue's formats, and the binding holds no format", () => {
    expect(cell('-1234.5', decimal(2), { places: 2 }, fr)).toBe(`${MINUS}1${NNBSP}234,50`);
    expect(cell('-1234.5', decimal(2), { places: 2 }, f)).toBe('-1,234.50');
    const binding = {
      type: 'binding',
      id: 'k1',
      query: '00000000-0000-4000-8000-00000000d001',
      parameters: {},
      mode: 'checked',
    };
    expect(tableBindingSchema.safeParse(binding).success).toBe(true);
    expect(tableBindingSchema.safeParse({ ...binding, format: { places: 2 } }).success).toBe(false);
  });

  it("names each member meaningless for a column's type, format_mismatch", () => {
    const dollars = { symbol: '$', position: 'before', space: false } as const;
    expect(formatMismatch({ base: 'date' }, { currency: dollars, null: 'none' })).toEqual([
      'currency',
    ]);
    expect(formatMismatch(decimal(2), { fraction: 0 })).toEqual(['fraction']);
    expect(formatMismatch({ base: 'time', fraction: 2 }, { fraction: 3 })).toEqual(['fraction']);
    expect(formatMismatch({ base: 'time', fraction: 2 }, { fraction: 2 })).toEqual([]);
    expect(formatMismatch(decimal(2), { style: 'currency' })).toEqual(['currency']);
    expect(formatMismatch({ base: 'text' }, { places: 2, negative: 'minus' })).toEqual([
      'places',
      'negative',
    ]);
    expect(formatMismatch(integer, { style: 'duration', places: 1 })).toEqual([]);
  });
});
