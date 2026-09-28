import { readTheme } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { typefaceAt } from '../theme/check.js';
import { DEFAULT_PRESENTATION } from '../theme/presentation.fixture.js';
import { SYMBOL_GROUPS } from './symbols.js';

const every = SYMBOL_GROUPS.flatMap((group) => group.symbols);

describe("the symbol palette's characters (W14.7)", () => {
  it('holds three groups: mathematical, Greek, and scientific and technical, none empty', () => {
    expect(SYMBOL_GROUPS.map((group) => group.name)).toEqual([
      'Mathematical',
      'Greek',
      'Scientific and technical',
    ]);
    for (const group of SYMBOL_GROUPS) expect(group.symbols.length, group.name).toBeGreaterThan(0);
  });

  // No sequence is offered: every entry is one character, which is what inserting it types.
  it('offers each as one code point, never a control character, which normalising leaves alone', () => {
    for (const { character, codePoint, name } of every) {
      expect([...character], name).toHaveLength(1);
      expect(character.codePointAt(0), name).toBe(codePoint);
      expect(character, name).not.toMatch(/\p{Cc}/u);
      // The stored text is compared as it was typed: a character NFC turns into another - the ohm
      // sign into omega, the kelvin sign into K - would come back as something else.
      expect(character.normalize('NFC'), name).toBe(character);
    }
  });

  it('names each in plain words, as a screen reader says it, from its Unicode name', () => {
    for (const { name } of every) expect(name).toMatch(/^[A-Z][A-Za-z -]*[a-zA-Z]$/);
    // Spot checks against the Unicode names, which the rest were taken from.
    const named = (codePoint: number) => every.find((each) => each.codePoint === codePoint)?.name;
    expect(named(0x3b1)).toBe('Greek small letter alpha');
    expect(named(0x3a9)).toBe('Greek capital letter omega');
    expect(named(0xb1)).toBe('Plus-minus sign');
    expect(named(0x2211)).toBe('N-ary summation');
    expect(named(0x2103)).toBe('Degree Celsius');
  });

  it('offers no character twice, and gives no two the same name', () => {
    expect(new Set(every.map((each) => each.codePoint)).size).toBe(every.length);
    expect(new Set(every.map((each) => each.name)).size).toBe(every.length);
  });
});

describe("the symbol palette's characters, against the default theme's text face (W14.7, W-M)", () => {
  const read = readTheme(
    DEFAULT_PRESENTATION.theme.content,
    new Map(DEFAULT_PRESENTATION.theme.catalogues.map((each) => [each.versionId, each.content])),
  );
  if (!read.ok) throw new Error('the default theme does not read');
  // Running text in the default theme, as a caret in a paragraph of it stands.
  const running = typefaceAt(read.theme, [], {
    paragraph: { style: 'body', place: 'text' },
    role: null,
    code: false,
    inlineCode: false,
  });
  const lacked = (codePoints: readonly number[]) =>
    codePoints.filter((codePoint) => running!.lacks(String.fromCodePoint(codePoint)));

  it('is asked of the family that sets running text, the default serif', () => {
    expect(running?.family).toBe('Liberation Serif');
  });

  // Greek is what an author reaches for most, and all of it is set in the default serif.
  it('finds every Greek letter in the default serif', () => {
    const greek = SYMBOL_GROUPS.find((group) => group.name === 'Greek')!;
    expect(lacked(greek.symbols.map((each) => each.codePoint))).toEqual([]);
  });

  // What the palette's first editor test inserts and names are in it too, so it shows one that inserts.
  it("finds the characters the palette's first editor test uses in the default serif", () => {
    expect(lacked([0x00b1, 0x2211, 0x00b0, 0x03b1, 0x03a9, 0x00be])).toEqual([]);
  });

  // And some of the palette is not: the maths an author is pointed to an equation for.
  it('lacks some mathematical symbols, which the palette dims', () => {
    expect(
      lacked([0x2200, 0x2203, 0x2208, 0x2282, 0x2205, 0x21d2, 0x2207, 0x211d, 0x2103]),
    ).toEqual([0x2200, 0x2203, 0x2208, 0x2282, 0x2205, 0x21d2, 0x2207, 0x211d, 0x2103]);
  });
});
