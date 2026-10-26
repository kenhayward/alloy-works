import { describe, expect, it } from 'vitest';
import { parseContentDocument } from '../content/model/document.js';
import {
  TRANSLATION_STATUSES,
  asVariant,
  sourceChangesBetween,
  translationLanguageRefusal,
  translationStatus,
} from './status.js';

const source = parseContentDocument({
  schemaVersion: 1,
  title: 'Sampling',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'Ponds were sampled.', marks: [] }],
    },
  ],
});

describe('a translation status', () => {
  it('declares the set a variant may carry, approval not among them', () => {
    expect(TRANSLATION_STATUSES).toEqual([
      'untranslated',
      'machineDrafted',
      'inTranslation',
      'translated',
      'outOfDate',
    ]);
  });

  it('is untranslated where nothing records what a variant translates', () => {
    expect(translationStatus({ translates: null, laterSource: [] })).toEqual({
      status: 'untranslated',
    });
  });

  it('is translated where the source has not changed since', () => {
    expect(translationStatus({ translates: 'v1', laterSource: [] })).toEqual({
      status: 'translated',
    });
  });

  it('LOC-014 goes out of date at any later source version, declared or not', () => {
    expect(translationStatus({ translates: 'v1', laterSource: [{ retranslate: false }] })).toEqual({
      status: 'outOfDate',
      retranslate: false,
    });
  });

  it('LOC-015 distinguishes a change needing retranslation from one that does not', () => {
    expect(
      translationStatus({
        translates: 'v1',
        laterSource: [{ retranslate: false }, { retranslate: true }],
      }),
    ).toEqual({ status: 'outOfDate', retranslate: true });
  });

  it('LOC-024 is machine drafted, over every other status, while a draft is not accepted', () => {
    expect(
      translationStatus({
        translates: 'v1',
        laterSource: [],
        machineDrafted: true,
        inTranslation: true,
      }),
    ).toEqual({ status: 'machineDrafted' });
  });

  it('LOC-030 is in translation while a job is out, over untranslated and out of date but not translated', () => {
    const out = { inTranslation: true };
    expect(translationStatus({ translates: null, laterSource: [], ...out })).toEqual({
      status: 'inTranslation',
    });
    expect(
      translationStatus({ translates: 'v1', laterSource: [{ retranslate: true }], ...out }),
    ).toEqual({ status: 'inTranslation' });
    expect(translationStatus({ translates: 'v1', laterSource: [], ...out })).toEqual({
      status: 'translated',
    });
  });
});

describe('a language line', () => {
  it('refuses a language that is not a BCP 47 tag, or the source language itself', () => {
    expect(translationLanguageRefusal('en-GB', 'fr-FR')).toBeNull();
    expect(translationLanguageRefusal('en-GB', 'not a tag')).toBe('translation.language_invalid');
    expect(translationLanguageRefusal('en-GB', 'en-GB')).toBe('translation.same_language');
  });

  it('starts from the source, its blocks kept and its root in the variant language', () => {
    const variant = asVariant(source, 'fr-FR');
    expect(variant.language).toBe('fr-FR');
    expect(variant.content.map((block) => block.id)).toEqual(['p1']);
    expect(source.language).toBe('en-GB');
  });
});

describe('what changed in the source since a translation', () => {
  const para = (id: string, value: string) => ({
    type: 'paragraph' as const,
    id,
    style: 'body',
    content: [{ type: 'text' as const, value, marks: [] }],
  });
  const at = (...content: ReturnType<typeof para>[]) =>
    parseContentDocument({ ...source, content });

  it('LOC-040 names each source block added, changed or removed, in the newer source order', () => {
    const was = at(para('p1', 'Ponds were sampled.'), para('p2', 'In May.'));
    const now = at(para('p3', 'Twelve ponds.'), para('p1', 'Ponds were sampled twice.'));
    expect(sourceChangesBetween(was, now)).toEqual([
      { block: 'p3', change: 'added' },
      { block: 'p1', change: 'changed' },
      { block: 'p2', change: 'removed' },
    ]);
  });
});
