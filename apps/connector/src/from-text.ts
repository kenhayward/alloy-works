import type { CanonicalValue, ColumnType, ValueType } from '@alloy-works/domain';

/**
 * A PostgreSQL value, as the server printed it, to its canonical form (ADR-0035; the D2 plan, D2-L and
 * D2-Q). The session's `TimeZone` is UTC and its `DateStyle` ISO, so every date and time arrives in
 * one spelling; every value is read from that text, never through a JavaScript number or `Date`.
 */

/** Which source types each declared base admits (D2-L); a domain is read by its base already. */
const ADMITTED: Readonly<Record<ValueType['base'], readonly string[]>> = {
  text: ['text', 'varchar', 'bpchar', 'name', 'citext', 'uuid', 'json', 'jsonb', 'xml'],
  integer: ['int2', 'int4', 'int8', 'numeric'],
  decimal: ['int2', 'int4', 'int8', 'numeric'],
  date: ['date'],
  time: ['time'],
  localDateTime: ['timestamp'],
  instant: ['timestamptz'],
  boolean: ['bool'],
};

/** The character types an image declared base64 is read from (D8-A). */
const BASE64_TEXT = ['text', 'varchar', 'bpchar', 'citext'];

/**
 * Whether a declared type takes a source type (D2-L): text from the character types, the JSON and XML
 * types, a UUID and any enum; an integer or a decimal from the integer types and numeric; each date and
 * time from its own type; a boolean from `bool`; an image from `bytea` where it is declared binary,
 * and from the character types where it is declared base64 (D8-A). Anything else is the author's to
 * cast in the SQL.
 */
export function admits(
  type: ColumnType,
  source: { readonly name: string; readonly kind: string },
): boolean {
  if (type.base === 'image') {
    return type.encoding === 'binary' ? source.name === 'bytea' : BASE64_TEXT.includes(source.name);
  }
  if (type.base === 'text' && source.kind === 'e') return true;
  return ADMITTED[type.base].includes(source.name);
}

/** Why a value could not be taken: not exact in its declared type, or in no canonical form at all. */
export type NotTaken = 'precision_lost' | 'value_unrepresentable';

export type Taken = { readonly value: CanonicalValue } | { readonly refused: NotTaken };

const NUMBER = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;
const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const TIME = /^([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]+))?$/;

/** A number's canonical text, or why it has none: integer digits and places, trailing zeros gone. */
export function number(
  text: string,
  bound: { readonly places: number; readonly digits: number | null },
): Taken {
  const match = NUMBER.exec(text);
  // NaN, Infinity and -Infinity: no canonical form of a number holds them.
  if (!match) return { refused: 'value_unrepresentable' };
  const whole = match[2]!.replace(/^0+(?=[0-9])/, '');
  const places = (match[3] ?? '').replace(/0+$/, '');
  if (places.length > bound.places) return { refused: 'precision_lost' };
  if (bound.digits !== null && (whole === '0' ? 0 : whole.length) > bound.digits) {
    return { refused: 'precision_lost' };
  }
  const zero = whole === '0' && places === '';
  return { value: `${match[1] === '-' && !zero ? '-' : ''}${whole}${places ? `.${places}` : ''}` };
}

/** A time of day's canonical text within a declared fraction: its trailing zeros gone. */
export function timeOfDay(text: string, fraction: number): Taken {
  const match = TIME.exec(text);
  if (!match) return { refused: 'value_unrepresentable' };
  // PostgreSQL's time admits 24:00:00, which no canonical time of day is.
  if (Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 59) {
    return { refused: 'value_unrepresentable' };
  }
  const places = (match[4] ?? '').replace(/0+$/, '');
  if (places.length > fraction) return { refused: 'precision_lost' };
  return { value: `${match[1]}:${match[2]}:${match[3]}${places ? `.${places}` : ''}` };
}

/** A date from year 1 to 9999: never `infinity`, a year BC or one of five digits. */
function calendarDate(text: string): Taken {
  return DATE.test(text) && text !== '0000-00-00'
    ? { value: text }
    : { refused: 'value_unrepresentable' };
}

/** A date and a time joined by a space, as ISO DateStyle prints them. */
function dateAndTime(
  text: string,
  fraction: number,
): Taken | { readonly date: string; readonly time: string } {
  const at = text.indexOf(' ');
  if (at < 0) return { refused: 'value_unrepresentable' };
  const date = calendarDate(text.slice(0, at));
  if ('refused' in date) return date;
  const time = timeOfDay(text.slice(at + 1), fraction);
  if ('refused' in time) return time;
  return { date: date.value as string, time: time.value as string };
}

/**
 * A value to its canonical form in its declared type, or why it has none (DAT-080): `precision_lost`
 * where it has more places or digits than its declaration holds, never rounded; `value_unrepresentable`
 * where no canonical form of the type holds it - a numeric's `NaN` or infinity, an infinite date or
 * timestamp, a date before year 1 or after 9999. The type was admitted first (`admits`).
 */
export function fromPostgresText(text: string, declared: ValueType): Taken {
  switch (declared.base) {
    case 'text':
      return { value: text };
    case 'boolean':
      return text === 't'
        ? { value: true }
        : text === 'f'
          ? { value: false }
          : { refused: 'value_unrepresentable' };
    case 'integer':
      return number(text, { places: 0, digits: null });
    case 'decimal':
      return number(text, { places: declared.scale, digits: declared.precision - declared.scale });
    case 'date':
      return calendarDate(text);
    case 'time':
      return timeOfDay(text, declared.fraction);
    case 'localDateTime': {
      const parts = dateAndTime(text, declared.fraction);
      return 'date' in parts ? { value: `${parts.date}T${parts.time}` } : parts;
    }
    case 'instant': {
      // In UTC, a timestamptz ends in `+00`; anything else was not read in the session's zone.
      if (!text.endsWith('+00')) return { refused: 'value_unrepresentable' };
      const parts = dateAndTime(text.slice(0, -3), declared.fraction);
      return 'date' in parts ? { value: `${parts.date}T${parts.time}Z` } : parts;
    }
  }
}
