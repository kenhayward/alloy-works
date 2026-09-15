import { describe, expect, it } from 'vitest';

import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import { DefinitionConflictError, resolveComponentFields } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });

const fieldOf = (id: string) =>
  fieldDefinitionSchema.parse({
    ...identity(id),
    dataType: 'text',
    multiplicity: 'one',
    validation: {},
  });

type Entry = { field: string; required: boolean; fixed: boolean; default?: unknown };

const entry = (field: string, overrides: Partial<Entry> = {}): Entry => ({
  field,
  required: false,
  fixed: false,
  ...overrides,
});

const schemaOf = (id: string, entries: Entry[]) =>
  metadataSchemaDefinitionSchema.parse({ ...identity(id), entries });

const typeOf = (assignments: { schema: string; requires: string[] }[]) =>
  componentTypeDefinitionSchema.parse({ ...identity('type-protocol'), assignments });

/** The error `run` throws. Fails the test when it throws nothing. */
const thrown = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected resolution to throw, and it did not');
};

/** One field at two versions: saved with room for the default, later tightened below it. */
const studyAt = (maxLength: number) =>
  fieldDefinitionSchema.parse({
    ...identity('field-study'),
    dataType: 'text',
    multiplicity: 'one',
    validation: { maxLength },
  });

const study = fieldOf('field-study');
const phase = fieldOf('field-phase');
const site = fieldOf('field-site');
const fields = [study, phase, site];

describe('resolveComponentFields', () => {
  it('MET-007 applies a field reached through two schemas once, required if either requires it', () => {
    const regulatory = schemaOf('schema-reg', [entry('field-study', { required: true })]);
    const review = schemaOf('schema-review', [entry('field-study')]);
    const effective = resolveComponentFields(
      typeOf([
        { schema: 'schema-review', requires: [] },
        { schema: 'schema-reg', requires: [] },
      ]),
      [regulatory, review],
      fields,
    );
    expect(effective).toHaveLength(1);
    expect(effective[0]).toMatchObject({ required: true, requiredBy: ['schema-reg'] });
  });

  it('MET-007 orders fields by assignment, then entry, at their first occurrence', () => {
    const one = schemaOf('schema-one', [entry('field-phase'), entry('field-study')]);
    const two = schemaOf('schema-two', [entry('field-site'), entry('field-phase')]);
    const effective = resolveComponentFields(
      typeOf([
        { schema: 'schema-one', requires: [] },
        { schema: 'schema-two', requires: [] },
      ]),
      [two, one],
      fields,
    );
    expect(effective.map((each) => each.field.id)).toEqual([
      'field-phase',
      'field-study',
      'field-site',
    ]);
  });

  it('MET-009 lets an assignment make an optional field required, naming the schema assigned', () => {
    const regulatory = schemaOf('schema-reg', [entry('field-study')]);
    const [effective] = resolveComponentFields(
      typeOf([{ schema: 'schema-reg', requires: ['field-study'] }]),
      [regulatory],
      fields,
    );
    expect(effective).toMatchObject({ required: true, requiredBy: ['schema-reg'] });
  });

  it('MET-009 cannot make a required field optional, change a default or unfix a value', () => {
    const regulatory = schemaOf('schema-reg', [
      entry('field-study', { required: true, fixed: true, default: 'S-1' }),
    ]);
    const [effective] = resolveComponentFields(
      typeOf([{ schema: 'schema-reg', requires: [] }]),
      [regulatory],
      fields,
    );
    expect(effective).toMatchObject({
      required: true,
      fixed: true,
      default: { value: 'S-1', from: ['schema-reg'] },
    });
  });

  it('MET-009 ignores a requires naming a field the assigned schema does not group', () => {
    const regulatory = schemaOf('schema-reg', [entry('field-study')]);
    const review = schemaOf('schema-review', [entry('field-phase')]);
    const schemas = [regulatory, review];
    const clean = resolveComponentFields(
      typeOf([
        { schema: 'schema-review', requires: [] },
        { schema: 'schema-reg', requires: [] },
      ]),
      schemas,
      fields,
    );
    const stray = resolveComponentFields(
      typeOf([
        // field-phase is already effective, through schema-review, and schema-reg does not group
        // it; field-site is grouped by nothing.
        { schema: 'schema-review', requires: [] },
        { schema: 'schema-reg', requires: ['field-phase', 'field-site'] },
      ]),
      schemas,
      fields,
    );
    expect(stray).toEqual(clean);
  });

  it('MET-013 takes the type and its definitions and nothing about any document', () => {
    expect(resolveComponentFields.length).toBe(3);
    const regulatory = schemaOf('schema-reg', [entry('field-study', { required: true })]);
    const type = typeOf([{ schema: 'schema-reg', requires: [] }]);
    // Two documents made from different templates reference one component: they ask the same question.
    expect(resolveComponentFields(type, [regulatory], fields)).toEqual(
      resolveComponentFields(type, [regulatory], fields),
    );
  });

  it('MET-010 resolves a type assigning no schema to no fields', () => {
    expect(resolveComponentFields(typeOf([]), [], fields)).toEqual([]);
  });

  it('throws on disagreeing defaults, naming the field and every schema, rather than picking one', () => {
    const one = schemaOf('schema-one', [entry('field-phase', { default: '1' })]);
    const two = schemaOf('schema-two', [entry('field-phase', { default: '2' })]);
    const type = typeOf([
      { schema: 'schema-one', requires: [] },
      { schema: 'schema-two', requires: [] },
    ]);
    expect(() => resolveComponentFields(type, [one, two], fields)).toThrow(DefinitionConflictError);
    try {
      resolveComponentFields(type, [one, two], fields);
    } catch (error) {
      expect(error).toMatchObject({
        field: 'field-phase',
        schemas: ['schema-one', 'schema-two'],
        rule: 'defaultConflict',
      });
      expect((error as Error).message).toBe(
        'Field field-phase has different defaults in schemas schema-one and schema-two',
      );
    }
  });

  it('MET-006 accepts two schemas giving one default, and names both', () => {
    const one = schemaOf('schema-one', [entry('field-phase', { default: '1' })]);
    const two = schemaOf('schema-two', [entry('field-phase', { default: '1' })]);
    const [effective] = resolveComponentFields(
      typeOf([
        { schema: 'schema-one', requires: [] },
        { schema: 'schema-two', requires: [] },
      ]),
      [one, two],
      fields,
    );
    expect(effective?.default).toEqual({ value: '1', from: ['schema-one', 'schema-two'] });
  });

  it('throws on a default its field version refuses, naming the field, the schemas and the rule', () => {
    const fixing = schemaOf('schema-reg', [
      entry('field-study', { default: 'S-123', fixed: true }),
    ]);
    const giving = schemaOf('schema-quality', [entry('field-study', { default: 'S-123' })]);
    const type = typeOf([
      { schema: 'schema-reg', requires: [] },
      { schema: 'schema-quality', requires: [] },
    ]);
    const error = thrown(() => resolveComponentFields(type, [fixing, giving], [studyAt(3)]));
    expect(error).toBeInstanceOf(DefinitionConflictError);
    expect(error).toMatchObject({
      field: 'field-study',
      schemas: ['schema-reg', 'schema-quality'],
      rule: 'maxLength',
    });
    expect((error as Error).message).toBe(
      'Field field-study refuses the default in schemas schema-reg and schema-quality: maxLength, Is longer than 3 characters',
    );
  });

  it('MET-017 resolves the same default under the field version it was saved against', () => {
    const fixing = schemaOf('schema-reg', [
      entry('field-study', { default: 'S-123', fixed: true }),
    ]);
    const [effective] = resolveComponentFields(
      typeOf([{ schema: 'schema-reg', requires: [] }]),
      [fixing],
      [studyAt(10)],
    );
    expect(effective).toMatchObject({
      fixed: true,
      default: { value: 'S-123', from: ['schema-reg'] },
    });
  });

  it('MET-017 refuses to resolve from definitions it was not given, naming what is missing', () => {
    const regulatory = schemaOf('schema-reg', [entry('field-study')]);
    expect(() =>
      resolveComponentFields(typeOf([{ schema: 'schema-reg', requires: [] }]), [], fields),
    ).toThrow(/schema-reg/);
    expect(() =>
      resolveComponentFields(typeOf([{ schema: 'schema-reg', requires: [] }]), [regulatory], []),
    ).toThrow(/field-study/);
  });

  it('MET-007 and MET-009 resolve every combination of required, fixed and default across two schemas', () => {
    const options: Omit<Entry, 'field'>[] = [];
    for (const required of [false, true]) {
      for (const fixed of [false, true]) {
        for (const value of [undefined, 'x', 'y']) {
          if (fixed && value === undefined) continue;
          options.push({ required, fixed, ...(value === undefined ? {} : { default: value }) });
        }
      }
    }
    let cases = 0;
    for (const a of options) {
      for (const b of options) {
        for (const requiresA of [false, true]) {
          for (const requiresB of [false, true]) {
            cases += 1;
            const label = JSON.stringify({ a, b, requiresA, requiresB });
            const schemas = [
              schemaOf('schema-a', [{ field: 'field-phase', ...a }]),
              schemaOf('schema-b', [{ field: 'field-phase', ...b }]),
            ];
            const type = typeOf([
              { schema: 'schema-a', requires: requiresA ? ['field-phase'] : [] },
              { schema: 'schema-b', requires: requiresB ? ['field-phase'] : [] },
            ]);
            const defaults = [
              ...(a.default === undefined ? [] : [{ value: a.default, schema: 'schema-a' }]),
              ...(b.default === undefined ? [] : [{ value: b.default, schema: 'schema-b' }]),
            ];
            if (defaults.length === 2 && a.default !== b.default) {
              expect(() => resolveComponentFields(type, schemas, fields), label).toThrow(
                DefinitionConflictError,
              );
              continue;
            }
            const effective = resolveComponentFields(type, schemas, fields);
            expect(effective, label).toHaveLength(1);
            const requiredBy = [
              ...(a.required || requiresA ? ['schema-a'] : []),
              ...(b.required || requiresB ? ['schema-b'] : []),
            ];
            const fixedBy = [...(a.fixed ? ['schema-a'] : []), ...(b.fixed ? ['schema-b'] : [])];
            expect(effective[0], label).toEqual({
              field: phase,
              required: requiredBy.length > 0,
              requiredBy,
              fixed: fixedBy.length > 0,
              fixedBy,
              ...(defaults[0] === undefined
                ? {}
                : {
                    default: {
                      value: defaults[0].value,
                      from: defaults.map((each) => each.schema),
                    },
                  }),
            });
          }
        }
      }
    }
    expect(cases).toBe(400);
  });
});
