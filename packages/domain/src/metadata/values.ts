import { canonicalJson } from '../stored/canonical.js';

/**
 * A component's metadata values, keyed by field identifier. Typed `unknown` per member on purpose:
 * values arrive from storage, the API and imports, and whether one is the JSON its data type takes is
 * a validation failure to report (`metadata.type`), not a type error to assume away.
 *
 * **No member and a clear are different.** No member: never given a value. `null` on a field holding
 * one value, or `[]` on a field holding several: cleared, and kept as written.
 */
export type MetadataValues = Readonly<Record<string, unknown>>;

/** A `user` value: the principal's identifier, in an object so the form can grow without a rename. */
export type UserValue = { readonly user: string };

export function hasMember(values: MetadataValues, field: string): boolean {
  return Object.hasOwn(values, field) && values[field] !== undefined;
}

export function isClear(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

export function isUserValue(value: unknown): value is UserValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { user?: unknown }).user === 'string' &&
    (value as { user: string }).user.length > 0
  );
}

/** Two values are one value when their canonical serialisations are one string. */
export function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
