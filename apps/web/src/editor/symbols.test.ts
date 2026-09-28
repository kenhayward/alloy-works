import { describe, expect, it } from 'vitest';

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
