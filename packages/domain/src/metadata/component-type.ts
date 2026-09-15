import { z } from 'zod';

import { definitionIdentity } from './definition.js';

/**
 * MET-009. An assignment names a schema and the fields it makes required, and has no other member -
 * so it cannot loosen a field, change a default or fix a value, because there is nowhere to say so.
 * That `requires` names only fields the schema groups needs the schema, so `checkAssignment` checks
 * it; resolution ignores a stray a later schema version leaves behind.
 */
export const assignmentSchema = z.strictObject({
  schema: z.string().min(1),
  requires: z.array(z.string().min(1)),
});

export type Assignment = z.infer<typeof assignmentSchema>;

/**
 * MET-010: a named, versioned, tenant-wide definition assigning zero or more schemas, and nothing
 * about content. A schema is assigned once, and a field is required by an assignment once.
 */
export const componentTypeDefinitionSchema = z
  .strictObject({ ...definitionIdentity, assignments: z.array(assignmentSchema) })
  .superRefine((type, context) => {
    const assigned = new Set<string>();
    type.assignments.forEach((assignment, index) => {
      if (assigned.has(assignment.schema)) {
        context.addIssue({
          code: 'custom',
          path: ['assignments', index, 'schema'],
          message: `Schema ${assignment.schema} is assigned more than once`,
        });
      }
      assigned.add(assignment.schema);
      if (new Set(assignment.requires).size !== assignment.requires.length) {
        context.addIssue({
          code: 'custom',
          path: ['assignments', index, 'requires'],
          message: `The assignment of ${assignment.schema} requires a field more than once`,
        });
      }
    });
  });

export type ComponentTypeDefinition = z.infer<typeof componentTypeDefinitionSchema>;
