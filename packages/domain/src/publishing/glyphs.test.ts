import { describe, expect, it } from 'vitest';

import { characterProblems, type Covers } from './glyphs.js';

// A body face that sets U+2016 and a code face that does not, as the pinned Liberation faces do.
const covers: Covers = (codePoint, face) =>
  codePoint < 0x250 || (face === 'body' && codePoint === 0x2016);

describe('characterProblems', () => {
  it('asks the face the text is set in', () => {
    expect(characterProblems('a\u{2016}', covers, 'code')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x2016 },
    ]);
    expect(characterProblems('a\u{2016}', covers, 'body')).toEqual([]);
  });

  it('exempts nothing in the code face, where the engine drops the letter before an invisible character', () => {
    expect(characterProblems('ab\u{200B}cd', covers, 'code')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x200b },
    ]);
    expect(characterProblems('ab\u{200B}cd', covers, 'body')).toEqual([]);
  });

  it('exempts only a space in the maths face, where the engine drops the letter before an invisible character too', () => {
    // A joiner and a variation selector each take the letter before them out of the PDF's text in an
    // equation, as in code; a space the engine lays out as one, and it is copied as one (the final
    // review of equations 2, M2).
    expect(characterProblems('a\u{200D}b\u{FE0F}c\u{3000}d\u{2028}', covers, 'math')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x200d },
      { problem: 'glyph_missing', codePoint: 0xfe0f },
    ]);
    expect(characterProblems('a\u{200D}b\u{3000}', covers, 'body')).toEqual([]);
  });

  it('asks the maths face of what an equation sets, which covers what the body face does not', () => {
    // An integral sign in the maths face and not the body's, as STIX Two Math and Liberation Serif.
    const withMaths: Covers = (codePoint, face) =>
      codePoint < 0x250 || (face === 'math' && codePoint === 0x222b);
    expect(characterProblems('x\u{222B}', withMaths, 'math')).toEqual([]);
    expect(characterProblems('x\u{222B}', withMaths, 'body')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x222b },
    ]);
  });
});
