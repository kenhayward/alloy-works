import type { Assignment } from './component-type.js';
import { failure, type MetadataFailure } from './failure.js';
import type { MetadataSchemaDefinition } from './schema.js';
import { sameValue } from './values.js';

/**
 * The comparison run before an assignment is saved (metadata.md, Resolution): every field its
 * `requires` names that the candidate schema does not group, and every default the candidate shares
 * with a schema already assigned that disagrees with it. Returns every conflict; refusing the
 * assignment is the definitions-management service's act, which is not designed.
 */
export function checkAssignment(
  assigned: readonly MetadataSchemaDefinition[],
  candidate: { readonly assignment: Assignment; readonly schema: MetadataSchemaDefinition },
): MetadataFailure[] {
  const { assignment, schema } = candidate;
  if (assignment.schema !== schema.id) {
    throw new Error(
      `The assignment names schema ${assignment.schema}, and schema ${schema.id} was supplied`,
    );
  }
  const failures: MetadataFailure[] = [];

  const grouped = new Set(schema.entries.map((entry) => entry.field));
  for (const field of assignment.requires) {
    if (!grouped.has(field)) {
      failures.push(
        failure(field, 'requires', `Schema ${schema.id} does not group this field`, [schema.id]),
      );
    }
  }

  for (const entry of schema.entries) {
    if (entry.default === undefined) continue;
    for (const other of assigned) {
      if (other.id === schema.id) continue;
      const shared = other.entries.find((each) => each.field === entry.field);
      if (shared?.default === undefined || sameValue(shared.default, entry.default)) continue;
      failures.push(
        failure(
          entry.field,
          'defaultConflict',
          `Schemas ${other.id} and ${schema.id} give this field different defaults`,
          [other.id, schema.id],
        ),
      );
    }
  }
  return failures;
}
