import { describe, expect, it } from 'vitest';

import { carryForward } from './carry.js';
import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import { canonicaliseNotCarried, canonicaliseValues, definitionsFor } from './record.js';
import { resolveComponentFields } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';
import { validate } from './validate.js';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });

const fieldOf = (id: string) =>
  fieldDefinitionSchema.parse({
    ...identity(id),
    dataType: 'text',
    multiplicity: 'one',
    validation: {},
  });

const schemaOf = (id: string, entries: unknown[]) =>
  metadataSchemaDefinitionSchema.parse({ ...identity(id), entries });

const type = componentTypeDefinitionSchema.parse({
  ...identity('type-protocol'),
  assignments: [
    { schema: 'schema-reg', requires: [] },
    { schema: 'schema-quality', requires: [] },
  ],
});

describe('definitionsFor', () => {
  const regulatory = schemaOf('schema-reg', [
    { field: 'field-study', required: true, fixed: false },
    { field: 'field-site', required: false, fixed: false },
  ]);
  const quality = schemaOf('schema-quality', [
    { field: 'field-site', required: false, fixed: false },
  ]);

  it('MET-018 names the type, each schema it assigns and each field those group, and nothing else', () => {
    expect(
      definitionsFor(
        { version: 'v-type-3', definition: type },
        [
          { version: 'v-quality-1', definition: quality },
          { version: 'v-reg-7', definition: regulatory },
          { version: 'v-unused-2', definition: schemaOf('schema-unused', []) },
        ],
        [
          { version: 'v-site-2', definition: fieldOf('field-site') },
          { version: 'v-study-5', definition: fieldOf('field-study') },
          { version: 'v-other-1', definition: fieldOf('field-other') },
        ],
      ),
    ).toEqual([
      { kind: 'componentType', id: 'type-protocol', version: 'v-type-3' },
      { kind: 'field', id: 'field-site', version: 'v-site-2' },
      { kind: 'field', id: 'field-study', version: 'v-study-5' },
      { kind: 'metadataSchema', id: 'schema-quality', version: 'v-quality-1' },
      { kind: 'metadataSchema', id: 'schema-reg', version: 'v-reg-7' },
    ]);
  });

  it('MET-017 refuses to name a definition it was not given, and one given at two versions', () => {
    expect(() => definitionsFor({ version: 't', definition: type }, [], [])).toThrow(/schema-reg/);
    expect(() =>
      definitionsFor(
        { version: 't', definition: type },
        [
          { version: 'a', definition: regulatory },
          { version: 'b', definition: regulatory },
          { version: 'c', definition: quality },
        ],
        [],
      ),
    ).toThrow(/Two versions of schema schema-reg/);
  });

  it('MET-018 asks for a field newly made required the next time the component is written', () => {
    // Written when Regulatory required nothing; Regulatory's current version requires the site.
    const stored = { 'field-study': 'S-1' };
    const current = schemaOf('schema-reg', [
      { field: 'field-study', required: true, fixed: false },
      { field: 'field-site', required: true, fixed: false },
    ]);
    const effective = resolveComponentFields(
      type,
      [current, quality],
      [fieldOf('field-study'), fieldOf('field-site')],
    );
    const next = carryForward(stored, effective);
    expect(validate(effective, next.values)).toEqual([
      expect.objectContaining({ code: 'metadata.required', field: 'field-site' }),
    ]);
  });
});

describe('the canonical form of values and of what was not carried', () => {
  it('serialises values alike whatever order their members were written in', () => {
    expect(canonicaliseValues({ 'field-b': 'Grace', 'field-a': 'Ada' })).toBe(
      canonicaliseValues({ 'field-a': 'Ada', 'field-b': 'Grace' }),
    );
    expect(canonicaliseValues({ 'field-b': 'Grace', 'field-a': 'Ada' })).toBe(
      '{"field-a":"Ada","field-b":"Grace"}',
    );
  });

  it('MET-030 keeps a many value in its order, even for a field whose identifier is marks', () => {
    expect(canonicaliseValues({ marks: ['us', 'uk'] })).toBe('{"marks":["us","uk"]}');
    expect(canonicaliseValues({ 'field-m': ['us', 'uk'] })).not.toBe(
      canonicaliseValues({ 'field-m': ['uk', 'us'] }),
    );
  });

  it('normalises text to NFC, so one value typed two ways serialises once', () => {
    expect(canonicaliseValues({ 'field-a': 'café' })).toBe(
      canonicaliseValues({ 'field-a': 'café' }),
    );
  });

  it('round-trips a decimal string a float would corrupt, byte for byte', () => {
    const values = {
      'field-dose': '0.1000000000000000055',
      'field-count': '9007199254740993',
      'field-rate': '1234567890.123456789012',
    };
    const parsed = JSON.parse(canonicaliseValues(values)) as Record<string, string>;
    expect(parsed).toEqual(values);
    for (const value of Object.values(values)) expect(String(Number(value))).not.toBe(value);
  });

  it('keeps a clear distinct from no member in the serialisation', () => {
    expect(canonicaliseValues({ 'field-a': null })).not.toBe(canonicaliseValues({}));
    expect(canonicaliseValues({ 'field-a': [] })).not.toBe(canonicaliseValues({}));
  });

  it('MET-036 serialises what was not carried by field, whatever order it was listed in', () => {
    const listed = [
      { field: 'field-b', value: 'Grace' },
      { field: 'field-a', value: ['x', 'y'] },
    ];
    expect(canonicaliseNotCarried(listed)).toBe(canonicaliseNotCarried([...listed].reverse()));
    expect(canonicaliseNotCarried(listed)).toBe(
      '[{"field":"field-a","value":["x","y"]},{"field":"field-b","value":"Grace"}]',
    );
  });
});
