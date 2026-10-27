import { describe, expect, it } from 'vitest';

import { characterProblems, settingFaces, type Covers } from './glyphs.js';

const SERIF = 'Liberation Serif';
const MONO = 'Liberation Mono';
const MATHS = 'STIX Two Math';
const NASKH = 'Noto Naskh Arabic';

// A serif family that sets U+2016 and a monospace one that does not, as the pinned Liberation faces do.
const covers: Covers = (codePoint, family) =>
  codePoint < 0x250 || (family === SERIF && codePoint === 0x2016);

describe('characterProblems', () => {
  it('asks the family the text is set in, by its name (themes 1, ruling R6)', () => {
    expect(characterProblems('a\u{2016}', covers, [MONO], 'code')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x2016 },
    ]);
    expect(characterProblems('a\u{2016}', covers, [SERIF], 'body')).toEqual([]);
    // How the text is set and what sets it are two questions: body text in a theme's monospace family
    // is still body text, and still asks the family that sets it.
    expect(characterProblems('a\u{2016}', covers, [MONO], 'body')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x2016 },
    ]);
    expect(characterProblems('a\u{2016}', covers, [SERIF], 'code')).toEqual([]);
  });

  it('exempts nothing set as code, where the engine drops the letter before an invisible character', () => {
    expect(characterProblems('ab\u{200B}cd', covers, [MONO], 'code')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x200b },
    ]);
    expect(characterProblems('ab\u{200B}cd', covers, [MONO], 'body')).toEqual([]);
  });

  it('exempts only a space in an equation, where the engine drops the letter before an invisible character too', () => {
    // A joiner and a variation selector each take the letter before them out of the PDF's text in an
    // equation, as in code; a space the engine lays out as one, and it is copied as one (the final
    // review of equations 2, M2).
    expect(
      characterProblems('a\u{200D}b\u{FE0F}c\u{3000}d\u{2028}', covers, [MATHS], 'math'),
    ).toEqual([
      { problem: 'glyph_missing', codePoint: 0x200d },
      { problem: 'glyph_missing', codePoint: 0xfe0f },
    ]);
    expect(characterProblems('a\u{200D}b\u{3000}', covers, [SERIF], 'body')).toEqual([]);
  });

  it('asks the maths family of what an equation sets, which covers what the body family does not', () => {
    // An integral sign in the maths face and not the body's, as STIX Two Math and Liberation Serif.
    const withMaths: Covers = (codePoint, family) =>
      codePoint < 0x250 || (family === MATHS && codePoint === 0x222b);
    expect(characterProblems('x\u{222B}', withMaths, [MATHS], 'math')).toEqual([]);
    expect(characterProblems('x\u{222B}', withMaths, [SERIF], 'body')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x222b },
    ]);
  });

  it('asks a chain for body text, each character of the first face that covers it (the UI plan, UF-D)', () => {
    // A serif with no Arabic and a Naskh with no Latin letters, as the pinned faces are.
    const chained: Covers = (codePoint, family) =>
      family === NASKH ? codePoint >= 0x600 || codePoint === 0x20 : codePoint < 0x250;
    expect(characterProblems('a \u{0627}', chained, [SERIF, NASKH], 'body')).toEqual([]);
    expect(characterProblems('a \u{0627}', chained, [SERIF], 'body')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x627 },
    ]);
    // Code and an equation ask the chain's first face alone (UF-C).
    expect(characterProblems('\u{0627}', chained, [SERIF, NASKH], 'code')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x627 },
    ]);
    expect(characterProblems('\u{0627}', chained, [SERIF, NASKH], 'math')).toEqual([
      { problem: 'glyph_missing', codePoint: 0x627 },
    ]);
  });
});

describe('settingFaces', () => {
  const chained: Covers = (codePoint, family) =>
    family === NASKH
      ? codePoint >= 0x600 || [0x20, 0x2e, 0x200c, 0x200d].includes(codePoint)
      : codePoint < 0x250 || codePoint === 0x200c || codePoint === 0x200d;

  it('says which face sets each character: the first in the chain that covers it', () => {
    expect(settingFaces('ab', chained, [SERIF, NASKH])).toEqual([SERIF, SERIF]);
    expect(settingFaces('\u{0627}\u{0628}', chained, [SERIF, NASKH])).toEqual([NASKH, NASKH]);
    // None where no face covers it.
    expect(settingFaces('\u{05D0}', chained, [SERIF, NASKH])).toEqual([null]);
  });

  it('keeps a Common or Inherited character in the face before it, where that face covers it', () => {
    // A space and a full stop after Arabic stay in the Naskh; a joiner and a harakah too; a bracket
    // the Naskh lacks falls to the serif. Before anything, the first covering face.
    expect(
      settingFaces(' \u{0645}\u{064A}\u{200C}\u{062E} \u{0628}\u{064E}.(', chained, [SERIF, NASKH]),
    ).toEqual([SERIF, NASKH, NASKH, NASKH, NASKH, NASKH, NASKH, NASKH, NASKH, SERIF]);
    // A space after Latin stays in the serif.
    expect(settingFaces('a \u{0627}', chained, [SERIF, NASKH])).toEqual([SERIF, SERIF, NASKH]);
  });
});
