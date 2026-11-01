import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from '../metadata/definition.js';
import { parseVocabulary, VocabularyRefused, type Vocabulary } from './vocabulary.js';
import { refreshVocabulary, sourcedEditRefusals, type SourcedValue } from './vocabulary-refresh.js';

const en = (text: string) => [{ language: 'en', text }];

const sourced = (values: Vocabulary['values']): Vocabulary =>
  parseVocabulary({
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id: 'vocabulary-sites',
    name: 'Sites',
    key: 'site',
    base: 'en',
    order: 'declared',
    source: { kind: 'skos', url: 'https://terms.example/sites.ttl' },
    values,
  });

const row = (source: string, label: string, extra: Partial<SourcedValue> = {}): SourcedValue => ({
  source,
  labels: en(label),
  descriptions: [],
  ...extra,
});

describe('a vocabulary refreshed from its source', () => {
  it('LIB-058 keeps each value by its source identifier: new ones active, changed labels taken, dropped ones retired', () => {
    const previous = sourced([
      {
        id: 'north',
        source: 'https://terms.example/N',
        labels: en('North'),
        descriptions: [],
        state: 'active',
      },
      {
        id: 'south',
        source: 'https://terms.example/S',
        labels: en('South'),
        descriptions: [],
        state: 'active',
      },
      {
        id: 'east',
        source: 'https://terms.example/E',
        labels: en('East'),
        descriptions: [],
        state: 'deprecated',
        replacedBy: 'north',
      },
    ]);
    const { next, report } = refreshVocabulary(previous, [
      row('https://terms.example/N', 'Northern'),
      row('https://terms.example/E', 'East'),
      row('https://terms.example/W', 'West', { notation: 'west' }),
      row('https://terms.example/Lake District', 'Lakes'),
    ]);
    expect(next.values.map((each) => [each.id, each.state, each.labels[0]!.text])).toEqual([
      ['north', 'active', 'Northern'],
      ['south', 'retired', 'South'],
      // A value's state is its administrator's: a deprecated one stays so.
      ['east', 'deprecated', 'East'],
      ['west', 'active', 'West'],
      // No notation in a value id's form: one made of the identifier's last part.
      ['lake_district', 'active', 'Lakes'],
    ]);
    expect(next.values.find((each) => each.id === 'west')!.source).toBe('https://terms.example/W');
    expect(report).toEqual({
      added: ['west', 'lake_district'],
      relabelled: ['north'],
      retired: ['south'],
      returned: [],
      unchanged: 1,
      refused: [],
      refusedTotal: 0,
    });
  });

  it('keeps a retired value retired when it comes back, saying so, and never drops a value made by hand', () => {
    const previous = sourced([
      { id: 'north', source: 'N', labels: en('North'), descriptions: [], state: 'retired' },
      { id: 'local', labels: en('Local'), descriptions: [], state: 'active' },
    ]);
    const { next, report } = refreshVocabulary(previous, [row('N', 'North')]);
    expect(next.values.map((each) => [each.id, each.state])).toEqual([
      ['north', 'retired'],
      ['local', 'active'],
    ]);
    expect(report.returned).toEqual(['north']);
  });

  it('refuses a row it cannot hold, naming it, and keeps the rest', () => {
    const previous = sourced([]);
    const { next, report } = refreshVocabulary(previous, [
      row('A', 'Alpha'),
      row('A', 'Again'),
      { source: 'B', labels: [{ language: 'de', text: 'Beta' }], descriptions: [] },
      row('', 'Blank'),
      row('C', 'x'.repeat(501)),
    ]);
    expect(next.values.map((each) => each.id)).toEqual(['a']);
    expect(report.refused).toEqual([
      { source: 'A', reason: 'a second value with this identifier' },
      { source: 'B', reason: 'no label in the base language, en' },
      { source: '', reason: 'no identifier' },
      { source: 'C', reason: 'a label longer than a value holds' },
    ]);
    expect(report.refusedTotal).toBe(4);
  });

  it('allocates an id once, never one already held, however the identifiers collide', () => {
    const previous = sourced([
      { id: 'north', labels: en('North'), descriptions: [], state: 'active' },
    ]);
    const { next } = refreshVocabulary(previous, [
      row('x/North', 'North again'),
      row('y/north', 'And again'),
      row('9', 'Nine'),
    ]);
    expect(next.values.map((each) => each.id)).toEqual(['north', 'north_2', 'north_3', 'v_9']);
  });

  it('refuses the values past the most a vocabulary holds', () => {
    const rows = Array.from({ length: 5_001 }, (_, n) => row(`s${n}`, `Site ${n}`));
    const { next, report } = refreshVocabulary(sourced([]), rows);
    expect(next.values).toHaveLength(5_000);
    expect(report.refused).toEqual([{ source: 's5000', reason: 'past 5,000 values' }]);
  });
});

describe('a sourced vocabulary changed by hand', () => {
  const previous = sourced([
    { id: 'north', source: 'N', labels: en('North'), descriptions: [], state: 'active' },
    { id: 'south', source: 'S', labels: en('South'), descriptions: [], state: 'active' },
  ]);

  it('LIB-058 takes its values from the source alone, so a hand change may set states and replacements only', () => {
    expect(
      sourcedEditRefusals(previous, {
        ...previous,
        values: [
          { ...previous.values[0]!, state: 'deprecated', replacedBy: 'south' },
          { ...previous.values[1]!, state: 'retired' },
        ],
      }),
    ).toEqual([]);
    expect(
      sourcedEditRefusals(previous, {
        ...previous,
        values: [
          { ...previous.values[0]!, labels: en('Nord') },
          previous.values[1]!,
          { id: 'west', labels: en('West'), descriptions: [], state: 'active' },
        ],
      }),
    ).toEqual([
      "north: its labels and descriptions are its source's",
      'west: a value comes from the source',
    ]);
    // Its source changed, or taken away, is the administrator's to do.
    const { source: _, ...unsourced } = previous;
    expect(sourcedEditRefusals(previous, { ...unsourced, values: [] })).toEqual([]);
    expect(sourcedEditRefusals(undefined, previous)).toEqual([]);
  });

  it('refuses a source identifier held by two values', () => {
    expect(() =>
      sourced([
        { id: 'a', source: 'N', labels: en('A'), descriptions: [], state: 'active' },
        { id: 'b', source: 'N', labels: en('B'), descriptions: [], state: 'active' },
      ]),
    ).toThrow(VocabularyRefused);
  });
});
