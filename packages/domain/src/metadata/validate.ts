import { checkValue } from './check-value.js';
import { failure, type MetadataFailure } from './failure.js';
import type { EffectiveField } from './resolve.js';
import { hasMember, isClear, sameValue, type MetadataValues } from './values.js';

/**
 * Every failure of `values` against `effective`, never the first (metadata.md, Validation).
 *
 * Two rules come from schemas and name every schema that imposed them: `required` - no member, `null`
 * or `[]` - and `fixed` - a value that differs from the default, a clear included. Every other rule is
 * the field's own, through `checkValue`, and names no schema (MET-004).
 *
 * A value whose field is not effective is not a failure: it is a value carrying forward will not
 * carry, and the caller shows it as that (MET-036).
 *
 * Takes the effective fields it is given. Checking a stored version resolves them from the definition
 * versions that version recorded, never the current ones (MET-017).
 */
export function validate(
  effective: readonly EffectiveField[],
  values: MetadataValues,
): MetadataFailure[] {
  const failures: MetadataFailure[] = [];
  for (const each of effective) {
    const id = each.field.id;
    const present = hasMember(values, id);
    const value = values[id];
    if (each.required && (!present || isClear(value))) {
      failures.push(failure(id, 'required', `${each.field.name} is required`, each.requiredBy));
    }
    if (present && each.fixed && each.default && !sameValue(value, each.default.value)) {
      failures.push(
        failure(id, 'fixed', `${each.field.name} is fixed, and holds another value`, each.fixedBy),
      );
    }
    if (present) failures.push(...checkValue(each.field, value));
  }
  return failures;
}
