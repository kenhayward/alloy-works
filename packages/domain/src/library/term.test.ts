import { describe, expect, it } from 'vitest';

import { isLanguageTag, termLabel, parseTerm, TermRefused, type Term } from './term.js';

const BROADER = '0b1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const RELATED = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const dunnart: Term = {
  schemaVersion: 1,
  base: 'en',
  labels: [
    {
      language: 'en',
      preferred: 'Fat-tailed dunnart',
      alternatives: ['Dunnart'],
      abbreviation: 'FTD',
    },
    { language: 'fr', preferred: 'Dunnart à queue grasse', alternatives: [] },
  ],
  definition: [{ language: 'en', text: 'A small carnivorous marsupial.' }],
  broader: [BROADER],
  narrower: [],
  related: [RELATED],
};

const problems = (value: unknown) => {
  try {
    parseTerm(value);
  } catch (error) {
    if (error instanceof TermRefused) return error.problems.map((each) => each.path);
    throw error;
  }
  return [];
};

describe('a term', () => {
  it('LIB-013 holds a preferred label, alternatives, an abbreviation and a definition', () => {
    expect(problems(dunnart)).toEqual([]);
    expect(parseTerm(dunnart)).toEqual(dunnart);
    // A preferred label is required, and nothing beyond the shape is kept.
    expect(
      problems({ ...dunnart, labels: [{ language: 'en', preferred: ' ', alternatives: [] }] }),
    ).toEqual(['labels.0.preferred']);
    expect(problems({ ...dunnart, status: 'approved' })).toEqual(['']);
  });

  it('LIB-014 holds each label and abbreviation per language, the base language labelled', () => {
    // Each language once, a BCP 47 tag, and the base among them.
    expect(problems({ ...dunnart, labels: [dunnart.labels[0], dunnart.labels[0]] })).toEqual([
      'labels.1.language',
    ]);
    expect(
      problems({ ...dunnart, labels: [{ ...dunnart.labels[0], language: 'English' }] }),
    ).toEqual(['labels.0.language', 'base']);
    expect(problems({ ...dunnart, base: 'de' })).toEqual(['base']);
    expect(
      problems({ ...dunnart, definition: [...dunnart.definition, ...dunnart.definition] }),
    ).toEqual(['definition.1.language']);
    expect(termLabel(parseTerm(dunnart), 'fr').preferred).toBe('Dunnart à queue grasse');
    expect([isLanguageTag('en-GB'), isLanguageTag('zh-Hant'), isLanguageTag('en-gb')]).toEqual([
      true,
      true,
      false,
    ]);
    // A language with no label takes the base's.
    expect(termLabel(parseTerm(dunnart), 'de').preferred).toBe('Fat-tailed dunnart');
  });

  it('LIB-025 states broader, narrower and related terms by identity, each once', () => {
    expect(problems({ ...dunnart, broader: ['the marsupials'] })).toEqual(['broader.0']);
    expect(problems({ ...dunnart, related: [RELATED, RELATED] })).toEqual(['related.1']);
    // Nothing is inferred: what is stated is what holds.
    expect(parseTerm(dunnart).narrower).toEqual([]);
    expect(problems({ ...dunnart, replacedBy: BROADER })).toEqual([]);
  });

  it('bounds every list and string', () => {
    const long = 'x'.repeat(501);
    expect(problems({ ...dunnart, labels: [{ ...dunnart.labels[0], preferred: long }] })).toEqual([
      'labels.0.preferred',
    ]);
    expect(
      problems({ ...dunnart, labels: [{ ...dunnart.labels[0], abbreviation: 'x'.repeat(41) }] }),
    ).toEqual(['labels.0.abbreviation']);
    expect(
      problems({
        ...dunnart,
        labels: [
          { ...dunnart.labels[0], alternatives: Array.from({ length: 51 }, (_, n) => `a${n}`) },
        ],
      }),
    ).toEqual(['labels.0.alternatives']);
    expect(
      problems({ ...dunnart, definition: [{ language: 'en', text: 'x'.repeat(10_001) }] }),
    ).toEqual(['definition.0.text']);
    expect(
      problems({ ...dunnart, labels: [{ ...dunnart.labels[0], preferred: 'a\u0007b' }] }),
    ).toEqual(['labels.0.preferred']);
  });
});
