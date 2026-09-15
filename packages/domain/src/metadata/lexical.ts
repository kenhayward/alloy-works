/**
 * The lexical forms a metadata value takes in JSON, and how two of them compare. Pure string and
 * integer arithmetic: no `Date`, whose parsing differs by engine and whose years 0 to 99 mean 1900
 * to 1999, and no JSON number, which is a binary float by the time a parser is done with it.
 */

/**
 * A decimal in canonical form: an optional minus, no leading zeros, no trailing fractional zeros, no
 * exponent, and no negative zero. `0.1` is exactly the string entered, which a float cannot promise.
 */
const CANONICAL_DECIMAL = /^-?(0|[1-9]\d*)(\.\d*[1-9])?$/;

export function isCanonicalDecimal(value: string): boolean {
  return CANONICAL_DECIMAL.test(value) && value !== '-0';
}

const DECIMAL_INPUT = /^([+-])?(\d*)(?:\.(\d*))?$/;

/**
 * What a caller does to a number as entered before it is stored: `007.50` becomes `7.5`, `-0` becomes
 * `0`, `.5` becomes `0.5`. Returns undefined for anything that is not a decimal. Digits are never
 * rounded, so no value is changed on the way in - only spelled one way.
 */
export function canonicaliseDecimal(input: string): string | undefined {
  const match = DECIMAL_INPUT.exec(input);
  if (!match) return undefined;
  const [, sign, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return undefined;
  const integer = whole.replace(/^0+/, '') || '0';
  const fractional = fraction.replace(/0+$/, '');
  const magnitude = fractional ? `${integer}.${fractional}` : integer;
  return sign === '-' && magnitude !== '0' ? `-${magnitude}` : magnitude;
}

/** Negative, zero or positive, as `a` is below, equal to or above `b`. Both must be canonical. */
export function compareDecimal(a: string, b: string): number {
  const negativeA = a.startsWith('-');
  const negativeB = b.startsWith('-');
  if (negativeA !== negativeB) return negativeA ? -1 : 1;
  const magnitude = compareMagnitude(negativeA ? a.slice(1) : a, negativeB ? b.slice(1) : b);
  return negativeA ? 0 - magnitude : magnitude;
}

function compareMagnitude(a: string, b: string): number {
  const [integerA = '', fractionA = ''] = a.split('.');
  const [integerB = '', fractionB = ''] = b.split('.');
  if (integerA.length !== integerB.length) return integerA.length < integerB.length ? -1 : 1;
  if (integerA !== integerB) return integerA < integerB ? -1 : 1;
  const width = Math.max(fractionA.length, fractionB.length);
  const paddedA = fractionA.padEnd(width, '0');
  const paddedB = fractionB.padEnd(width, '0');
  return paddedA === paddedB ? 0 : paddedA < paddedB ? -1 : 1;
}

/** How many decimal places a canonical decimal carries. */
export function decimalScale(value: string): number {
  const point = value.indexOf('.');
  return point === -1 ? 0 : value.length - point - 1;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `YYYY-MM-DD`, a real calendar day from year 1, and no offset (MET-028). */
export function isIsoDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** `HH:MM` or `HH:MM:SS`, and no offset (MET-028). */
export function isIsoTime(value: string): boolean {
  return TIME.test(value);
}

/** A time as `HH:MM:SS`, so that `09:00` and `09:00:00` compare equal and order as strings. */
export function timeKey(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/**
 * The instant an ISO 8601 date and time names, in nanoseconds from 1970-01-01T00:00Z, or undefined
 * when it is not one. The offset, or `Z`, is required: a date and time without one names no instant
 * (MET-028).
 */
export function dateTimeInstant(value: string): bigint | undefined {
  const match = DATE_TIME.exec(value);
  if (!match) return undefined;
  const [, date = '', hour = '', minute = '', second = '0', fraction = '', offset = 'Z'] = match;
  if (!isIsoDate(date)) return undefined;
  const days = daysFromCivil(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    Number(date.slice(8)),
  );
  const offsetMinutes =
    offset === 'Z'
      ? 0
      : (offset.startsWith('-') ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const minutes = BigInt(days) * 1440n + BigInt(Number(hour) * 60 + Number(minute) - offsetMinutes);
  return (
    (minutes * 60n + BigInt(Number(second))) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'))
  );
}

/** Days from 1970-01-01 to a proleptic Gregorian date. Howard Hinnant's `days_from_civil`. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const shiftedMonth = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}
