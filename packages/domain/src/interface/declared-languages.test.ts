import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { cldrInputs, coveredByDefaultFaces } from '../../scripts/cldr-inputs.js';
import { languageTagSchema } from '../content/model/document.js';
import { CONTENT_LANGUAGES, CONTENT_LANGUAGES_CLDR } from './content-languages.js';
import {
  declaredLanguageOf,
  deriveContentLanguages,
  exemplarCodePoints,
  renderContentLanguages,
} from './declared-languages.js';

const everything = () => true;

describe('the declared content languages (the TE plan, TE-E)', () => {
  it('LOC-044 is the list the pinned CLDR and the default faces give, regenerated and compared', () => {
    // `pnpm --filter @alloy-works/domain generate:languages` rewrites content-languages.ts.
    expect(
      renderContentLanguages(deriveContentLanguages(cldrInputs(), coveredByDefaultFaces)),
    ).toBe(renderContentLanguages({ cldr: CONTENT_LANGUAGES_CLDR, languages: CONTENT_LANGUAGES }));
  });

  it('LOC-044 names the CLDR it was made from, the very version the generator pins', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies['cldr-core']).toBe(CONTENT_LANGUAGES_CLDR);
    expect(manifest.devDependencies['cldr-misc-full']).toBe(CONTENT_LANGUAGES_CLDR);
    // Moves with the CLDR or the faces, and only then.
    expect(CONTENT_LANGUAGES_CLDR).toBe('48.2.0');
    expect(CONTENT_LANGUAGES).toHaveLength(285);
  });

  it('LOC-044 reads a script from the tag, its direction from the script and its plurals from CLDR', () => {
    const of = (tag: string) => CONTENT_LANGUAGES.find((each) => each.tag === tag);
    expect(of('en')).toEqual({
      tag: 'en',
      script: 'Latn',
      direction: 'ltr',
      plurals: ['one', 'other'],
    });
    expect(of('sr')?.script).toBe('Cyrl');
    expect(of('sr-Latn')?.script).toBe('Latn');
    expect(of('uz-Cyrl')?.script).toBe('Cyrl');
    expect(of('el')?.script).toBe('Grek');
    expect(of('he')).toMatchObject({ script: 'Hebr', direction: 'rtl' });
    expect(of('pa-Arab')).toMatchObject({ script: 'Arab', direction: 'rtl' });
    expect(of('ar')?.plurals).toEqual(['zero', 'one', 'two', 'few', 'many', 'other']);
    // Another script, or a region's locale, is not a language of the list.
    expect(of('pa')).toBeUndefined();
    expect(of('ja')).toBeUndefined();
    expect(of('en-GB')).toBeUndefined();
  });

  it('LOC-044 declares a language only where every exemplar character is covered', () => {
    const inputs = {
      cldr: '1.0.0',
      available: ['aa', 'bb', 'cc', 'dd-Latn', 'dd-Latn-ZZ', 'ee', 'ff-Grek', 'root'],
      exemplars: {
        aa: '[a b {ch}]',
        bb: '[a ŋ]',
        cc: '[あ い]',
        'dd-Latn': '[а б]',
        'dd-Latn-ZZ': '[a]',
        ee: '[א ב]',
        'ff-Grek': '[α]',
        root: '[a]',
      } as Record<string, string>,
      plurals: { aa: ['one', 'other'], und: ['other'] } as Record<string, readonly string[]>,
    };
    const ascii = (codePoint: number) =>
      codePoint < 0x80 || (codePoint >= 0x5d0 && codePoint < 0x600);
    // bb is covered in part, dd-Latn not at all: neither is declared until it is covered whole.
    expect(deriveContentLanguages(inputs, ascii).languages.map((each) => each.tag)).toEqual([
      'aa',
      'ee',
    ]);
    expect(deriveContentLanguages(inputs, everything).languages).toEqual([
      { tag: 'aa', script: 'Latn', direction: 'ltr', plurals: ['one', 'other'] },
      { tag: 'bb', script: 'Latn', direction: 'ltr', plurals: ['other'] },
      // The tag's script, never what its characters say.
      { tag: 'dd-Latn', script: 'Latn', direction: 'ltr', plurals: ['other'] },
      { tag: 'ee', script: 'Hebr', direction: 'rtl', plurals: ['other'] },
      { tag: 'ff-Grek', script: 'Grek', direction: 'ltr', plurals: ['other'] },
    ]);
  });

  it('reads exemplar sets with strings and escapes', () => {
    const backslash = String.fromCharCode(92);
    expect(exemplarCodePoints(`[a {n${backslash}-} ${backslash}u200C x-z]`)).toEqual(
      new Set([0x61, 0x6e, 0x2d, 0x200c, 0x78, 0x79, 0x7a]),
    );
  });

  it('LOC-044 finds the declared language a tag is in: by its language and script, any case', () => {
    expect(declaredLanguageOf('en-GB')?.tag).toBe('en');
    expect(declaredLanguageOf('EN')?.tag).toBe('en');
    expect(declaredLanguageOf('sr-Latn-RS')?.tag).toBe('sr-Latn');
    expect(declaredLanguageOf('sr-RS')?.tag).toBe('sr');
    expect(declaredLanguageOf('pa-Arab-PK')?.tag).toBe('pa-Arab');
    // Admitted as any well-formed tag is, and not declared.
    expect(languageTagSchema.safeParse('pa').success).toBe(true);
    expect(declaredLanguageOf('pa')).toBeUndefined();
    expect(declaredLanguageOf('zz')).toBeUndefined();
    expect(declaredLanguageOf('')).toBeUndefined();
  });
});
