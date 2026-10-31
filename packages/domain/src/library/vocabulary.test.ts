import { describe, expect, it } from 'vitest';

import {
  parseVocabulary,
  valueDescription,
  valueLabel,
  valuesInOrder,
  vocabularyChangeRefusals,
  VOCABULARY_LIMITS,
  type Vocabulary,
} from './vocabulary.js';

const studyPhases: Vocabulary = {
  schemaVersion: 1,
  id: 'vocabulary-1',
  name: 'Study phase',
  key: 'study_phase',
  base: 'en',
  order: 'declared',
  values: [
    {
      id: 'phase_two',
      labels: [
        { language: 'en', text: 'Phase II' },
        { language: 'fr', text: 'Phase II (fr)' },
      ],
      descriptions: [{ language: 'en', text: 'Efficacy and side effects.' }],
      state: 'active',
    },
    {
      id: 'phase_one',
      labels: [{ language: 'en', text: 'Phase I' }],
      descriptions: [],
      state: 'active',
    },
    {
      id: 'early',
      labels: [{ language: 'en', text: 'Early' }],
      descriptions: [],
      state: 'deprecated',
      replacedBy: 'phase_one',
    },
    {
      id: 'pilot',
      labels: [{ language: 'en', text: 'Pilot' }],
      descriptions: [],
      state: 'retired',
    },
  ],
};

const problems = (value: unknown) => {
  try {
    parseVocabulary(value);
  } catch (error) {
    if (error instanceof Error && 'problems' in error) {
      return (error.problems as { path: string }[]).map((each) => each.path);
    }
    throw error;
  }
  return [];
};

const withValues = (values: Vocabulary['values']) => ({ ...studyPhases, values });

describe('a vocabulary', () => {
  it('LIB-020 is a named list of permitted values, each with a label and a stable identifier', () => {
    expect(problems(studyPhases)).toEqual([]);
    expect(parseVocabulary(studyPhases)).toEqual(studyPhases);
    // Each value has an identifier of its own, in the form an axis's value key takes.
    expect(
      problems(
        withValues([studyPhases.values[0]!, { ...studyPhases.values[1]!, id: 'phase_two' }]),
      ),
    ).toEqual(['values.1.id']);
    expect(problems(withValues([{ ...studyPhases.values[1]!, id: 'Phase-1' }]))).toEqual([
      'values.0.id',
    ]);
    expect(problems(withValues([{ ...studyPhases.values[1]!, labels: [] }]))).toContain(
      'values.0.labels',
    );
    expect(problems({ ...studyPhases, name: '' })).toEqual(['name']);
  });

  it('LIB-024 carries labels per language, falling back to its base language', () => {
    const [phaseTwo, phaseOne] = studyPhases.values;
    expect(valueLabel(studyPhases, phaseTwo!, 'fr')).toBe('Phase II (fr)');
    expect(valueLabel(studyPhases, phaseOne!, 'fr')).toBe('Phase I');
    // Every value is labelled in the base language, and each language once.
    expect(
      problems(withValues([{ ...phaseOne!, labels: [{ language: 'fr', text: 'Phase I' }] }])),
    ).toEqual(['values.0.labels']);
    expect(
      problems(
        withValues([
          {
            ...phaseOne!,
            labels: [
              { language: 'en', text: 'Phase I' },
              { language: 'en', text: 'Phase one' },
            ],
          },
        ]),
      ),
    ).toEqual(['values.0.labels.1.language']);
  });

  it('LIB-053 offers its values in its declared order, or by label, never by what the store returns', () => {
    expect(valuesInOrder(studyPhases, 'en').map((each) => each.id)).toEqual([
      'phase_two',
      'phase_one',
      'early',
      'pilot',
    ]);
    const byLabel = { ...studyPhases, order: 'label' as const };
    expect(valuesInOrder(byLabel, 'en').map((each) => each.id)).toEqual([
      'early',
      'phase_one',
      'phase_two',
      'pilot',
    ]);
    // Two values labelled alike keep one order: by identifier.
    const alike = withValues([
      { id: 'zeta', labels: [{ language: 'en', text: 'Same' }], descriptions: [], state: 'active' },
      {
        id: 'alpha',
        labels: [{ language: 'en', text: 'Same' }],
        descriptions: [],
        state: 'active',
      },
    ]);
    expect(valuesInOrder({ ...alike, order: 'label' }, 'en').map((each) => each.id)).toEqual([
      'alpha',
      'zeta',
    ]);
  });

  it('LIB-054 gives a value an optional description by language', () => {
    const [phaseTwo, phaseOne] = studyPhases.values;
    expect(valueDescription(studyPhases, phaseTwo!, 'fr')).toBe('Efficacy and side effects.');
    expect(valueDescription(studyPhases, phaseOne!, 'en')).toBeUndefined();
  });

  it('LIB-055 deprecates a value with its replacement named, before it is retired', () => {
    const [, phaseOne, early] = studyPhases.values;
    // Only a deprecated value names a replacement, and it is another value of the vocabulary.
    expect(problems(withValues([phaseOne!, { ...early!, replacedBy: 'missing' }]))).toEqual([
      'values.1.replacedBy',
    ]);
    expect(problems(withValues([phaseOne!, { ...early!, replacedBy: 'early' }]))).toEqual([
      'values.1.replacedBy',
    ]);
    expect(problems(withValues([{ ...phaseOne!, replacedBy: 'early' }, early!]))).toEqual([
      'values.0.replacedBy',
    ]);
    // Two deprecated values replacing each other are a cycle, refused at both.
    expect(
      problems(withValues([{ ...phaseOne!, state: 'deprecated', replacedBy: 'early' }, early!])),
    ).toEqual(['values.0.replacedBy', 'values.1.replacedBy']);
  });

  it('LIB-023 never drops a value: a new version keeps every identifier, retired ones too', () => {
    const next = withValues(studyPhases.values.slice(0, 3));
    expect(vocabularyChangeRefusals(studyPhases, next)).toEqual(['pilot']);
    expect(vocabularyChangeRefusals(studyPhases, studyPhases)).toEqual([]);
    expect(vocabularyChangeRefusals(undefined, next)).toEqual([]);
  });

  it(`holds at most ${VOCABULARY_LIMITS.values.toLocaleString('en')} values`, () => {
    const many = Array.from({ length: VOCABULARY_LIMITS.values + 1 }, (_, n) => ({
      id: `value_${n}`,
      labels: [{ language: 'en', text: `Value ${n}` }],
      descriptions: [],
      state: 'active' as const,
    }));
    expect(problems(withValues(many.slice(0, VOCABULARY_LIMITS.values)))).toEqual([]);
    expect(problems(withValues(many))).toEqual(['values']);
  });
});
