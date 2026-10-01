import type { ColumnBase, ColumnType } from './columns.js';

/**
 * ADR-0035's canonical form of a result, version 1: the declared columns as `[name, base]` pairs, and
 * the rows, every cell a JSON string, a JSON boolean or `null` - never a number - serialised as RFC
 * 8785 canonical JSON, whose SHA-256 is the result's checksum. A change to any rule here is a new
 * version of the form, never a silent re-hash.
 */
export const CANONICAL_FORM = 1;

/** A cell of a canonical result, and a parameter's value: a string, a boolean or null. */
export type CanonicalValue = string | boolean | null;

export interface CanonicalResult {
  readonly columns: readonly (readonly [string, ColumnBase])[];
  readonly rows: readonly (readonly CanonicalValue[])[];
}

/**
 * Why a value is not the canonical spelling of its type: `type` where it is not a spelling of the type
 * at all, or is another spelling of one - a trailing fractional zero, a leading zero, `-0`; `precision`
 * where a decimal has more integer digits than its declaration leaves, or a time more fractional
 * digits than its declared fraction; `scale` where a decimal has more places than its scale; `zone`
 * where an instant has no `Z`, or a time or a local date-time has a zone.
 */
export type ValueProblem = 'type' | 'precision' | 'scale' | 'zone';

const INTEGER = /^(?:0|-?[1-9][0-9]*)$/;
const DECIMAL = /^-?(0|[1-9][0-9]*)(?:\.([0-9]*[1-9]))?$/;
const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const TIME = /^([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]*[1-9]))?$/;
/** Anything a zone could be written as after a time: `Z`, or an offset. */
const ZONED = /(?:Z|[+-][0-9]{2}(?::?[0-9]{2})?)$/;

function isCalendarDate(text: string): boolean {
  const match = DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= days;
}

/** A time of day's problem against its declared fraction, or null where it is canonical. */
function timeProblem(text: string, fraction: number): ValueProblem | null {
  const match = TIME.exec(text);
  if (!match) return 'type';
  if (Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 59) return 'type';
  return (match[4]?.length ?? 0) > fraction ? 'precision' : null;
}

/** A date and a time joined by `T`, with the zone already taken off. */
function dateTimeProblem(text: string, fraction: number): ValueProblem | null {
  const at = text.indexOf('T');
  if (at !== 10 || !isCalendarDate(text.slice(0, at))) return 'type';
  return timeProblem(text.slice(at + 1), fraction);
}

/**
 * Why a value is not the canonical spelling of its declared type, or null where it is (ADR-0035): an
 * integer base 10 with no leading zero or `-0`; a decimal the same with no exponent and no trailing
 * fractional zero, within its precision and scale; a date `YYYY-MM-DD` from year 1 to 9999; a time and
 * a local date-time with no zone, a fraction with no trailing zero, within the declared fraction; an
 * instant the same ending in `Z`; a boolean a JSON boolean; text any string. An image is never a value
 * of a D2 definition, and has no spelling here.
 */
export function valueProblem(type: ColumnType, value: unknown): ValueProblem | null {
  switch (type.base) {
    case 'text':
      return typeof value === 'string' ? null : 'type';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'type';
    case 'integer':
      return typeof value === 'string' && INTEGER.test(value) ? null : 'type';
    case 'decimal': {
      if (typeof value !== 'string') return 'type';
      const match = DECIMAL.exec(value);
      if (!match || value === '-0') return 'type';
      const whole = match[1]!;
      const places = match[2]?.length ?? 0;
      if (places > type.scale) return 'scale';
      return (whole === '0' ? 0 : whole.length) > type.precision - type.scale ? 'precision' : null;
    }
    case 'date':
      return typeof value === 'string' && isCalendarDate(value) ? null : 'type';
    case 'time':
      if (typeof value !== 'string') return 'type';
      if (ZONED.test(value) && timeProblem(value.replace(ZONED, ''), 6) !== 'type') return 'zone';
      return timeProblem(value, type.fraction);
    case 'localDateTime':
      if (typeof value !== 'string') return 'type';
      if (ZONED.test(value) && dateTimeProblem(value.replace(ZONED, ''), 6) !== 'type')
        return 'zone';
      return dateTimeProblem(value, type.fraction);
    case 'instant': {
      if (typeof value !== 'string') return 'type';
      if (value.endsWith('Z')) return dateTimeProblem(value.slice(0, -1), type.fraction);
      // An offset, or no zone at all: an instant is converted to UTC and says so, and nothing else is.
      const bare = value.replace(ZONED, '');
      return dateTimeProblem(bare, 6) === 'type' ? 'type' : 'zone';
    }
    case 'image':
      return 'type';
  }
}

/** Whether a value is the one canonical spelling of its declared type (ADR-0035). */
export function isCanonical(type: ColumnType, value: CanonicalValue): boolean {
  return valueProblem(type, value) === null;
}

/** Two strings by their Unicode code points, not their UTF-16 units. */
export function compareCodePoints(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let at = 0; at < length; at += 1) {
    const x = a.charCodeAt(at);
    const y = b.charCodeAt(at);
    if (x === y) continue;
    // A surrogate stands for a code point above every unit that is not one, which is the only place
    // unit order and code point order disagree.
    const high = (unit: number) => (unit >= 0xd800 && unit <= 0xdfff ? unit + 0x10000 : unit);
    return high(x) < high(y) ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** Two canonical decimals, exactly. */
function compareDecimals(a: string, b: string): number {
  const [aWhole, aPlaces = ''] = a.split('.');
  const [bWhole, bPlaces = ''] = b.split('.');
  const places = Math.max(aPlaces.length, bPlaces.length);
  const scaled = (whole: string, fraction: string) =>
    BigInt(whole) * 10n ** BigInt(places) +
    (whole.startsWith('-') ? -1n : 1n) * BigInt(fraction.padEnd(places, '0') || '0');
  const x = scaled(aWhole!, aPlaces);
  const y = scaled(bWhole!, bPlaces);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A canonical time, local date-time or instant: its fixed-width part, then its fraction padded. */
function compareTimes(a: string, b: string): number {
  const split = (text: string) => {
    const bare = text.endsWith('Z') ? text.slice(0, -1) : text;
    const point = bare.indexOf('.');
    return point < 0 ? [bare, ''] : [bare.slice(0, point), bare.slice(point + 1)];
  };
  const [aFixed, aFraction] = split(a);
  const [bFixed, bFraction] = split(b);
  if (aFixed !== bFixed) return aFixed! < bFixed! ? -1 : 1;
  const x = aFraction!.padEnd(6, '0');
  const y = bFraction!.padEnd(6, '0');
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * The product's comparison of two canonical values of one type (the D2 plan, D2-M): numbers and times
 * by value, `false` before `true`, text by code point, and null after every value - PostgreSQL's
 * default, nulls last ascending and first descending.
 */
export function compareCanonical(type: ColumnType, a: CanonicalValue, b: CanonicalValue): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  switch (type.base) {
    case 'boolean':
      return a === b ? 0 : a === false ? -1 : 1;
    case 'integer': {
      const x = BigInt(a as string);
      const y = BigInt(b as string);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    case 'decimal':
      return compareDecimals(a as string, b as string);
    case 'date':
      return a === b ? 0 : (a as string) < (b as string) ? -1 : 1;
    case 'time':
    case 'localDateTime':
    case 'instant':
      return compareTimes(a as string, b as string);
    case 'text':
    case 'image':
      return compareCodePoints(a as string, b as string);
  }
}

/** A row's canonical text: its JSON, which is RFC 8785's for strings, booleans and null. */
const rowText = (row: readonly CanonicalValue[]) => JSON.stringify(row);

/** Why a result does not fit its declared order or key, and the row, counted from 1, where it shows. */
export interface OrderMismatch {
  readonly mismatch: 'order' | 'key' | 'null_key';
  readonly row: number;
  readonly column?: string;
}

/**
 * A result held to its declared order and key (the D2 plan, D2-M; DAT-106, DAT-107). A declared order
 * is checked, never imposed: each row is compared with the one before by the product's comparison,
 * and the first out of order is named. A key is never null and never repeated. A multiset is sorted by
 * each row's canonical text, code point by code point, so rewriting unchanged rows moves no checksum.
 */
export function orderRows(
  result: CanonicalResult,
  definition: {
    readonly columns: readonly { readonly name: string; readonly type: ColumnType }[];
    readonly key: readonly string[];
    readonly order:
      | readonly { readonly column: string; readonly direction: 'ascending' | 'descending' }[]
      | 'multiset';
  },
): CanonicalResult | OrderMismatch {
  const index = new Map(definition.columns.map((column, at) => [column.name, at]));
  const keys = definition.key.map((name) => [name, index.get(name)!] as const);
  const order =
    definition.order === 'multiset'
      ? []
      : definition.order.map((each) => ({
          at: index.get(each.column)!,
          type: definition.columns[index.get(each.column)!]!.type,
          sign: each.direction === 'ascending' ? 1 : -1,
        }));
  const seen = new Set<string>();
  for (let at = 0; at < result.rows.length; at += 1) {
    const row = result.rows[at]!;
    for (const [name, column] of keys) {
      if (row[column] === null) return { mismatch: 'null_key', row: at + 1, column: name };
    }
    if (at > 0 && order.length > 0) {
      const before = result.rows[at - 1]!;
      for (const { at: column, type, sign } of order) {
        const compared = sign * compareCanonical(type, before[column]!, row[column]!);
        if (compared < 0) break;
        if (compared > 0) return { mismatch: 'order', row: at + 1 };
      }
    }
    if (keys.length > 0) {
      const key = rowText(keys.map(([, column]) => row[column]!));
      if (seen.has(key)) return { mismatch: 'key', row: at + 1 };
      seen.add(key);
    }
  }
  if (definition.order !== 'multiset') return result;
  const sorted = result.rows
    .map((row) => [rowText(row), row] as const)
    .sort(([a], [b]) => compareCodePoints(a, b))
    .map(([, row]) => row);
  return { columns: result.columns, rows: sorted };
}

/**
 * A result's canonical bytes (ADR-0035): RFC 8785 JSON of `{ columns, rows }`. Its members are in that
 * order already, it holds no number, and JavaScript's string escaping is RFC 8785's, so this is
 * `JSON.stringify` - and no normalisation: text is its code points, and two spellings of `café` differ.
 */
export function canonicalResultBytes(result: CanonicalResult): string {
  return JSON.stringify({ columns: result.columns, rows: result.rows });
}
