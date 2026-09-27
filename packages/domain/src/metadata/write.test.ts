import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import type { EffectiveField } from './resolve.js';
import { checkWrittenValues, writtenValues } from './write.js';

const fieldOf = (id: string, name: string, validation: object = {}) =>
  fieldDefinitionSchema.parse({
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id,
    name,
    dataType: 'text',
    multiplicity: 'one',
    validation,
  });

const effective = (
  id: string,
  name: string,
  over: Partial<Omit<EffectiveField, 'field'>> = {},
  validation: object = {},
): EffectiveField => ({
  field: fieldOf(id, name, validation),
  required: false,
  requiredBy: [],
  fixed: false,
  fixedBy: [],
  ...over,
});

const owner = effective('field-owner', 'Owner', { required: true, requiredBy: ['schema-review'] });
const status = effective('field-status', 'Status', {
  default: { value: 'draft', from: ['schema-review'] },
});
const code = effective('field-code', 'Code', {}, { maxLength: 4 });
const market = effective('field-market', 'Market', {
  fixed: true,
  fixedBy: ['schema-review'],
  default: { value: 'uk', from: ['schema-review'] },
});
const fields = [owner, status, code, market];

describe('values as they are written', () => {
  it('refuses a value for a field that does not apply, and one its field refuses, naming each', () => {
    expect(
      checkWrittenValues(fields, { 'field-audience': 'clinical', 'field-code': 'ABCDE' }).map(
        ({ field, rule }) => [field, rule],
      ),
    ).toEqual([
      ['field-audience', 'unknown'],
      ['field-code', 'maxLength'],
    ]);
  });

  it('refuses a fixed field holding another value, and takes it holding its own', () => {
    expect(checkWrittenValues(fields, { 'field-market': 'us' })).toMatchObject([
      { field: 'field-market', rule: 'fixed', schemas: ['schema-review'] },
    ]);
    expect(checkWrittenValues(fields, { 'field-market': 'uk' })).toEqual([]);
  });

  it('never refuses a required field left empty: required is checked at publication', () => {
    expect(checkWrittenValues(fields, {})).toEqual([]);
    expect(checkWrittenValues(fields, { 'field-owner': null })).toEqual([]);
  });

  it('writes what was given, with each default the given values leave without a member', () => {
    expect(writtenValues(fields, { 'field-owner': 'Ada', 'field-status': null })).toEqual({
      'field-owner': 'Ada',
      'field-status': null,
      'field-market': 'uk',
    });
  });
});
