import type { DecomposedDocument } from '@kenhayward/bridge-contract';

import { checkValue } from '../metadata/check-value.js';
import { canonicaliseDecimal, dateTimeInstant, isIsoDate, isIsoTime } from '../metadata/lexical.js';
import type { EffectiveField } from '../metadata/resolve.js';
import type { MetadataValues } from '../metadata/values.js';

import { carry, type CarryEntry } from './report.js';

/** One of CT Studio's document properties: a name, its text, and where the decomposer read it from. */
export type DecomposedProperty = DecomposedDocument['properties'][number];

/**
 * A space's property map: each CT Studio property name to the template field it fills, or `null` for
 * one the space ignores (docs/design/ct-studio-connect.md, "Properties: mapped, ignored or unlisted").
 */
export type PropertyMap = Readonly<Record<string, string | null>>;

/** The names of the properties `map` does not name, each once, in the order they were delivered. */
export function unlistedNames(
  properties: readonly DecomposedProperty[],
  map: PropertyMap,
): string[] {
  const names = new Set<string>();
  for (const property of properties) {
    if (!Object.hasOwn(map, property.name)) names.add(property.name);
  }
  return [...names];
}

/** The value a property's text makes for a field of this data type, or undefined when it is not one. */
function convert(dataType: string, raw: string): unknown {
  const text = raw.trim();
  switch (dataType) {
    case 'text':
      // Nothing to say is no value: left unset, and reported.
      return text === '' ? undefined : raw;
    case 'number':
      return canonicaliseDecimal(text);
    case 'date':
      return isIsoDate(text) ? text : undefined;
    case 'time':
      return isIsoTime(text) ? text : undefined;
    case 'dateTime':
      return dateTimeInstant(text) === undefined ? undefined : text;
    case 'boolean': {
      const word = text.toLowerCase();
      if (word === 'true' || word === 'yes') return true;
      if (word === 'false' || word === 'no') return false;
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Document properties to metadata values (docs/design/ct-studio-sink.md, "Metadata"). `map` says which
 * field (by identifier) each property name fills, or `null` for one ignored, which is passed over
 * without a word; `fields` are the template's fields. A property the map does not name is unlisted, and
 * one naming a field the template lacks is unmapped; both are reported and kept. A `user` field is
 * never filled: a name in a file is not a principal. One that does not convert to its field's type, or that the field's
 * own validation refuses, is left unset and reported; it never refuses the delivery (API-073).
 */
export function mapProperties(
  properties: readonly DecomposedProperty[],
  map: PropertyMap,
  fields: readonly EffectiveField[],
): { values: MetadataValues; carried: CarryEntry[]; unmapped: readonly DecomposedProperty[] } {
  const byId = new Map(fields.map((effective) => [effective.field.id, effective.field]));
  const values: Record<string, unknown> = {};
  const carried: CarryEntry[] = [];
  const unmapped: DecomposedProperty[] = [];

  for (const property of properties) {
    if (!Object.hasOwn(map, property.name)) {
      unmapped.push(property);
      carried.push(carry('property_unlisted', property.name));
      continue;
    }
    const fieldId = map[property.name];
    if (fieldId === null || fieldId === undefined) continue;
    const field = byId.get(fieldId);
    if (field === undefined || field.dataType === 'user') {
      unmapped.push(property);
      const detail =
        field === undefined
          ? `field ${fieldId} is not in the template`
          : `field ${fieldId} is a user field`;
      carried.push(carry('property_unmapped', property.name, detail));
      continue;
    }

    const converted = convert(field.dataType, property.value);
    if (converted === undefined) {
      carried.push(
        carry('property_unconverted', property.name, `not a ${field.dataType}: ${field.id}`),
      );
      continue;
    }

    const existing = values[field.id];
    if (field.multiplicity === 'one' && existing !== undefined) {
      carried.push(carry('property_unconverted', property.name, `${field.id} is already filled`));
      continue;
    }
    const candidate =
      field.multiplicity === 'one'
        ? converted
        : [...(Array.isArray(existing) ? existing : []), converted];
    const failures = checkValue(field, candidate);
    if (failures.length > 0) {
      const reason = failures.map((failure) => failure.detail).join('; ');
      carried.push(carry('property_unconverted', property.name, `${field.id}: ${reason}`));
      continue;
    }
    values[field.id] = candidate;
  }
  return { values, carried, unmapped };
}
