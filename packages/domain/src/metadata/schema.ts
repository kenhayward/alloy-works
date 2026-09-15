import { z } from 'zod';

import { checkValue } from './check-value.js';
import { definitionIdentity } from './definition.js';
import { failure, type MetadataFailure } from './failure.js';
import type { FieldDefinition } from './field.js';
import { isClear } from './values.js';

/** MET-006: for each field a schema groups, whether it is required, its default, and whether it is fixed. */
export const schemaEntrySchema = z.strictObject({
  field: z.string().min(1),
  required: z.boolean(),
  default: z.unknown().optional(),
  fixed: z.boolean(),
});

export type SchemaEntry = z.infer<typeof schemaEntrySchema>;

/**
 * MET-005: a named, versioned, tenant-wide definition grouping fields. The version is the artifact
 * row's, by the one mechanism (ADR-0024); the payload records only its definition schema version.
 *
 * Three rules the entries' shape cannot state alone. A field is grouped once. A fixed entry has a
 * default, since a fixed value is taken from it. And a default is a value rather than a clear: a
 * default of `null` or `[]` would satisfy "a fixed entry has a default" while fixing nothing, and
 * carrying forward would write a clear nobody made into a field with no member.
 */
export const metadataSchemaDefinitionSchema = z
  .strictObject({ ...definitionIdentity, entries: z.array(schemaEntrySchema) })
  .superRefine((schema, context) => {
    const seen = new Set<string>();
    schema.entries.forEach((entry, index) => {
      if (seen.has(entry.field)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'field'],
          message: `Field ${entry.field} is grouped more than once`,
        });
      }
      seen.add(entry.field);
      if (entry.fixed && entry.default === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'default'],
          message: `Field ${entry.field} is fixed and has no default to fix it at`,
        });
      }
      if (entry.default !== undefined && isClear(entry.default)) {
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'default'],
          message: `Field ${entry.field} has a clear as its default, and a default must be a value`,
        });
      }
    });
  });

export type MetadataSchemaDefinition = z.infer<typeof metadataSchemaDefinitionSchema>;

/**
 * A default must itself pass `checkValue` for its field (metadata.md, Definitions) - which needs the
 * field, so it is a check over definitions rather than part of the schema's shape. Each failure names
 * the schema, since the default is the schema's.
 */
export function checkSchema(
  schema: MetadataSchemaDefinition,
  fields: readonly FieldDefinition[],
): MetadataFailure[] {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const failures: MetadataFailure[] = [];
  for (const entry of schema.entries) {
    const field = byId.get(entry.field);
    if (!field) {
      throw new Error(`Schema ${schema.id} groups field ${entry.field}, which was not supplied`);
    }
    if (entry.default === undefined) continue;
    for (const each of checkValue(field, entry.default)) {
      failures.push(
        failure(field.id, 'default', `The default fails ${each.rule}: ${each.detail}`, [schema.id]),
      );
    }
  }
  return failures;
}
