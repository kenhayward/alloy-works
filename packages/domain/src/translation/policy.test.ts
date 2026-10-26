import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSLATION_POLICY, translationPolicySchema, untranslatedNote } from './policy.js';

describe('the translation policy', () => {
  it('states its default: fall back to the source, publish what is out of date, place a conflicted return for review', () => {
    expect(DEFAULT_TRANSLATION_POLICY).toEqual({
      fallback: 'source',
      outOfDate: 'publish',
      note: {},
      conflict: 'review',
    });
  });

  it('LOC-035 reads a policy stored before conflicts as placing them for review', () => {
    expect(
      translationPolicySchema.parse({ fallback: 'source', outOfDate: 'publish', note: {} }),
    ).toEqual(DEFAULT_TRANSLATION_POLICY);
    expect(
      translationPolicySchema.safeParse({ ...DEFAULT_TRANSLATION_POLICY, conflict: 'apply' })
        .success,
    ).toBe(false);
  });

  it('holds a note by language, each a tag and a few words', () => {
    expect(
      translationPolicySchema.safeParse({
        fallback: 'refuse',
        outOfDate: 'refuse',
        note: { 'fr-FR': 'Non traduit' },
      }).success,
    ).toBe(true);
    expect(
      translationPolicySchema.safeParse({ ...DEFAULT_TRANSLATION_POLICY, note: { French: 'x' } })
        .success,
    ).toBe(false);
    expect(
      translationPolicySchema.safeParse({ ...DEFAULT_TRANSLATION_POLICY, note: { fr: '' } })
        .success,
    ).toBe(false);
    // Nothing a database cannot store, or a publication refuses (the TRb security review).
    expect(
      translationPolicySchema.safeParse({
        ...DEFAULT_TRANSLATION_POLICY,
        note: { fr: `Non${String.fromCharCode(0)}traduit` },
      }).success,
    ).toBe(false);
  });

  it('LOC-037 marks a component in its source language with the words for the document’s language, else its base language’s, else Untranslated', () => {
    const note = { fr: 'Non traduit', 'de-DE': 'Nicht übersetzt' };
    expect(untranslatedNote(note, 'fr-FR', 'en-GB')).toBe('Non traduit (en-GB)');
    expect(untranslatedNote(note, 'de-DE', 'en-GB')).toBe('Nicht übersetzt (en-GB)');
    expect(untranslatedNote(note, 'es-ES', 'en-GB')).toBe('Untranslated (en-GB)');
  });
});
