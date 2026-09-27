import { describe, expect, it } from 'vitest';

import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import { assignmentConflicts, brokenDefaults, nameKey, schemaConflicts } from './manage.js';
import { metadataSchemaDefinitionSchema } from './schema.js';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });
const text = (id: string, validation: object = {}) =>
  fieldDefinitionSchema.parse({
    ...identity(id),
    dataType: 'text',
    multiplicity: 'one',
    validation,
  });
const schema = (id: string, entries: object[]) =>
  metadataSchemaDefinitionSchema.parse({ ...identity(id), entries });
const entry = (field: string, value?: string) => ({
  field,
  required: false,
  fixed: false,
  ...(value === undefined ? {} : { default: value }),
});

describe('what a definition is checked against before it is written', () => {
  it('folds a name for comparison: trimmed, composed and lower-cased, and nothing else', () => {
    expect(nameKey('  Owner ')).toBe(nameKey('owner'));
    // A decomposed e with an acute accent is the composed one.
    expect(nameKey('Revie' + 'wé')).toBe(nameKey('Revie' + 'wé'));
    expect(nameKey('Owner')).not.toBe(nameKey('Owners'));
  });

  it('finds every pair of schemas a component type assigns whose defaults for a field differ', () => {
    const type = componentTypeDefinitionSchema.parse({
      ...identity('type-protocol'),
      assignments: [
        { schema: 'schema-a', requires: [] },
        { schema: 'schema-b', requires: ['field-missing'] },
      ],
    });
    const failures = assignmentConflicts(type, [
      schema('schema-a', [entry('field-status', 'draft')]),
      schema('schema-b', [entry('field-status', 'final')]),
    ]);
    expect(failures.map(({ field, rule, schemas }) => [field, rule, schemas])).toEqual([
      ['field-missing', 'requires', ['schema-b']],
      ['field-status', 'defaultConflict', ['schema-a', 'schema-b']],
    ]);
  });

  it("finds a schema version's disagreeing default at every place it is applied, by field and other schema", () => {
    const candidate = schema('schema-a', [entry('field-status', 'final'), entry('field-owner')]);
    const places = [
      {
        kind: 'componentType' as const,
        id: 'type-1',
        name: 'Protocol',
        schemas: ['schema-a', 'schema-b'],
      },
      {
        kind: 'template' as const,
        id: 'template-1',
        name: 'Report',
        level: 'section' as const,
        schemas: ['schema-b', 'schema-a'],
      },
      // Assigning only the other schema: not a place the candidate applies at.
      { kind: 'componentType' as const, id: 'type-2', name: 'Topic', schemas: ['schema-b'] },
      // Beside a schema that agrees.
      {
        kind: 'componentType' as const,
        id: 'type-3',
        name: 'Note',
        schemas: ['schema-a', 'schema-c'],
      },
    ];
    const conflicts = schemaConflicts(candidate, places, [
      schema('schema-b', [entry('field-status', 'draft')]),
      schema('schema-c', [entry('field-status', 'final')]),
    ]);
    expect(conflicts).toEqual([
      {
        field: 'field-status',
        other: 'schema-b',
        places: [
          { kind: 'componentType', id: 'type-1', name: 'Protocol' },
          { kind: 'template', id: 'template-1', name: 'Report', level: 'section' },
        ],
      },
    ]);
  });

  it("finds each schema whose default a field's next version would refuse, with the default", () => {
    const candidate = text('field-code', { maxLength: 3 });
    const broken = brokenDefaults(candidate, [
      schema('schema-a', [entry('field-code', 'ABCD')]),
      schema('schema-b', [entry('field-code', 'AB')]),
      schema('schema-c', [entry('field-other', 'ABCDEF')]),
      schema('schema-d', [entry('field-code')]),
    ]);
    expect(broken.map(({ schema: id, default: value, rule }) => [id, value, rule])).toEqual([
      ['schema-a', 'ABCD', 'maxLength'],
    ]);
  });
});
