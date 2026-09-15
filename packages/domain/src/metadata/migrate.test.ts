import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { dataTypes, fieldDefinitionSchema } from './field.js';
import { migrateDefinition, readDefinition, type DefinitionKind } from './migrate.js';
import { checkSchema, metadataSchemaDefinitionSchema } from './schema.js';

const fixtures = join(import.meta.dirname, 'fixtures');

/** A fixture file holds every stored payload of one kind at one version. The name says which kind. */
const kindOf: Record<string, DefinitionKind> = {
  'fields.json': 'field',
  'metadata-schemas.json': 'metadataSchema',
  'component-types.json': 'componentType',
};

const load = (version: string, name: string): unknown[] =>
  JSON.parse(readFileSync(join(fixtures, version, name), 'utf8')) as unknown[];

describe('definition schema versions and migration', () => {
  it('MET-002 reads every definition fixture of every definition schema version at the current one', () => {
    const versions = readdirSync(fixtures);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      const names = readdirSync(join(fixtures, version));
      expect(names.sort(), version).toEqual(Object.keys(kindOf).sort());
      for (const name of names) {
        const kind = kindOf[name];
        if (!kind) throw new Error(`${version}/${name} names no definition kind`);
        for (const [index, stored] of load(version, name).entries()) {
          const outcome = readDefinition(kind, stored, { artifact: name, version });
          expect(outcome, `${version}/${name}[${index}]`).toMatchObject({ ok: true });
          expect(migrateDefinition(kind, stored).schemaVersion).toBe(DEFINITION_SCHEMA_VERSION);
        }
      }
    }
  });

  it('MET-002 keeps a field fixture carrying every data type, multiplicity and validation member', () => {
    // As content's every-node fixture: the fixture earns its purpose only while something checks it.
    const fields = load('v1', 'fields.json') as {
      dataType: string;
      multiplicity: string;
      maxValues?: number;
      validation: Record<string, unknown>;
    }[];
    const found = new Set<string>();
    for (const field of fields) {
      found.add(field.dataType);
      found.add(field.multiplicity);
      if (field.maxValues !== undefined) found.add('maxValues');
      for (const member of Object.keys(field.validation)) found.add(`${field.dataType}.${member}`);
    }
    const missing = [
      ...dataTypes,
      'one',
      'many',
      'maxValues',
      'text.minLength',
      'text.maxLength',
      'number.min',
      'number.max',
      'number.integer',
      'number.scale',
      'date.min',
      'date.max',
      'time.min',
      'time.max',
      'dateTime.min',
      'dateTime.max',
    ].filter((each) => !found.has(each));
    expect(missing).toEqual([]);
  });

  it('MET-010 keeps a component type fixture with no assignments, since zero is allowed', () => {
    const types = load('v1', 'component-types.json') as { assignments: unknown[] }[];
    expect(types.some((type) => type.assignments.length === 0)).toBe(true);
  });

  it('MET-006 keeps schema fixtures whose every default passes its own field', () => {
    const fields = load('v1', 'fields.json').map((each) => fieldDefinitionSchema.parse(each));
    for (const stored of load('v1', 'metadata-schemas.json')) {
      const schema = metadataSchemaDefinitionSchema.parse(stored);
      expect(checkSchema(schema, fields), schema.id).toEqual([]);
    }
  });

  it('MET-002 refuses a definition schema version it has no path from, by number', () => {
    expect(() => migrateDefinition('field', { schemaVersion: 99 })).toThrow(/99/);
  });

  it('MET-002 refuses a definition that records no definition schema version', () => {
    expect(() => migrateDefinition('metadataSchema', { id: 'schema-reg' })).toThrow(
      /metadata schema definition records no schema version/,
    );
  });

  it('MET-017 reports a stored definition that will not parse, with its artifact and version, and yields nothing', () => {
    const outcome = readDefinition(
      'field',
      { schemaVersion: 1, id: 'field-x', name: 'X', dataType: 'colour', multiplicity: 'one' },
      { artifact: 'field-x', version: '7' },
    );
    expect(outcome).toMatchObject({ ok: false, artifact: 'field-x', version: '7' });
    expect(outcome).not.toHaveProperty('definition');
  });
});
