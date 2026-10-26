/**
 * The symbol palette's characters (CNT-057, W-L): three groups - mathematical, Greek, and scientific and
 * technical - each a list of single characters with their names. Data and nothing else, so what the
 * palette offers is read and tested without drawing it.
 *
 * **Each is one code point**, written by its number rather than as itself, so no editor, normaliser or
 * tool that handles this file can turn one into another; and none that Unicode normalisation changes -
 * the ohm sign becomes omega, the kelvin sign K - so what an author inserts is what is stored. No
 * sequence of characters is offered.
 *
 * **Each is named by its Unicode name in plain words**, from the catalogue by its code point -
 * `GREEK SMALL LETTER ALPHA` as _Greek small letter alpha_, `symbol.U+03B1` - which is what a screen reader says for its button and what its tooltip
 * shows. Taken from the Unicode Character Database, lower-cased but for the first letter, a capital
 * letter's own and a proper name's; Unicode's own spellings kept, _lamda_ among them.
 *
 * A character map of all of Unicode is the operating system's, not this (W-L): these are the
 * characters a technical author reaches for and a keyboard does not have.
 */

import { words, type WordKey } from '../words/words.js';

/** One character the palette offers. */
export interface PaletteSymbol {
  readonly codePoint: number;
  /** The character itself: the one code point, as a string. */
  readonly character: string;
  /** Its Unicode name in plain words, which its button is named by. */
  readonly name: string;
}

/** One of the palette's groups, in the order it shows them. */
export interface SymbolGroup {
  readonly name: string;
  readonly symbols: readonly PaletteSymbol[];
}

/** A character's name as the interface says it: its Unicode name in plain words, from the catalogue. */
const nameOf = (codePoint: number): string =>
  words(`symbol.U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}` as WordKey);

const group = (
  key: 'mathematical' | 'greek' | 'scientific',
  symbols: readonly number[],
): SymbolGroup => ({
  get name() {
    return words(`symbol.group.${key}`);
  },
  symbols: symbols.map((codePoint) => ({
    codePoint,
    character: String.fromCodePoint(codePoint),
    get name() {
      return nameOf(codePoint);
    },
  })),
});

export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
  group(
    'mathematical',
    [
      0x00b1, 0x2213, 0x00d7, 0x00f7, 0x2212, 0x22c5, 0x2218, 0x221a, 0x221b, 0x221e, 0x221d,
      0x2248, 0x2245, 0x223c, 0x2260, 0x2261, 0x2264, 0x2265, 0x226a, 0x226b, 0x2211, 0x220f,
      0x222b, 0x222c, 0x222e, 0x2202, 0x2207, 0x2206, 0x2200, 0x2203, 0x2204, 0x2208, 0x2209,
      0x2282, 0x2283, 0x2286, 0x2287, 0x2229, 0x222a, 0x2205, 0x00ac, 0x2227, 0x2228, 0x2295,
      0x2297, 0x21d2, 0x21d4, 0x2192, 0x2190, 0x2194, 0x2234, 0x2235, 0x2220, 0x22a5, 0x2225,
      0x2032, 0x2033, 0x2115, 0x2124, 0x211a, 0x211d, 0x2102, 0x00bd, 0x2153, 0x00bc, 0x00be,
    ],
  ),
  group(
    'greek',
    [
      0x03b1, 0x03b2, 0x03b3, 0x03b4, 0x03b5, 0x03b6, 0x03b7, 0x03b8, 0x03b9, 0x03ba, 0x03bb,
      0x03bc, 0x03bd, 0x03be, 0x03bf, 0x03c0, 0x03c1, 0x03c2, 0x03c3, 0x03c4, 0x03c5, 0x03c6,
      0x03c7, 0x03c8, 0x03c9, 0x03d1, 0x03d5, 0x03d6, 0x03f5, 0x0391, 0x0392, 0x0393, 0x0394,
      0x0395, 0x0396, 0x0397, 0x0398, 0x0399, 0x039a, 0x039b, 0x039c, 0x039d, 0x039e, 0x039f,
      0x03a0, 0x03a1, 0x03a3, 0x03a4, 0x03a5, 0x03a6, 0x03a7, 0x03a8, 0x03a9,
    ],
  ),
  group(
    'scientific',
    [
      0x00b0, 0x2103, 0x2109, 0x00c5, 0x2030, 0x2031, 0x210f, 0x210e, 0x2113, 0x212e, 0x2300,
      0x2301, 0x223f, 0x2393, 0x23da, 0x21cc, 0x27f6, 0x2191, 0x2193,
    ],
  ),
];
