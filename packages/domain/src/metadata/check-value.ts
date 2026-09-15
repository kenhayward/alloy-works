import { failure, type MetadataFailure } from './failure.js';
import type { FieldDefinition } from './field.js';
import {
  compareDecimal,
  dateTimeInstant,
  decimalScale,
  isCanonicalDecimal,
  isIsoDate,
  isIsoTime,
  timeKey,
} from './lexical.js';
import { isUserValue } from './values.js';

/**
 * MET-004: whether a value is valid for a field, from the field and the value and nothing else. No
 * artifact, no schema, no directory, no clock - so there is no context that could make one value
 * valid in one place and invalid in another.
 *
 * Returns every failure, never the first. A clear - `null` on a field holding one value, `[]` on a
 * field holding several - is not a failure here; whether a field may be clear is `required`'s, which
 * a schema imposes and `validate` checks.
 */
export function checkValue(field: FieldDefinition, value: unknown): MetadataFailure[] {
  if (field.multiplicity === 'one') {
    // Not `isClear`: an empty list on a one field is not a clear here, it is the multiplicity
    // failure below - only `null` clears a field that holds one value.
    if (value === null) return [];
    if (Array.isArray(value)) {
      return [failure(field.id, 'multiplicity', 'Holds a list, and this field holds one value')];
    }
    return checkElement(field, value);
  }

  if (!Array.isArray(value)) {
    return [failure(field.id, 'multiplicity', 'Holds one value, and this field holds a list')];
  }
  const failures: MetadataFailure[] = [];
  if (field.maxValues !== undefined && value.length > field.maxValues) {
    failures.push(
      failure(
        field.id,
        'maxValues',
        `Holds ${value.length} values, and this field holds at most ${field.maxValues}`,
      ),
    );
  }
  const seen = new Map<string, number>();
  value.forEach((element: unknown, index) => {
    const own = checkElement(field, element);
    failures.push(
      ...own.map((each) => ({ ...each, detail: `Value ${index + 1}: ${each.detail}` })),
    );
    if (own.some((each) => each.rule === 'type')) return;
    // MET-030: no value twice, after normalisation - so `café` spelled two ways, `09:00` and
    // `09:00:00`, and one instant at two offsets are each one value.
    const key = elementKey(field, element);
    const first = seen.get(key);
    if (first === undefined) seen.set(key, index);
    else {
      failures.push(
        failure(field.id, 'multiplicity', `Value ${index + 1} repeats value ${first + 1}`),
      );
    }
  });
  return failures;
}

function typeFailure(field: FieldDefinition, expected: string): MetadataFailure {
  return failure(field.id, 'type', `Is not ${expected}`);
}

function checkElement(field: FieldDefinition, value: unknown): MetadataFailure[] {
  switch (field.dataType) {
    case 'text': {
      if (typeof value !== 'string') return [typeFailure(field, 'text')];
      // Counted in code points of the NFC form, so a length does not depend on how the text was typed.
      const length = [...value.normalize('NFC')].length;
      const failures: MetadataFailure[] = [];
      const { minLength, maxLength } = field.validation;
      if (minLength !== undefined && length < minLength) {
        failures.push(failure(field.id, 'minLength', `Is shorter than ${minLength} characters`));
      }
      if (maxLength !== undefined && length > maxLength) {
        failures.push(failure(field.id, 'maxLength', `Is longer than ${maxLength} characters`));
      }
      return failures;
    }
    case 'number': {
      if (typeof value !== 'string' || !isCanonicalDecimal(value)) {
        return [
          typeFailure(field, 'a decimal written as a string, with no leading or trailing zeros'),
        ];
      }
      const failures = checkRange(field.id, value, field.validation, compareDecimal);
      if (field.validation.integer === true && value.includes('.')) {
        failures.push(failure(field.id, 'integer', 'Is not a whole number'));
      }
      const { scale } = field.validation;
      if (scale !== undefined && decimalScale(value) > scale) {
        failures.push(failure(field.id, 'scale', `Has more than ${scale} decimal places`));
      }
      return failures;
    }
    case 'date':
      if (typeof value !== 'string' || !isIsoDate(value)) {
        return [typeFailure(field, 'a date written YYYY-MM-DD, with no offset')];
      }
      return checkRange(field.id, value, field.validation, compareStrings);
    case 'time':
      if (typeof value !== 'string' || !isIsoTime(value)) {
        return [typeFailure(field, 'a time written HH:MM or HH:MM:SS, with no offset')];
      }
      return checkRange(field.id, value, field.validation, (a, b) =>
        compareStrings(timeKey(a), timeKey(b)),
      );
    case 'dateTime':
      if (typeof value !== 'string' || dateTimeInstant(value) === undefined) {
        return [typeFailure(field, 'a date and time with its offset from UTC')];
      }
      return checkRange(field.id, value, field.validation, compareInstants);
    case 'boolean':
      return typeof value === 'boolean' ? [] : [typeFailure(field, 'true or false')];
    case 'user':
      return isUserValue(value) ? [] : [typeFailure(field, 'a user')];
  }
}

function elementKey(field: FieldDefinition, value: unknown): string {
  switch (field.dataType) {
    case 'text':
      return (value as string).normalize('NFC');
    case 'time':
      return timeKey(value as string);
    case 'dateTime':
      return String(dateTimeInstant(value as string));
    case 'user':
      return (value as { user: string }).user;
    default:
      return String(value);
  }
}

const compareStrings = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);

const compareInstants = (a: string, b: string) => {
  const difference = (dateTimeInstant(a) ?? 0n) - (dateTimeInstant(b) ?? 0n);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
};

function checkRange(
  field: string,
  value: string,
  bounds: { readonly min?: string | undefined; readonly max?: string | undefined },
  compare: (a: string, b: string) => number,
): MetadataFailure[] {
  const failures: MetadataFailure[] = [];
  if (bounds.min !== undefined && compare(value, bounds.min) < 0) {
    failures.push(failure(field, 'min', `Is below the minimum, ${bounds.min}`));
  }
  if (bounds.max !== undefined && compare(value, bounds.max) > 0) {
    failures.push(failure(field, 'max', `Is above the maximum, ${bounds.max}`));
  }
  return failures;
}
