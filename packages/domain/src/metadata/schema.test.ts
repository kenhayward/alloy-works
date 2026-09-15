import { describe, expect, it } from 'vitest';

import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import { checkSchema, metadataSchemaDefinitionSchema } from './schema.js';

/** A copy of `value` without `member`, for a test that a member is required. */
const without = (value: Record<string, unknown>, member: string) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== member));

const identity = (id: string, name: string) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  id,
  name,
});

const phase = fieldDefinitionSchema.parse({
  ...identity('field-phase', 'Trial phase'),
  dataType: 'number',
  multiplicity: 'one',
  validation: { integer: true, min: '1', max: '4' },
});

const reviewers = fieldDefinitionSchema.parse({
  ...identity('field-reviewers', 'Reviewers'),
  dataType: 'user',
  multiplicity: 'many',
  maxValues: 2,
  validation: {},
});

const schemaWith = (entries: unknown[]) => ({ ...identity('schema-reg', 'Regulatory'), entries });

describe('a metadata schema definition', () => {
  it('MET-005 carries an identifier, a name and the fields it groups', () => {
    const schema = metadataSchemaDefinitionSchema.parse(
      schemaWith([{ field: 'field-phase', required: true, fixed: false }]),
    );
    expect(schema).toMatchObject({ id: 'schema-reg', name: 'Regulatory' });
    expect(() => metadataSchemaDefinitionSchema.parse({ ...schemaWith([]), name: '' })).toThrow();
  });

  it('MET-006 declares for each field whether it is required, its default, and whether it is fixed', () => {
    const entry = { field: 'field-phase', required: false, default: '2', fixed: true };
    expect(metadataSchemaDefinitionSchema.parse(schemaWith([entry])).entries).toEqual([entry]);
    for (const member of ['required', 'fixed']) {
      expect(
        () => metadataSchemaDefinitionSchema.parse(schemaWith([without(entry, member)])),
        member,
      ).toThrow();
    }
  });

  it('MET-006 refuses a fixed entry with no default to fix it at', () => {
    expect(() =>
      metadataSchemaDefinitionSchema.parse(
        schemaWith([{ field: 'field-phase', required: false, fixed: true }]),
      ),
    ).toThrow(/no default/);
  });

  it('MET-006 refuses a default that is a clear rather than a value', () => {
    for (const clear of [null, []]) {
      expect(() =>
        metadataSchemaDefinitionSchema.parse(
          schemaWith([{ field: 'field-phase', required: false, default: clear, fixed: false }]),
        ),
      ).toThrow(/clear/);
    }
  });

  it('refuses a schema grouping one field twice', () => {
    const entry = { field: 'field-phase', required: false, fixed: false };
    expect(() => metadataSchemaDefinitionSchema.parse(schemaWith([entry, entry]))).toThrow(
      /more than once/,
    );
  });

  it('MET-022 fails a default that does not pass its own field, naming the schema', () => {
    const schema = metadataSchemaDefinitionSchema.parse(
      schemaWith([
        { field: 'field-phase', required: false, default: '5', fixed: false },
        {
          field: 'field-reviewers',
          required: false,
          default: [{ user: 'user-ada' }],
          fixed: false,
        },
      ]),
    );
    expect(checkSchema(schema, [phase, reviewers])).toEqual([
      {
        code: 'metadata.default',
        field: 'field-phase',
        rule: 'default',
        schemas: ['schema-reg'],
        detail: 'The default fails max: Is above the maximum, 4',
      },
    ]);
  });

  it('MET-030 fails a default on a many field that is not a list', () => {
    const schema = metadataSchemaDefinitionSchema.parse(
      schemaWith([
        { field: 'field-reviewers', required: false, default: { user: 'user-ada' }, fixed: false },
      ]),
    );
    expect(checkSchema(schema, [phase, reviewers]).map((each) => each.detail)).toEqual([
      'The default fails multiplicity: Holds one value, and this field holds a list',
    ]);
  });
});

describe('a component type definition', () => {
  const type = (assignments: unknown[]) => ({
    ...identity('type-protocol', 'Protocol section'),
    assignments,
  });

  it('MET-010 carries an identifier, a name and zero or more assignments', () => {
    expect(componentTypeDefinitionSchema.parse(type([])).assignments).toEqual([]);
    expect(
      componentTypeDefinitionSchema.parse(
        type([{ schema: 'schema-reg', requires: ['field-phase'] }]),
      ).assignments,
    ).toHaveLength(1);
  });

  it('MET-010 carries nothing about the content a component holds', () => {
    expect(() =>
      componentTypeDefinitionSchema.parse({ ...type([]), blocks: ['paragraph'] }),
    ).toThrow();
    expect(() => componentTypeDefinitionSchema.parse({ ...type([]), content: [] })).toThrow();
  });

  it('MET-009 gives an assignment no member that could loosen, default or fix a field', () => {
    for (const member of [
      { optional: ['field-phase'] },
      { defaults: { 'field-phase': '2' } },
      { fixed: ['field-phase'] },
      { validation: {} },
    ]) {
      expect(
        () =>
          componentTypeDefinitionSchema.parse(
            type([{ schema: 'schema-reg', requires: [], ...member }]),
          ),
        JSON.stringify(member),
      ).toThrow();
    }
  });

  it('MET-010 refuses a schema assigned twice, and a field required twice by one assignment', () => {
    expect(() =>
      componentTypeDefinitionSchema.parse(
        type([
          { schema: 'schema-reg', requires: [] },
          { schema: 'schema-reg', requires: [] },
        ]),
      ),
    ).toThrow(/assigned more than once/);
    expect(() =>
      componentTypeDefinitionSchema.parse(
        type([{ schema: 'schema-reg', requires: ['field-phase', 'field-phase'] }]),
      ),
    ).toThrow(/more than once/);
  });
});
