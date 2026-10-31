import { describe, expect, it } from 'vitest';

import { vocabularyDefinitionSchema } from '../library/vocabulary.js';
import { componentTypeDefinitionSchema } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema } from './field.js';
import { resolveComponentFields } from './resolve.js';
import { metadataSchemaDefinitionSchema } from './schema.js';
import { validate } from './validate.js';
import {
  checkVocabularyValues,
  heldVocabularyValues,
  valuesLabelled,
  vocabularyIdsIn,
  vocabularyValueWarnings,
} from './vocabulary-values.js';

const identity = (id: string) => ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id });

const phases = vocabularyDefinitionSchema.parse({
  ...identity('vocabulary-phase'),
  key: 'phase',
  base: 'en',
  order: 'declared',
  values: [
    {
      id: 'one',
      labels: [
        { language: 'en', text: 'Phase I' },
        { language: 'de', text: 'Phase eins' },
      ],
      descriptions: [],
      state: 'active',
    },
    {
      id: 'early',
      labels: [{ language: 'en', text: 'Early' }],
      descriptions: [],
      state: 'deprecated',
      replacedBy: 'one',
    },
    {
      id: 'pilot',
      labels: [{ language: 'en', text: 'Pilot' }],
      descriptions: [],
      state: 'retired',
    },
  ],
});

const phase = fieldDefinitionSchema.parse({
  ...identity('field-phase'),
  dataType: 'text',
  multiplicity: 'one',
  validation: { vocabulary: 'vocabulary-phase' },
});
const phases2 = fieldDefinitionSchema.parse({
  ...identity('field-phases'),
  dataType: 'text',
  multiplicity: 'many',
  validation: { vocabulary: 'vocabulary-phase' },
});
const note = fieldDefinitionSchema.parse({
  ...identity('field-note'),
  dataType: 'text',
  multiplicity: 'one',
  validation: {},
});
const effective = resolveComponentFields(
  componentTypeDefinitionSchema.parse({
    ...identity('type-study'),
    assignments: [{ schema: 'schema-study', requires: [] }],
  }),
  [
    metadataSchemaDefinitionSchema.parse({
      ...identity('schema-study'),
      entries: ['field-phase', 'field-phases', 'field-note'].map((field) => ({
        field,
        required: false,
        fixed: false,
      })),
    }),
  ],
  [phase, phases2, note],
);
const lookup = (id: string) => (id === phases.id ? phases : undefined);
type Values = Record<string, unknown>;
const check = (values: Values, previous: Values = {}) =>
  checkVocabularyValues(values, previous, effective, lookup).map((each) => [
    each.field,
    each.rule,
    each.detail,
  ]);

describe('values drawn from a vocabulary', () => {
  it('MET-003 lets a text field draw its permitted values from a vocabulary, refusing any other', () => {
    expect(check({ 'field-phase': 'one', 'field-note': 'anything' })).toEqual([]);
    expect(check({ 'field-phase': 'Phase I' })).toEqual([
      ['field-phase', 'vocabulary', 'Phase I is no value of the vocabulary'],
    ]);
    expect(check({ 'field-phases': ['one', 'two'] })).toEqual([
      ['field-phases', 'vocabulary', 'Value 2, two, is no value of the vocabulary'],
    ]);
    // A vocabulary that is not there refuses every value, saying so.
    expect(
      checkVocabularyValues({ 'field-phase': 'one' }, {}, effective, () => undefined).map(
        (each) => each.detail,
      ),
    ).toEqual(['The vocabulary this field draws on is not there']);
    // And the ids to load are the vocabularies the values' fields name, once each.
    expect(vocabularyIdsIn(effective)).toEqual(['vocabulary-phase']);
  });

  it('MET-032 checks against the values held, so validation needs nothing but the lookup', () => {
    // validate alone, which publishing runs, knows nothing of a vocabulary and refuses nothing here.
    expect(validate(effective, { 'field-phase': 'Phase I' })).toEqual([]);
  });

  it('LIB-023 keeps a retired value valid where it was already held, and refuses it anew', () => {
    expect(check({ 'field-phase': 'pilot' }, { 'field-phase': 'pilot' })).toEqual([]);
    expect(check({ 'field-phases': ['one', 'pilot'] }, { 'field-phases': ['pilot'] })).toEqual([]);
    expect(check({ 'field-phase': 'pilot' })).toEqual([
      ['field-phase', 'vocabulary', 'pilot is retired: choose another value'],
    ]);
    // Held by another field is not held by this one.
    expect(check({ 'field-phase': 'pilot' }, { 'field-phases': ['pilot'] })).toHaveLength(1);
  });

  it('LIB-055 accepts a deprecated value, which is still offered', () => {
    expect(check({ 'field-phase': 'early' })).toEqual([]);
  });

  it('leaves a value that is not text to validate, and a clear alone', () => {
    expect(check({ 'field-phase': 7 })).toEqual([]);
    expect(check({ 'field-phase': null })).toEqual([]);
    expect(check({})).toEqual([]);
  });
});

describe('values drawn from a vocabulary as a publish reads them', () => {
  const fields = [phase, phases2, note];

  it('lists each value held in a field drawing on a vocabulary, with its field', () => {
    expect(
      heldVocabularyValues(
        { 'field-phase': 'one', 'field-phases': ['early', 'pilot'], 'field-note': 'one' },
        fields,
      ),
    ).toEqual([
      { field: 'field-phase', vocabulary: 'vocabulary-phase', value: 'one' },
      { field: 'field-phases', vocabulary: 'vocabulary-phase', value: 'early' },
      { field: 'field-phases', vocabulary: 'vocabulary-phase', value: 'pilot' },
    ]);
  });

  it('LIB-024 prints a held value by its label in the language, the base language where it has none', () => {
    const values = { 'field-phase': 'one', 'field-phases': ['one', 'gone'], 'field-note': 'one' };
    expect(valuesLabelled(values, fields, lookup, 'de')).toEqual({
      'field-phase': 'Phase eins',
      // An id the vocabulary does not hold prints as held; a field drawing on none is untouched.
      'field-phases': ['Phase eins', 'gone'],
      'field-note': 'one',
    });
    expect(valuesLabelled(values, fields, lookup, 'fr')['field-phase']).toBe('Phase I');
    // A vocabulary not read leaves its values as held.
    expect(valuesLabelled(values, fields, () => undefined, 'de')).toEqual(values);
  });

  it('LIB-023 reports each deprecated or retired value held, with its replacement, and nothing for an active one', () => {
    const held = heldVocabularyValues({ 'field-phases': ['one', 'early', 'pilot'] }, fields);
    expect(vocabularyValueWarnings(held, 'node-1', lookup, 'en')).toEqual([
      {
        code: 'vocabulary_value',
        node: 'node-1',
        field: 'field-phases',
        value: 'early',
        label: 'Early',
        state: 'deprecated',
        replacedBy: 'one',
      },
      {
        code: 'vocabulary_value',
        node: 'node-1',
        field: 'field-phases',
        value: 'pilot',
        label: 'Pilot',
        state: 'retired',
      },
    ]);
    expect(vocabularyValueWarnings(held, null, () => undefined, 'en')).toEqual([]);
  });
});
