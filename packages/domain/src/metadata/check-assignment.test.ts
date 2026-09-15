import { describe, expect, it } from 'vitest';

import { checkAssignment } from './check-assignment.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { metadataSchemaDefinitionSchema } from './schema.js';

const schemaOf = (id: string, entries: unknown[]) =>
  metadataSchemaDefinitionSchema.parse({
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id,
    name: id,
    entries,
  });

const regulatory = schemaOf('schema-reg', [
  { field: 'field-study', required: false, fixed: false },
  { field: 'field-phase', required: false, default: '1', fixed: false },
]);

describe('checkAssignment', () => {
  it('MET-009 refuses a requires naming a field the assigned schema does not group', () => {
    expect(
      checkAssignment([], {
        assignment: { schema: 'schema-reg', requires: ['field-study', 'field-stduy'] },
        schema: regulatory,
      }),
    ).toEqual([
      {
        code: 'metadata.requires',
        field: 'field-stduy',
        rule: 'requires',
        schemas: ['schema-reg'],
        detail: 'Schema schema-reg does not group this field',
      },
    ]);
  });

  it('MET-009 accepts a requires naming only fields the schema groups', () => {
    expect(
      checkAssignment([], {
        assignment: { schema: 'schema-reg', requires: ['field-study', 'field-phase'] },
        schema: regulatory,
      }),
    ).toEqual([]);
  });

  it('finds a default the candidate shares with an assigned schema and disagrees with, naming both', () => {
    const review = schemaOf('schema-review', [
      { field: 'field-phase', required: false, default: '2', fixed: false },
    ]);
    expect(
      checkAssignment([review], {
        assignment: { schema: 'schema-reg', requires: [] },
        schema: regulatory,
      }),
    ).toEqual([
      {
        code: 'metadata.defaultConflict',
        field: 'field-phase',
        rule: 'defaultConflict',
        schemas: ['schema-review', 'schema-reg'],
        detail: 'Schemas schema-review and schema-reg give this field different defaults',
      },
    ]);
  });

  it('finds no conflict where shared defaults agree, or only one schema gives one', () => {
    const agreeing = schemaOf('schema-agree', [
      { field: 'field-phase', required: true, default: '1', fixed: false },
    ]);
    const silent = schemaOf('schema-silent', [
      { field: 'field-phase', required: false, fixed: false },
    ]);
    expect(
      checkAssignment([agreeing, silent], {
        assignment: { schema: 'schema-reg', requires: [] },
        schema: regulatory,
      }),
    ).toEqual([]);
  });

  it('refuses a candidate whose assignment names a different schema from the one supplied', () => {
    expect(() =>
      checkAssignment([], {
        assignment: { schema: 'schema-other', requires: [] },
        schema: regulatory,
      }),
    ).toThrow(/schema-other/);
  });
});
