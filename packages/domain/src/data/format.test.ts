import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_VALUE_FORMATS } from '../theme/default.js';
import type { ValueCatalogue, ValueFormats } from '../theme/schema.js';
import type { ValueType } from './columns.js';
import { formatsFor, formatValue } from './format.js';

/**
 * `formatValue` and `formatsFor` (the B1 plan, B1-G): a value printed by what the theme's value
 * catalogue declares, never by a locale, so the editor, the read text and the publish print the same
 * characters in Chromium, Electron and Node.
 */

const NBSP = String.fromCodePoint(0xa0);
const NNBSP = String.fromCodePoint(0x202f);
const MINUS = String.fromCodePoint(0x2212);

const formats = (over: Partial<Record<keyof ValueFormats, object>> = {}): ValueFormats =>
  ({
    number: { ...DEFAULT_VALUE_FORMATS.number, ...over.number },
    date: { ...DEFAULT_VALUE_FORMATS.date, ...over.date },
    time: { ...DEFAULT_VALUE_FORMATS.time, ...over.time },
    boolean: { ...DEFAULT_VALUE_FORMATS.boolean, ...over.boolean },
  }) as ValueFormats;

const INTEGER: ValueType = { base: 'integer' };
const decimal = (scale: number): ValueType => ({ base: 'decimal', precision: 12, scale });

describe('formatValue', () => {
  it('groups an integer in threes once it has groupFrom digits, by the declared group', () => {
    const f = formats();
    expect(formatValue('123', INTEGER, f)).toBe('123');
    expect(formatValue('1234', INTEGER, f)).toBe('1,234');
    expect(formatValue('1234567', INTEGER, f)).toBe('1,234,567');
    expect(formatValue('0', INTEGER, f)).toBe('0');
    const fromFive = formats({ number: { groupFrom: 5 } });
    expect(formatValue('1234', INTEGER, fromFive)).toBe('1234');
    expect(formatValue('12345', INTEGER, fromFive)).toBe('12,345');
    const each = { none: '1234567', '.': '1.234.567', "'": "1'234'567" } as const;
    for (const [group, printed] of Object.entries(each)) {
      const declared = formats({ number: { group, decimal: group === '.' ? ',' : '.' } });
      expect(formatValue('1234567', INTEGER, declared), group).toBe(printed);
    }
    expect(formatValue('1234567', INTEGER, formats({ number: { group: 'U+00A0' } }))).toBe(
      `1${NBSP}234${NBSP}567`,
    );
    expect(formatValue('1234567', INTEGER, formats({ number: { group: 'U+202F' } }))).toBe(
      `1${NNBSP}234${NNBSP}567`,
    );
  });

  it('prints a negative number with the declared minus', () => {
    expect(formatValue('-1234', INTEGER, formats())).toBe('-1,234');
    expect(formatValue('-1234', INTEGER, formats({ number: { minus: 'U+2212' } }))).toBe(
      `${MINUS}1,234`,
    );
    expect(formatValue('-0.5', decimal(2), formats({ number: { minus: 'U+2212' } }))).toBe(
      `${MINUS}0.50`,
    );
  });

  it('prints a decimal at exactly its scale, putting back the zeros its canonical form drops', () => {
    expect(formatValue('1.5', decimal(3), formats())).toBe('1.500');
    expect(formatValue('12', decimal(2), formats())).toBe('12.00');
    expect(formatValue('1234.5', decimal(1), formats())).toBe('1,234.5');
    expect(formatValue('1234', decimal(0), formats())).toBe('1,234');
    expect(formatValue('0.125', decimal(3), formats())).toBe('0.125');
    expect(
      formatValue('1234.5', decimal(1), formats({ number: { decimal: ',', group: '.' } })),
    ).toBe('1.234,5');
  });

  it('prints a date in its order and separator, its day and month padded or not, its year in four digits', () => {
    const date: ValueType = { base: 'date' };
    expect(formatValue('2026-03-07', date, formats())).toBe('2026-03-07');
    expect(
      formatValue('2026-03-07', date, formats({ date: { order: 'dmy', separator: '.' } })),
    ).toBe('07.03.2026');
    expect(
      formatValue(
        '2026-03-07',
        date,
        formats({ date: { order: 'mdy', separator: '/', pad: false } }),
      ),
    ).toBe('3/7/2026');
    expect(formatValue('0987-11-21', date, formats({ date: { pad: false } }))).toBe('0987-11-21');
  });

  it('prints a time by its separator, its fraction to the declared digits after the decimal separator', () => {
    expect(formatValue('09:05:00', { base: 'time', fraction: 0 }, formats())).toBe('09:05:00');
    expect(formatValue('09:05:00.5', { base: 'time', fraction: 3 }, formats())).toBe(
      '09:05:00.500',
    );
    expect(formatValue('09:05:00', { base: 'time', fraction: 2 }, formats())).toBe('09:05:00.00');
    const dotted = formats({ time: { separator: '.' }, number: { decimal: ',', group: '.' } });
    expect(formatValue('09:05:00.25', { base: 'time', fraction: 2 }, dotted)).toBe('09.05.00,25');
  });

  it('prints a local date-time as its date, a space and its time, and an instant the same in UTC followed by UTC', () => {
    expect(
      formatValue('2026-03-07T09:05:00', { base: 'localDateTime', fraction: 0 }, formats()),
    ).toBe('2026-03-07 09:05:00');
    expect(formatValue('2026-03-07T09:05:00.5Z', { base: 'instant', fraction: 3 }, formats())).toBe(
      '2026-03-07 09:05:00.500 UTC',
    );
    expect(
      formatValue(
        '2026-03-07T09:05:00Z',
        { base: 'instant', fraction: 0 },
        formats({ date: { order: 'dmy', separator: '/' } }),
      ),
    ).toBe('07/03/2026 09:05:00 UTC');
  });

  it('prints a boolean in its declared words', () => {
    const f = formats({ boolean: { true: 'Oui', false: 'Non' } });
    expect(formatValue(true, { base: 'boolean' }, f)).toBe('Oui');
    expect(formatValue(false, { base: 'boolean' }, f)).toBe('Non');
    expect(formatValue(true, { base: 'boolean' }, formats())).toBe('Yes');
  });

  it('prints text as it is, each line break and tab one space', () => {
    const text: ValueType = { base: 'text' };
    expect(formatValue('North  bank', text, formats())).toBe('North  bank');
    expect(formatValue('a\r\nb', text, formats())).toBe('a b');
    expect(formatValue('a\nb\rc\td', text, formats())).toBe('a b c d');
    const breaks = [0x85, 0x2028, 0x2029].map((point) => String.fromCodePoint(point));
    expect(formatValue(`a${breaks.join('')}b`, text, formats())).toBe('a   b');
    expect(formatValue('a\n\nb', text, formats())).toBe('a  b');
  });

  it('reads no locale: no Intl and no toLocale in its source', () => {
    const source = readFileSync(join(import.meta.dirname, 'format.ts'), 'utf8');
    expect(source).not.toMatch(/\bIntl\b/);
    expect(source).not.toMatch(/toLocale/);
  });
});

describe('formatsFor', () => {
  const swiss = formats({ number: { decimal: '.', group: "'" } });
  const catalogue: ValueCatalogue = {
    schemaVersion: 3,
    kind: 'value',
    formats: formats({ date: { order: 'dmy', separator: '/' } }),
    byLanguage: [{ language: 'de', formats: swiss }],
  };

  it("picks the formats of the document's language by its primary subtag, lowercased, else the catalogue's own", () => {
    expect(formatsFor(catalogue, 'de-CH')).toBe(swiss);
    expect(formatsFor(catalogue, 'DE')).toBe(swiss);
    expect(formatsFor(catalogue, 'fr')).toBe(catalogue.formats);
    expect(formatsFor(catalogue, null)).toBe(catalogue.formats);
  });

  it('answers the product default where the theme names no value catalogue', () => {
    expect(formatsFor(null, 'de-CH')).toBe(DEFAULT_VALUE_FORMATS);
    expect(formatsFor(null, null)).toBe(DEFAULT_VALUE_FORMATS);
  });
});
