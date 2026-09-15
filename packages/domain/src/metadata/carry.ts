import type { EffectiveField } from './resolve.js';
import { hasMember, isClear, type MetadataValues } from './values.js';

/** A value the next version does not carry, by field, which the version records in full (MET-036). */
export type NotCarried = { readonly field: string; readonly value: unknown };

export type CarriedForward = {
  readonly values: MetadataValues;
  /** Sorted by field identifier, in the order canonical serialisation sorts members. */
  readonly notCarried: readonly NotCarried[];
};

/**
 * What the next version holds (metadata.md, Carrying forward). **It never changes a value that is
 * present.**
 *
 * - Present, and its field is effective: carried unchanged, even if it is now invalid.
 * - Present, and its field is not effective: in `notCarried`.
 * - A clear for a field that is not effective: dropped, since it holds nothing to record.
 * - No member, and the field has a default: takes the default. This is how a fixed field is filled.
 * - No member, and no default: stays without one.
 *
 * A present value on a fixed field that differs from its default is not replaced. Replacing it would
 * turn a write that should have been refused into a silent change; it stays, and `validate` names it.
 */
export function carryForward(
  values: MetadataValues,
  effective: readonly EffectiveField[],
): CarriedForward {
  const effectiveIds = new Set(effective.map((each) => each.field.id));
  const carried: [string, unknown][] = [];
  const notCarried: NotCarried[] = [];

  for (const [field, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (effectiveIds.has(field)) carried.push([field, value]);
    else if (!isClear(value)) notCarried.push({ field, value });
  }
  for (const each of effective) {
    if (!hasMember(values, each.field.id) && each.default) {
      carried.push([each.field.id, structuredCopy(each.default.value)]);
    }
  }

  notCarried.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
  // `Object.fromEntries` defines each member, so a field whose identifier is `__proto__` is a member
  // like any other rather than a prototype assignment.
  return { values: Object.fromEntries(carried), notCarried };
}

/** A default is copied, so a caller mutating the values it was handed cannot change a definition. */
function structuredCopy(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
