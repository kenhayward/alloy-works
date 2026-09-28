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
 * **Each is named by its Unicode name in plain words** - `GREEK SMALL LETTER ALPHA` as
 * _Greek small letter alpha_ - which is what a screen reader says for its button and what its tooltip
 * shows. Taken from the Unicode Character Database, lower-cased but for the first letter, a capital
 * letter's own and a proper name's; Unicode's own spellings kept, _lamda_ among them.
 *
 * A character map of all of Unicode is the operating system's, not this (W-L): these are the
 * characters a technical author reaches for and a keyboard does not have.
 */

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

const group = (name: string, symbols: readonly (readonly [number, string])[]): SymbolGroup => ({
  name,
  symbols: symbols.map(([codePoint, named]) => ({
    codePoint,
    character: String.fromCodePoint(codePoint),
    name: named,
  })),
});

export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
  group('Mathematical', [
    [0x00b1, 'Plus-minus sign'],
    [0x2213, 'Minus-or-plus sign'],
    [0x00d7, 'Multiplication sign'],
    [0x00f7, 'Division sign'],
    [0x2212, 'Minus sign'],
    [0x22c5, 'Dot operator'],
    [0x2218, 'Ring operator'],
    [0x221a, 'Square root'],
    [0x221b, 'Cube root'],
    [0x221e, 'Infinity'],
    [0x221d, 'Proportional to'],
    [0x2248, 'Almost equal to'],
    [0x2245, 'Approximately equal to'],
    [0x223c, 'Tilde operator'],
    [0x2260, 'Not equal to'],
    [0x2261, 'Identical to'],
    [0x2264, 'Less-than or equal to'],
    [0x2265, 'Greater-than or equal to'],
    [0x226a, 'Much less-than'],
    [0x226b, 'Much greater-than'],
    [0x2211, 'N-ary summation'],
    [0x220f, 'N-ary product'],
    [0x222b, 'Integral'],
    [0x222c, 'Double integral'],
    [0x222e, 'Contour integral'],
    [0x2202, 'Partial differential'],
    [0x2207, 'Nabla'],
    [0x2206, 'Increment'],
    [0x2200, 'For all'],
    [0x2203, 'There exists'],
    [0x2204, 'There does not exist'],
    [0x2208, 'Element of'],
    [0x2209, 'Not an element of'],
    [0x2282, 'Subset of'],
    [0x2283, 'Superset of'],
    [0x2286, 'Subset of or equal to'],
    [0x2287, 'Superset of or equal to'],
    [0x2229, 'Intersection'],
    [0x222a, 'Union'],
    [0x2205, 'Empty set'],
    [0x00ac, 'Not sign'],
    [0x2227, 'Logical and'],
    [0x2228, 'Logical or'],
    [0x2295, 'Circled plus'],
    [0x2297, 'Circled times'],
    [0x21d2, 'Rightwards double arrow'],
    [0x21d4, 'Left right double arrow'],
    [0x2192, 'Rightwards arrow'],
    [0x2190, 'Leftwards arrow'],
    [0x2194, 'Left right arrow'],
    [0x2234, 'Therefore'],
    [0x2235, 'Because'],
    [0x2220, 'Angle'],
    [0x22a5, 'Up tack'],
    [0x2225, 'Parallel to'],
    [0x2032, 'Prime'],
    [0x2033, 'Double prime'],
    [0x2115, 'Double-struck capital N'],
    [0x2124, 'Double-struck capital Z'],
    [0x211a, 'Double-struck capital Q'],
    [0x211d, 'Double-struck capital R'],
    [0x2102, 'Double-struck capital C'],
    [0x00bd, 'Vulgar fraction one half'],
    [0x2153, 'Vulgar fraction one third'],
    [0x00bc, 'Vulgar fraction one quarter'],
    [0x00be, 'Vulgar fraction three quarters'],
  ]),
  group('Greek', [
    [0x03b1, 'Greek small letter alpha'],
    [0x03b2, 'Greek small letter beta'],
    [0x03b3, 'Greek small letter gamma'],
    [0x03b4, 'Greek small letter delta'],
    [0x03b5, 'Greek small letter epsilon'],
    [0x03b6, 'Greek small letter zeta'],
    [0x03b7, 'Greek small letter eta'],
    [0x03b8, 'Greek small letter theta'],
    [0x03b9, 'Greek small letter iota'],
    [0x03ba, 'Greek small letter kappa'],
    [0x03bb, 'Greek small letter lamda'],
    [0x03bc, 'Greek small letter mu'],
    [0x03bd, 'Greek small letter nu'],
    [0x03be, 'Greek small letter xi'],
    [0x03bf, 'Greek small letter omicron'],
    [0x03c0, 'Greek small letter pi'],
    [0x03c1, 'Greek small letter rho'],
    [0x03c2, 'Greek small letter final sigma'],
    [0x03c3, 'Greek small letter sigma'],
    [0x03c4, 'Greek small letter tau'],
    [0x03c5, 'Greek small letter upsilon'],
    [0x03c6, 'Greek small letter phi'],
    [0x03c7, 'Greek small letter chi'],
    [0x03c8, 'Greek small letter psi'],
    [0x03c9, 'Greek small letter omega'],
    [0x03d1, 'Greek theta symbol'],
    [0x03d5, 'Greek phi symbol'],
    [0x03d6, 'Greek pi symbol'],
    [0x03f5, 'Greek lunate epsilon symbol'],
    [0x0391, 'Greek capital letter alpha'],
    [0x0392, 'Greek capital letter beta'],
    [0x0393, 'Greek capital letter gamma'],
    [0x0394, 'Greek capital letter delta'],
    [0x0395, 'Greek capital letter epsilon'],
    [0x0396, 'Greek capital letter zeta'],
    [0x0397, 'Greek capital letter eta'],
    [0x0398, 'Greek capital letter theta'],
    [0x0399, 'Greek capital letter iota'],
    [0x039a, 'Greek capital letter kappa'],
    [0x039b, 'Greek capital letter lamda'],
    [0x039c, 'Greek capital letter mu'],
    [0x039d, 'Greek capital letter nu'],
    [0x039e, 'Greek capital letter xi'],
    [0x039f, 'Greek capital letter omicron'],
    [0x03a0, 'Greek capital letter pi'],
    [0x03a1, 'Greek capital letter rho'],
    [0x03a3, 'Greek capital letter sigma'],
    [0x03a4, 'Greek capital letter tau'],
    [0x03a5, 'Greek capital letter upsilon'],
    [0x03a6, 'Greek capital letter phi'],
    [0x03a7, 'Greek capital letter chi'],
    [0x03a8, 'Greek capital letter psi'],
    [0x03a9, 'Greek capital letter omega'],
  ]),
  group('Scientific and technical', [
    [0x00b0, 'Degree sign'],
    [0x2103, 'Degree Celsius'],
    [0x2109, 'Degree Fahrenheit'],
    [0x00c5, 'Latin capital letter A with ring above'],
    [0x2030, 'Per mille sign'],
    [0x2031, 'Per ten thousand sign'],
    [0x210f, 'Planck constant over two pi'],
    [0x210e, 'Planck constant'],
    [0x2113, 'Script small l'],
    [0x212e, 'Estimated symbol'],
    [0x2300, 'Diameter sign'],
    [0x2301, 'Electric arrow'],
    [0x223f, 'Sine wave'],
    [0x2393, 'Direct current symbol form two'],
    [0x23da, 'Earth ground'],
    [0x21cc, 'Rightwards harpoon over leftwards harpoon'],
    [0x27f6, 'Long rightwards arrow'],
    [0x2191, 'Upwards arrow'],
    [0x2193, 'Downwards arrow'],
  ]),
];
