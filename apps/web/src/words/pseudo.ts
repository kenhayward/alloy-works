import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { printAST } from '@formatjs/icu-messageformat-parser/printer.js';

/**
 * **Pseudolocalisation** (the UI plan, UI-D; LOC-042, LOC-029): an English message made into one that
 * looks foreign, so a word left in English shows, and longer, so a layout that cannot take a longer
 * language shows too. Its letters accented, its words bracketed, padded half again as long - twice
 * under twenty characters - and, for the right-to-left locale, set right to left. Placeholders,
 * plurals and selects keep their syntax; only literal text changes.
 */

const ACCENTED: Readonly<Record<string, string>> = {
  a: 'å',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'î',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'û',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Å',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Î',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ö',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Û',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/** Where a pseudo-locale's words begin and end: what the suites look for to find a word left in English. */
export const PSEUDO_OPEN = '[';
export const PSEUDO_CLOSE = ']';

/** Right-to-left override and its end, so a right-to-left layout shows with English letters. */
const RTL_OVERRIDE = String.fromCharCode(0x202e);
const POP = String.fromCharCode(0x202c);

const accent = (text: string) => [...text].map((each) => ACCENTED[each] ?? each).join('');

function accented(elements: readonly MessageFormatElement[]): MessageFormatElement[] {
  return elements.map((element) => {
    if (element.type === TYPE.literal) return { ...element, value: accent(element.value) };
    if (element.type === TYPE.plural || element.type === TYPE.select) {
      return {
        ...element,
        options: Object.fromEntries(
          Object.entries(element.options).map(([key, option]) => [
            key,
            { ...option, value: accented(option.value) },
          ]),
        ),
      };
    }
    if (element.type === TYPE.tag) return { ...element, children: accented(element.children) };
    return element;
  });
}

export function pseudolocalise(message: string, locale: 'en-XA' | 'ar-XB'): string {
  const printed = printAST(accented(parse(message)));
  // Padded to half again as long, or twice under twenty characters (LOC-029).
  const target = Math.ceil(message.length * (message.length < 20 ? 2 : 1.5));
  const room = target - (printed.length + PSEUDO_OPEN.length + PSEUDO_CLOSE.length + 1);
  // Padding in words of four, so it breaks across lines as a longer language does.
  const padding = Array.from({ length: Math.max(0, room) }, (_, at) =>
    at % 5 === 4 ? ' ' : '~',
  ).join('');
  const padded = `${PSEUDO_OPEN}${printed} ${padding}${PSEUDO_CLOSE}`;
  return locale === 'ar-XB' ? `${RTL_OVERRIDE}${padded}${POP}` : padded;
}
