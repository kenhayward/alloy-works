import { describe, expect, it } from 'vitest';

import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema, type FieldDefinition } from './field.js';
import { resolveComponentFields } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';
import { validate } from './validate.js';

/** A copy of `value` without `member`, for a test that a member is required. */
const without = (value: Record<string, unknown>, member: string) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== member));

const identity = (id: string, name = id) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  id,
  name,
});

const fieldOf = (
  id: string,
  name: string,
  shape: Record<string, unknown> = { dataType: 'text', multiplicity: 'one', validation: {} },
): FieldDefinition => fieldDefinitionSchema.parse({ ...identity(id, name), ...shape });

const study = fieldOf('field-study', 'Study number', {
  dataType: 'text',
  multiplicity: 'one',
  validation: { maxLength: 8 },
});
const sites = fieldOf('field-sites', 'Sites', {
  dataType: 'text',
  multiplicity: 'many',
  maxValues: 2,
  validation: {},
});
const controlled = fieldOf('field-controlled', 'Controlled', {
  dataType: 'boolean',
  multiplicity: 'one',
  validation: {},
});
const markets = fieldOf('field-markets', 'Markets', {
  dataType: 'text',
  multiplicity: 'many',
  validation: {},
});
const fields = [study, sites, controlled, markets];

const schemaOf = (id: string, entries: unknown[]) =>
  metadataSchemaDefinitionSchema.parse({ ...identity(id), entries });

const typeOf = (assignments: { schema: string; requires: string[] }[]) =>
  componentTypeDefinitionSchema.parse({ ...identity('type-protocol'), assignments });

const regulatory = schemaOf('schema-reg', [
  { field: 'field-study', required: true, fixed: false },
  { field: 'field-controlled', required: false, default: true, fixed: true },
  { field: 'field-markets', required: false, default: ['uk', 'us'], fixed: true },
]);
const quality = schemaOf('schema-quality', [
  { field: 'field-study', required: false, fixed: false },
  { field: 'field-sites', required: false, fixed: false },
  { field: 'field-controlled', required: true, default: true, fixed: true },
]);

const effective = resolveComponentFields(
  typeOf([
    { schema: 'schema-reg', requires: [] },
    { schema: 'schema-quality', requires: ['field-study', 'field-sites'] },
  ]),
  [regulatory, quality],
  fields,
);

const valid = {
  'field-study': 'S-1',
  'field-sites': ['Leeds'],
  'field-controlled': true,
  'field-markets': ['uk', 'us'],
};

const codes = (values: Record<string, unknown>) => validate(effective, values).map((f) => f.code);

describe('validate', () => {
  it('passes a set of values that breaks no rule', () => {
    expect(validate(effective, valid)).toEqual([]);
  });

  it('MET-022 fails required for no member, naming every schema that requires the field', () => {
    expect(validate(effective, without(valid, 'field-study'))).toEqual([
      {
        code: 'metadata.required',
        field: 'field-study',
        rule: 'required',
        schemas: ['schema-reg', 'schema-quality'],
        detail: 'Study number is required',
      },
    ]);
  });

  it('MET-022 fails required for a clear: null on a one field and an empty list on a many field', () => {
    expect(codes({ ...valid, 'field-study': null })).toEqual(['metadata.required']);
    expect(codes({ ...valid, 'field-sites': [] })).toEqual(['metadata.required']);
  });

  it('MET-009 names the schema assigned when an assignment imposed the requirement', () => {
    expect(validate(effective, without(valid, 'field-sites'))).toEqual([
      expect.objectContaining({ code: 'metadata.required', schemas: ['schema-quality'] }),
    ]);
  });

  it('MET-030 makes required mean at least one value on a many field', () => {
    expect(codes({ ...valid, 'field-sites': ['Leeds'] })).toEqual([]);
    expect(codes({ ...valid, 'field-sites': [] })).toEqual(['metadata.required']);
  });

  it('MET-022 fails fixed for a value other than the default, naming every schema that fixes the field', () => {
    expect(validate(effective, { ...valid, 'field-controlled': false })).toEqual([
      {
        code: 'metadata.fixed',
        field: 'field-controlled',
        rule: 'fixed',
        schemas: ['schema-reg', 'schema-quality'],
        detail: 'Controlled is fixed, and holds another value',
      },
    ]);
  });

  it('fails fixed for a clear on a fixed field, null and an empty list alike', () => {
    expect(codes({ ...valid, 'field-controlled': null })).toEqual([
      'metadata.required',
      'metadata.fixed',
    ]);
    expect(codes({ ...valid, 'field-markets': [] })).toEqual(['metadata.fixed']);
  });

  it('MET-030 fails fixed for the default values in another order, since order is part of the value', () => {
    expect(codes({ ...valid, 'field-markets': ['us', 'uk'] })).toEqual(['metadata.fixed']);
  });

  it('does not fail fixed for no member, which carrying forward fills', () => {
    expect(codes(without(valid, 'field-markets'))).toEqual([]);
  });

  it('MET-004 applies the field rules through validate, naming no schema for them', () => {
    const failures = validate(effective, {
      ...valid,
      'field-study': 'S-123456789',
      'field-sites': ['Leeds', 'York', 'Leeds'],
      'field-controlled': 'yes',
    });
    expect(failures.map((f) => [f.code, f.schemas])).toEqual([
      // In resolution order: Regulatory's study and controlled, then Quality's sites.
      ['metadata.maxLength', []],
      ['metadata.fixed', ['schema-reg', 'schema-quality']],
      ['metadata.type', []],
      ['metadata.maxValues', []],
      ['metadata.multiplicity', []],
    ]);
  });

  it('returns every failure, not the first', () => {
    expect(codes({})).toEqual(['metadata.required', 'metadata.required', 'metadata.required']);
  });

  it('does not fail a value whose field is not effective', () => {
    expect(codes({ ...valid, 'field-retired': 42 })).toEqual([]);
  });

  it('MET-017 validates against the definition versions it is given, not the current ones', () => {
    // The version was written when Regulatory required nothing; Regulatory has since required sites.
    const recorded = schemaOf('schema-reg', [
      { field: 'field-sites', required: false, fixed: false },
    ]);
    const current = schemaOf('schema-reg', [
      { field: 'field-sites', required: true, fixed: false },
    ]);
    const type = typeOf([{ schema: 'schema-reg', requires: [] }]);
    const stored = {};
    expect(validate(resolveComponentFields(type, [recorded], fields), stored)).toEqual([]);
    expect(
      validate(resolveComponentFields(type, [current], fields), stored).map((f) => f.code),
    ).toEqual(['metadata.required']);
  });
});
