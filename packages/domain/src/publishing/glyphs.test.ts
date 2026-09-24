import { describe, expect, it } from 'vitest';

import { characterProblems, type Covers } from './glyphs.js';

const SERIF = 'Liberation Serif';
const MONO = 'Liberation Mono';
const MATHS = 'STIX Two Math';

// A serif family that sets U+2016 and a monospace one that does not, as the pinned Liberation faces do.
const covers: Covers = (codePoint, family) =>
  codePoint < 0x250 || (family === SERIF && codePoint === 0x2016);

describe('characterProblems', () => {
  it('asks the family the text is set in, by its name (themes 1, ruling R6)', () => {
    expect(characterProblems('a\u{2016}', covers, MONO, 'code')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x2016 },
    ]);
    expect(characterProblems('a\u{2016}', covers, SERIF, 'body')).toEqual([]);
    // How the text is set and what sets it are two questions: body text in a theme's monospace family
    // is still body text, and still asks the family that sets it.
    expect(characterProblems('a\u{2016}', covers, MONO, 'body')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x2016 },
    ]);
    expect(characterProblems('a\u{2016}', covers, SERIF, 'code')).toEqual([]);
  });

  it('exempts nothing set as code, where the engine drops the letter before an invisible character', () => {
    expect(characterProblems('ab\u{200B}cd', covers, MONO, 'code')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x200b },
    ]);
    expect(characterProblems('ab\u{200B}cd', covers, MONO, 'body')).toEqual([]);
  });

  it('exempts only a space in an equation, where the engine drops the letter before an invisible character too', () => {
    // A joiner and a variation selector each take the letter before them out of the PDF's text in an
    // equation, as in code; a space the engine lays out as one, and it is copied as one (the final
    // review of equations 2, M2).
    expect(
      characterProblems('a\u{200D}b\u{FE0F}c\u{3000}d\u{2028}', covers, MATHS, 'math'),
    ).toEqual([
      { problem: 'glyph_missing', codePoint: 0x200d },
      { problem: 'glyph_missing', codePoint: 0xfe0f },
    ]);
    expect(characterProblems('a\u{200D}b\u{3000}', covers, SERIF, 'body')).toEqual([]);
  });

  it('asks the maths family of what an equation sets, which covers what the body family does not', () => {
    // An integral sign in the maths face and not the body's, as STIX Two Math and Liberation Serif.
    const withMaths: Covers = (codePoint, family) =>
      codePoint < 0x250 || (family === MATHS && codePoint === 0x222b);
    expect(characterProblems('x\u{222B}', withMaths, MATHS, 'math')).toEqual([]);
    expect(characterProblems('x\u{222B}', withMaths, SERIF, 'body')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x222b },
    ]);
  });
});
