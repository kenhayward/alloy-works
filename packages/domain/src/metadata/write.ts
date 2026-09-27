import { carryForward } from './carry.js';
import { checkValue } from './check-value.js';
import { failure, type MetadataFailure } from './failure.js';
import type { EffectiveField } from './resolve.js';
import { hasMember, sameValue, type MetadataValues } from './values.js';

/**
 * Every failure of values as they are written (templates.md, "Values"): a value for a field that does
 * not apply at this level (`unknown`), a fixed field holding another value than its own, and whatever
 * the field itself refuses (MET-004). **Required is not checked**: an author fills a document in over
 * time, and a missing value fails the publication (TPL-055), not the write.
 */
export function checkWrittenValues(
  effective: readonly EffectiveField[],
  values: MetadataValues,
): MetadataFailure[] {
  const byId = new Map(effective.map((each) => [each.field.id, each]));
  const failures: MetadataFailure[] = [];
  for (const id of Object.keys(values).sort()) {
    if (!hasMember(values, id)) continue;
    const each = byId.get(id);
    if (each === undefined) {
      failures.push(failure(id, 'unknown', 'No field by this identifier applies here'));
      continue;
    }
    const value = values[id];
    if (each.fixed && each.default && !sameValue(value, each.default.value)) {
      failures.push(
        failure(id, 'fixed', `${each.field.name} is fixed, and holds another value`, each.fixedBy),
      );
    }
    failures.push(...checkValue(each.field, value));
  }
  return failures;
}

/**
 * What is stored for values written whole and checked: the values given, and the default of each field
 * they leave without a member, as `carryForward` fills a component's - so a fixed field keeps its value
 * however it is written, and a field is emptied by writing its clear rather than by leaving it out.
 */
export function writtenValues(
  effective: readonly EffectiveField[],
  values: MetadataValues,
): MetadataValues {
  return carryForward(values, effective).values;
}
