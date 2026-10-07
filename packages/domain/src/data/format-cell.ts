import type { ValueFormats } from '../theme/schema.js';
import type { CanonicalValue } from './canonical.js';
import type { ColumnType } from './columns.js';
import type { FieldFormat } from './field-format.js';
import { character, formatValue, grouped } from './format.js';

/**
 * **A table's cell as it is printed** (tables.md, "Formatting"; the TB1 plan, TB1-E): the column's
 * format merged over its type's in the table style (TAB-012, TAB-037), printed with the value
 * catalogue's separators, date order and words for the document's language (TAB-045, DAT-033).
 * `formatValue` stays the inline function; this reuses its separators and its date and time printing.
 *
 * **Exact decimal arithmetic on the canonical text**: a number is read as a big integer and a scale,
 * rounded by the declared rule, padded with zeros, and printed - never through a float, never through
 * `Intl`, so the editor, the page and the worker print the same characters for the same value.
 */

/** The words a cell prints that are the layout's, never the theme's: what a null says by default. */
export interface CellWords {
  readonly notAvailable: string;
}

const NBSP = String.fromCodePoint(0xa0);

/** The types a numeric format applies to. */
const isNumber = (type: ColumnType) => type.base === 'integer' || type.base === 'decimal';

/** The types a time's `fraction` applies to. */
const isTimed = (type: ColumnType) =>
  type.base === 'time' || type.base === 'localDateTime' || type.base === 'instant';

/** Every member a number's format may hold; a time's may hold `fraction`; any may hold `null`. */
const NUMBER_MEMBERS: readonly (keyof FieldFormat)[] = [
  'style',
  'places',
  'rounding',
  'negative',
  'negativeColour',
  'currency',
  'percent',
  'duration',
];

/**
 * **The format a column prints by** (TAB-037): the table style's for its type, each member the
 * column states replacing the style's, member by member - a nested member (`currency`, `duration`)
 * replaced whole, since half a currency is none.
 */
export function mergeFormat(
  style: FieldFormat | undefined,
  column: FieldFormat | undefined,
): FieldFormat {
  const merged: Record<string, unknown> = { ...style };
  for (const [member, value] of Object.entries(column ?? {})) {
    if (value !== undefined) merged[member] = value;
  }
  return merged as FieldFormat;
}

/**
 * **The members of a format meaningless for a column's type** (`format_mismatch`), in the format's
 * own order, or none: a number takes every member but `fraction`; a time, a local date-time and an
 * instant take `fraction`, at most the column's own; every type takes `null`. A currency style with no
 * currency to print is `currency` too. Decided where the result's columns are known (the page and the
 * stage), never in the stored shape, since a floating definition's column can change its type.
 */
export function formatMismatch(type: ColumnType, format: FieldFormat): (keyof FieldFormat)[] {
  const wrong: (keyof FieldFormat)[] = [];
  for (const member of Object.keys(format) as (keyof FieldFormat)[]) {
    if (format[member] === undefined || member === 'null') continue;
    if (member === 'fraction') {
      if (!isTimed(type) || (format.fraction ?? 0) > (type as { fraction: number }).fraction) {
        wrong.push(member);
      }
      continue;
    }
    if (!isNumber(type) && NUMBER_MEMBERS.includes(member)) wrong.push(member);
  }
  if (isNumber(type) && format.style === 'currency' && format.currency === undefined) {
    wrong.push('currency');
  }
  return wrong;
}

/** A number read exactly: its sign, its digits as a big integer, and how many of them are places. */
interface Exact {
  readonly negative: boolean;
  readonly digits: bigint;
  readonly scale: number;
}

const DECIMAL = /^-?[0-9]+(?:\.[0-9]+)?$/;

function exact(canonical: string): Exact {
  const negative = canonical.startsWith('-');
  const [whole, places = ''] = (negative ? canonical.slice(1) : canonical).split('.');
  return { negative, digits: BigInt(`${whole}${places}`), scale: places.length };
}

const TEN = 10n;
const power = (exponent: number) => TEN ** BigInt(exponent);

/**
 * `numerator / denominator`, both at least zero and the denominator above it, rounded to a whole
 * number by the rule (TAB-015): at the half, away from zero - a magnitude, so up - or to the even one.
 */
function roundRatio(
  numerator: bigint,
  denominator: bigint,
  rule: NonNullable<FieldFormat['rounding']>,
): bigint {
  const quotient = numerator / denominator;
  const twice = (numerator % denominator) * 2n;
  if (twice > denominator) return quotient + 1n;
  if (twice < denominator) return quotient;
  return rule === 'halfAwayFromZero' || quotient % 2n === 1n ? quotient + 1n : quotient;
}

/** A magnitude at `places`, rounded where it holds more and padded where it holds fewer. */
function atPlaces(value: Exact, places: number, rule: NonNullable<FieldFormat['rounding']>) {
  if (value.scale <= places) return value.digits * power(places - value.scale);
  return roundRatio(value.digits, power(value.scale - places), rule);
}

/** A magnitude of `places` places, its whole part grouped, by the value catalogue's separators. */
function numeral(magnitude: bigint, places: number, number: ValueFormats['number']): string {
  const digits = magnitude.toString().padStart(places + 1, '0');
  const whole = grouped(digits.slice(0, digits.length - places), number);
  return places === 0 ? whole : `${whole}${number.decimal}${digits.slice(-places)}`;
}

/** Hours, minutes and, where shown, seconds of a count of the smallest unit shown. */
function clock(count: bigint, show: 'h:mm' | 'h:mm:ss', separator: string): string {
  const two = (part: bigint) => part.toString().padStart(2, '0');
  if (show === 'h:mm') return `${count / 60n}${separator}${two(count % 60n)}`;
  return `${count / 3600n}${separator}${two((count / 60n) % 60n)}${separator}${two(count % 60n)}`;
}

/**
 * A number as its format prints it, and whether it prints as a negative: zero, and a negative that
 * rounds to zero, print unsigned (tables.md, "Formatting").
 */
function printedNumber(
  canonical: string,
  type: ColumnType,
  format: FieldFormat,
  formats: ValueFormats,
): { readonly body: string; readonly negative: boolean } {
  const rule = format.rounding ?? 'halfAwayFromZero';
  const scale = type.base === 'decimal' ? type.scale : 0;
  let value = exact(canonical);
  if (format.style === 'duration') {
    const { from, show } = format.duration ?? { from: 'seconds', show: 'h:mm:ss' };
    // Seconds or minutes, counted in the smallest unit shown: rearranged, never converted (TAB-038).
    const into = from === 'minutes' ? 60n : 1n;
    const per = show === 'h:mm' ? 60n : 1n;
    const count = roundRatio(value.digits * into, power(value.scale) * per, rule);
    return {
      body: clock(count, show, formats.time.separator),
      negative: value.negative && count > 0n,
    };
  }
  let places = format.places ?? scale;
  if (format.style === 'percent' && (format.percent ?? 'fraction') === 'fraction') {
    // The decimal point moved two places: the same quantity written as a percentage (TAB-038).
    value =
      value.scale >= 2
        ? { ...value, scale: value.scale - 2 }
        : { ...value, digits: value.digits * power(2 - value.scale), scale: 0 };
    places = format.places ?? Math.max(0, scale - 2);
  }
  const magnitude = atPlaces(value, places, rule);
  let body = numeral(magnitude, places, formats.number);
  if (format.style === 'percent') body = `${body}%`;
  if (format.style === 'currency' && format.currency !== undefined) {
    const { symbol, position, space } = format.currency;
    const gap = space ? NBSP : '';
    body = position === 'before' ? `${symbol}${gap}${body}` : `${body}${gap}${symbol}`;
  }
  return { body, negative: value.negative && magnitude > 0n };
}

/** A time's canonical text with its fraction cut to `digits`: a clock is cut, never rounded. */
const cutFraction = (canonical: string, digits: number) =>
  canonical.replace(/\.([0-9]+)/, (_, places: string) =>
    digits === 0 ? '' : `.${places.slice(0, digits)}`,
  );

/**
 * **The one function a table's cell is printed by** (TB1-E): `value` canonical in `type` (ADR-0035),
 * `format` the column's merged over the style's (`mergeFormat`), held to `formatMismatch` before.
 *
 * - A null prints the format's `null`, else the layout's `words.notAvailable` (TAB-017), never `0`
 *   and never empty; an empty text prints empty.
 * - A number at `places` - the type's where none: none for an integer, its scale for a decimal - by
 *   `rounding` (TAB-014, TAB-015), grouped, as a `currency`, a `percent` or a `duration` where its
 *   style says, negative by a minus or in parentheses (TAB-016), unsigned where it rounds to zero.
 * - A date, a boolean and a text as `formatValue` prints them; a time and a date-time with their
 *   fraction cut to the format's `fraction`.
 * - `unit`, where the column prints one after each value, after it and a no-break space: a label,
 *   changing no digit (TAB-038), and never after a null.
 */
export function formatCell(
  value: CanonicalValue,
  type: ColumnType,
  format: FieldFormat,
  formats: ValueFormats,
  words: CellWords,
  unit?: string,
): string {
  if (value === null) return format.null ?? words.notAvailable;
  const labelled = (printed: string) => (unit === undefined ? printed : `${printed}${NBSP}${unit}`);
  if (type.base === 'image') throw new Error('An image column is not printed as a cell');
  if (isNumber(type) && typeof value === 'string' && DECIMAL.test(value)) {
    const { body, negative } = printedNumber(value, type, format, formats);
    if (!negative) return labelled(body);
    return labelled(
      (format.negative ?? 'minus') === 'parentheses'
        ? `(${body})`
        : `${character(formats.number.minus)}${body}`,
    );
  }
  if (isTimed(type) && typeof value === 'string') {
    const digits = format.fraction ?? (type as { fraction: number }).fraction;
    return labelled(
      formatValue(cutFraction(value, digits), { ...type, fraction: digits } as never, formats),
    );
  }
  // A cell that is not its column's canonical form prints as the text it is, never as a number.
  if (isNumber(type)) return labelled(formatValue(String(value), { base: 'text' }, formats));
  return labelled(formatValue(value, type, formats));
}

/**
 * Whether a cell is set in the style's negative colour (TAB-016): only where its format asks and it
 * prints as a negative - beside its minus or its parentheses, never in place of them.
 */
export function colouredNegative(
  value: CanonicalValue,
  type: ColumnType,
  format: FieldFormat,
): boolean {
  if (format.negativeColour !== true || !isNumber(type)) return false;
  if (typeof value !== 'string' || !DECIMAL.test(value)) return false;
  return printedNumber(value, type, format, PLAIN).negative;
}

/**
 * Whether a cell prints its value in parentheses (TAB-016): a number printing as a negative under a
 * format asking for them. Decided by what is printed, never read back from the printed text, which a
 * unit after the value or a currency may end (TB1-I).
 */
export function parenthesised(
  value: CanonicalValue,
  type: ColumnType,
  format: FieldFormat,
): boolean {
  if ((format.negative ?? 'minus') !== 'parentheses' || !isNumber(type)) return false;
  if (typeof value !== 'string' || !DECIMAL.test(value)) return false;
  return printedNumber(value, type, format, PLAIN).negative;
}

/** Any separators: whether a number prints as a negative does not depend on them. */
const PLAIN: ValueFormats = {
  number: { decimal: '.', group: 'none', groupFrom: 4, minus: 'U+002D' },
  date: { order: 'ymd', separator: '-', pad: true },
  time: { separator: ':' },
  boolean: { true: 'Yes', false: 'No' },
};
