import { failure, type MetadataFailure } from './failure.js';
import type { EffectiveField } from './resolve.js';
import { hasMember, isUserValue, type MetadataValues } from './values.js';

/** What the lookup reports of a principal it can see. Whether it is active changes nothing here. */
export type Principal = { readonly active: boolean };

/**
 * The service's lookup over this tenant's directory. Undefined means no principal this tenant can see
 * - a mistyped identifier, or another tenant's, which a tenant-scoped lookup cannot see by construction.
 *
 * Synchronous, so this package stays free of I/O: the service collects the identifiers with
 * `principalIdsIn`, loads them in one query, and passes a lookup over what it loaded.
 */
export type PrincipalLookup = (id: string) => Principal | undefined;

function userElements(
  each: EffectiveField,
  values: MetadataValues,
): { value: unknown; index: number }[] {
  if (each.field.dataType !== 'user' || !hasMember(values, each.field.id)) return [];
  const value = values[each.field.id];
  const list = each.field.multiplicity === 'many' && Array.isArray(value) ? value : [value];
  return list.map((element: unknown, index) => ({ value: element, index }));
}

/** Every distinct principal identifier the user values of effective fields name, in order. */
export function principalIdsIn(
  values: MetadataValues,
  effective: readonly EffectiveField[],
): string[] {
  const ids = new Set<string>();
  for (const each of effective) {
    for (const { value } of userElements(each, values)) {
      if (isUserValue(value)) ids.add(value.user);
    }
  }
  return [...ids];
}

/**
 * Every `user` value that names no principal of this tenant fails `metadata.user` (metadata.md, User
 * values). **An inactive principal passes**: refusing only a newly entered departed user would make one
 * value valid on one component and invalid on another (MET-004), and refusing every departed user would
 * fail a value entered before its user left.
 *
 * Not part of `validate`, which takes the field and the value and nothing else, and runs at publish from
 * recorded definitions with no directory to hand. A value that is not user-shaped is `validate`'s
 * `metadata.type` failure, and is skipped here rather than reported twice.
 */
export function checkUserValues(
  values: MetadataValues,
  effective: readonly EffectiveField[],
  principals: PrincipalLookup,
): MetadataFailure[] {
  const failures: MetadataFailure[] = [];
  for (const each of effective) {
    const many = each.field.multiplicity === 'many';
    for (const { value, index } of userElements(each, values)) {
      if (!isUserValue(value) || principals(value.user) !== undefined) continue;
      const which = many ? `Value ${index + 1} names` : 'Names';
      failures.push(failure(each.field.id, 'user', `${which} no known user`));
    }
  }
  return failures;
}
