import { describe, expect, it } from 'vitest';

import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import { resolveComponentFields } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';
import { checkUserValues, principalIdsIn, type PrincipalLookup } from './users.js';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });

const owner = fieldDefinitionSchema.parse({
  ...identity('field-owner'),
  dataType: 'user',
  multiplicity: 'one',
  validation: {},
});
const reviewers = fieldDefinitionSchema.parse({
  ...identity('field-reviewers'),
  dataType: 'user',
  multiplicity: 'many',
  validation: {},
});
const effective = resolveComponentFields(
  componentTypeDefinitionSchema.parse({
    ...identity('type-protocol'),
    assignments: [{ schema: 'schema-people', requires: [] }],
  }),
  [
    metadataSchemaDefinitionSchema.parse({
      ...identity('schema-people'),
      entries: [
        { field: 'field-owner', required: false, fixed: false },
        { field: 'field-reviewers', required: false, fixed: false },
      ],
    }),
  ],
  [owner, reviewers],
);

/** A hand-written directory: Ada is active, Grace has left, and nobody else exists here. */
const directory: PrincipalLookup = (id) =>
  ({ 'user-ada': { active: true }, 'user-grace': { active: false } })[id];

describe('checkUserValues', () => {
  it('MET-004 passes a principal of this tenant whether or not they are still active', () => {
    expect(
      checkUserValues(
        {
          'field-owner': { user: 'user-grace' },
          'field-reviewers': [{ user: 'user-ada' }, { user: 'user-grace' }],
        },
        effective,
        directory,
      ),
    ).toEqual([]);
  });

  it('MET-022 fails metadata.user for an identifier the lookup cannot see, naming the field', () => {
    expect(
      checkUserValues(
        {
          'field-owner': { user: 'user-alice' },
          'field-reviewers': [{ user: 'user-ada' }, { user: 'user-from-elsewhere' }],
        },
        effective,
        directory,
      ),
    ).toEqual([
      {
        code: 'metadata.user',
        field: 'field-owner',
        rule: 'user',
        schemas: [],
        detail: 'Names no known user',
      },
      {
        code: 'metadata.user',
        field: 'field-reviewers',
        rule: 'user',
        schemas: [],
        detail: 'Value 2 names no known user',
      },
    ]);
  });

  it('leaves a value that is not user-shaped to validate, and a clear alone', () => {
    expect(
      checkUserValues({ 'field-owner': 'user-alice', 'field-reviewers': [] }, effective, directory),
    ).toEqual([]);
    expect(checkUserValues({ 'field-owner': null }, effective, directory)).toEqual([]);
  });

  it('does not look up a user value whose field is not effective', () => {
    const asked: string[] = [];
    const recording: PrincipalLookup = (id) => {
      asked.push(id);
      return undefined;
    };
    expect(
      checkUserValues({ 'field-retired': { user: 'user-alice' } }, effective, recording),
    ).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('collects every distinct principal the values name, so the service loads them in one query', () => {
    expect(
      principalIdsIn(
        {
          'field-owner': { user: 'user-ada' },
          'field-reviewers': [{ user: 'user-grace' }, { user: 'user-ada' }, 'not-a-user'],
          'field-retired': { user: 'user-alice' },
        },
        effective,
      ),
    ).toEqual(['user-ada', 'user-grace']);
  });
});
