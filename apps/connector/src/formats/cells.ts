import {
  canonicalJsonText,
  isJsonObject,
  JsonNumber,
  valueProblem,
  type CanonicalValue,
  type DataFailureCode,
  type JsonValue,
  type ValueType,
} from '@alloy-works/domain';

import { number, timeOfDay } from '../from-text.js';

/**
 * A JSON cell to its declared type (DAT-095, DAT-080; the D6 plan, D6-F and D6-G): a number from its
 * source text, never a double; a nested object or array as its canonical text where the column is
 * text, and `nested_value` where it is not; a date or a time from ISO 8601 text. A value with more
 * digits or places than its declaration is `precision_lost`, never rounded; one no canonical form
 * holds `value_unrepresentable`; an instant without a zone `zone_missing`; a value of the wrong JSON
 * kind `result_mismatch`.
 */

export type Cell = { readonly value: CanonicalValue } | { readonly refused: DataFailureCode };

/** A JSON number's text: sign, digits, places and an exponent, as RFC 8259 writes one. */
const JSON_NUMBER = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;
/** A decimal as text, which an API may send a decimal as to keep its places. */
const DECIMAL_TEXT = /^-?[0-9]+(?:\.[0-9]+)?$/;

/** The most an exponent may shift a number's point: past it no declared type could hold one. */
const MAX_SHIFT = 2000;

/** A JSON number's text as plain decimal digits, its exponent applied exactly, or undefined. */
export function plainDecimal(source: string): string | undefined {
  const match = JSON_NUMBER.exec(source);
  if (!match) return undefined;
  const [, sign, whole, places = '', exponent = '0'] = match;
  const shift = Number(exponent);
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > MAX_SHIFT) return undefined;
  const digits = whole! + places;
  let point = whole!.length + shift;
  let all = digits;
  if (point <= 0) {
    all = '0'.repeat(1 - point) + all;
    point = 1;
  } else if (point > all.length) {
    all = all + '0'.repeat(point - all.length);
  }
  const integer = all.slice(0, point).replace(/^0+(?=[0-9])/, '');
  const fraction = all.slice(point);
  return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
}

const LOCAL = /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)$/;
const ZONED_INSTANT =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;
const HAS_ZONE = /(?:Z|[+-][0-9]{2}:?[0-9]{2})$/;

const pad = (value: number, width: number) => String(value).padStart(width, '0');

/** An instant's text in UTC, its offset applied, or why it has none. */
function instant(text: string, fraction: number): Cell {
  const match = ZONED_INSTANT.exec(text);
  if (!match) {
    return LOCAL.test(text) ? { refused: 'zone_missing' } : { refused: 'value_unrepresentable' };
  }
  const [, year, month, day, hour, minute, second, places = '', zone] = match;
  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  // The wall time must be a real one before the offset moves it.
  if (valueProblem({ base: 'localDateTime', fraction: 6 }, local) !== null) {
    return { refused: 'value_unrepresentable' };
  }
  const kept = places.slice(1).replace(/0+$/, '');
  if (kept.length > fraction) return { refused: 'precision_lost' };
  if (zone !== 'Z' && (Number(zone!.slice(1, 3)) > 23 || Number(zone!.slice(4, 6)) > 59)) {
    return { refused: 'value_unrepresentable' };
  }
  const offset =
    zone === 'Z'
      ? 0
      : (zone!.startsWith('-') ? -1 : 1) *
        (Number(zone!.slice(1, 3)) * 60 + Number(zone!.slice(4, 6)));
  const at = new Date(0);
  at.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  at.setUTCHours(Number(hour), Number(minute) - offset, Number(second), 0);
  const utcYear = at.getUTCFullYear();
  if (utcYear < 1 || utcYear > 9999) return { refused: 'value_unrepresentable' };
  const value =
    `${pad(utcYear, 4)}-${pad(at.getUTCMonth() + 1, 2)}-${pad(at.getUTCDate(), 2)}` +
    `T${pad(at.getUTCHours(), 2)}:${pad(at.getUTCMinutes(), 2)}:${pad(at.getUTCSeconds(), 2)}` +
    `${kept ? `.${kept}` : ''}Z`;
  return { value };
}

/** Text as a value of a declared date or time base, its trailing zeros gone. */
function temporal(text: string, type: ValueType): Cell {
  switch (type.base) {
    case 'date':
      return valueProblem(type, text) === null
        ? { value: text }
        : { refused: 'value_unrepresentable' };
    case 'time': {
      if (HAS_ZONE.test(text)) return { refused: 'value_unrepresentable' };
      const taken = timeOfDay(text, type.fraction);
      return 'refused' in taken ? { refused: taken.refused } : taken;
    }
    case 'localDateTime': {
      const match = LOCAL.exec(text);
      if (!match) return { refused: 'value_unrepresentable' };
      const time = timeOfDay(match[2]!, type.fraction);
      if ('refused' in time) return { refused: time.refused };
      const value = `${match[1]}T${time.value as string}`;
      return valueProblem(type, value) === null ? { value } : { refused: 'value_unrepresentable' };
    }
    case 'instant':
      return instant(text, type.fraction);
    default:
      return { refused: 'result_mismatch' };
  }
}

/** A number's text, decimal or JSON's own, held to a declared integer or decimal. */
function numeric(text: string, type: Extract<ValueType, { base: 'integer' | 'decimal' }>): Cell {
  const plain = plainDecimal(text);
  if (plain === undefined) return { refused: 'value_unrepresentable' };
  const taken = number(
    plain,
    type.base === 'integer'
      ? { places: 0, digits: null }
      : { places: type.scale, digits: type.precision - type.scale },
  );
  return 'refused' in taken ? { refused: taken.refused } : taken;
}

/**
 * A JSON value, read at its column's pointer, to its declared type; absent, it is null. An image is
 * the caller's, which reads its base64 text.
 */
export function fromJson(value: JsonValue | undefined, type: ValueType): Cell {
  if (value === undefined || value === null) return { value: null };
  const nested = Array.isArray(value) || isJsonObject(value);
  if (nested) {
    return type.base === 'text' ? { value: canonicalJsonText(value) } : { refused: 'nested_value' };
  }
  switch (type.base) {
    case 'text':
      if (value instanceof JsonNumber) return { value: value.source };
      return { value: typeof value === 'boolean' ? String(value) : (value as string) };
    case 'boolean':
      return typeof value === 'boolean' ? { value } : { refused: 'result_mismatch' };
    case 'integer':
    case 'decimal':
      if (value instanceof JsonNumber) return numeric(value.source, type);
      return typeof value === 'string' && DECIMAL_TEXT.test(value)
        ? numeric(value, type)
        : { refused: 'result_mismatch' };
    default:
      return typeof value === 'string' ? temporal(value, type) : { refused: 'result_mismatch' };
  }
}
