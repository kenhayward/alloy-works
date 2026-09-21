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
});
