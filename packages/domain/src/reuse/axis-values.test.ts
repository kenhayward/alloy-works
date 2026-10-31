import { describe, expect, it } from 'vitest';

import { vocabularyDefinitionSchema } from '../library/vocabulary.js';
import { axisValues, conditionAxisDefinitionSchema } from './conditions.js';

const VOCABULARY = '00000000-0000-4000-8000-00000000d001';

const phases = vocabularyDefinitionSchema.parse({
  schemaVersion: 1,
  id: VOCABULARY,
  name: 'Phases',
  key: 'phase',
  base: 'en',
  order: 'label',
  values: [
    {
      id: 'two',
      labels: [
        { language: 'en', text: 'Phase II' },
        { language: 'fr', text: 'Phase deux' },
      ],
      descriptions: [],
      state: 'active',
    },
    {
      id: 'early',
      labels: [{ language: 'en', text: 'Early' }],
      descriptions: [],
      state: 'deprecated',
      replacedBy: 'two',
    },
    {
      id: 'pilot',
      labels: [{ language: 'en', text: 'Pilot' }],
      descriptions: [],
      state: 'retired',
    },
  ],
});

const axis = (body: Record<string, unknown>) =>
  conditionAxisDefinitionSchema.safeParse({
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-00000000c001',
    name: 'Phase',
    key: 'phase',
    ...body,
  });

describe('an axis drawing on a vocabulary (the VO plan, VO-E)', () => {
  it('takes its values or a vocabulary, never both and never neither', () => {
    expect(axis({ vocabulary: VOCABULARY }).success).toBe(true);
    expect(axis({ values: [{ key: 'one', label: 'One' }] }).success).toBe(true);
    expect(axis({}).success).toBe(false);
    expect(axis({ values: [{ key: 'one', label: 'One' }], vocabulary: VOCABULARY }).success).toBe(
      false,
    );
    expect(axis({ vocabulary: '' }).success).toBe(false);
  });

  it("resolves a vocabulary's values in its order, by the reader's label, each with its state", () => {
    const parsed = axis({ vocabulary: VOCABULARY });
    if (!parsed.success) throw parsed.error;
    const lookup = (id: string) => (id === VOCABULARY ? phases : undefined);
    expect(axisValues(parsed.data, lookup)).toEqual([
      { key: 'early', label: 'Early', state: 'deprecated', replacedBy: 'two' },
      { key: 'two', label: 'Phase II', state: 'active' },
      { key: 'pilot', label: 'Pilot', state: 'retired' },
    ]);
    expect(axisValues(parsed.data, lookup, 'fr').map((each) => each.label)).toEqual([
      'Early',
      'Phase deux',
      'Pilot',
    ]);
    // A vocabulary not there gives nothing, so every value it named reads as unknown.
    expect(axisValues(parsed.data, () => undefined)).toEqual([]);
  });

  it('gives its own values as declared, each active', () => {
    const parsed = axis({ values: [{ key: 'one', label: 'One' }] });
    if (!parsed.success) throw parsed.error;
    expect(axisValues(parsed.data, () => undefined)).toEqual([
      { key: 'one', label: 'One', state: 'active' },
    ]);
  });
});
