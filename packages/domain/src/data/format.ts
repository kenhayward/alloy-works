import { DEFAULT_VALUE_FORMATS } from '../theme/default.js';
import type { ValueCatalogue, ValueFormats } from '../theme/schema.js';
import type { ValueType } from './columns.js';

/**
 * **A value as it is printed** (bindings.md, "Formatting"; the B1 plan, B1-G): the domain's own code
 * over what the theme's value catalogue declares, with no locale data and nothing of the platform's,
 * because the editor runs in Chromium and Electron and the worker in Node, each with its own ICU and
 * CLDR, and one pure function over declared separators prints the same characters in all of them.
 */

/** A token the catalogue stores, as the character it stands for. */
const CHARACTER: Readonly<Record<string, string>> = {
  'U+00A0': String.fromCodePoint(0xa0),
  'U+202F': String.fromCodePoint(0x202f),
  'U+002D': '-',
  'U+2212': String.fromCodePoint(0x2212),
};

const character = (token: string): string => CHARACTER[token] ?? token;

/** Every line break - CR LF, LF, CR, NEL, LS, PS - and a tab: each printed as one space. */
const BREAK = new RegExp(
  `\\r\\n|[\\n\\r\\t${String.fromCodePoint(0x85)}${String.fromCodePoint(0x2028)}${String.fromCodePoint(0x2029)}]`,
  'gu',
);

/** Digits grouped in threes from the right, once there are `groupFrom` of them. */
function grouped(digits: string, number: ValueFormats['number']): string {
  if (number.group === 'none' || digits.length < number.groupFrom) return digits;
  const group = character(number.group);
  const head = digits.length % 3 || 3;
  const groups = [digits.slice(0, head)];
  for (let at = head; at < digits.length; at += 3) groups.push(digits.slice(at, at + 3));
  return groups.join(group);
}

/** A canonical integer or decimal, its whole part grouped and its places exactly `scale`. */
function numeral(canonical: string, scale: number, number: ValueFormats['number']): string {
  const negative = canonical.startsWith('-');
  const [whole, places = ''] = (negative ? canonical.slice(1) : canonical).split('.');
  const sign = negative ? character(number.minus) : '';
  const fraction = scale > 0 ? `${number.decimal}${places.padEnd(scale, '0')}` : '';
  return `${sign}${grouped(whole!, number)}${fraction}`;
}

/** A canonical date, `YYYY-MM-DD`, in the declared order and separator, its year four digits. */
function date(canonical: string, f: ValueFormats['date']): string {
  const [year, month, day] = canonical.split('-') as [string, string, string];
  const unpadded = (part: string) => (f.pad ? part : String(Number(part)));
  const parts = { y: year, m: unpadded(month), d: unpadded(day) };
  return [...f.order].map((part) => parts[part as 'y' | 'm' | 'd']).join(f.separator);
}

/** A canonical time, its fraction to the column's declared digits after the decimal separator. */
function time(canonical: string, fraction: number, f: ValueFormats): string {
  const [clock, places = ''] = canonical.split('.');
  const printed = clock!.split(':').join(f.time.separator);
  return fraction > 0 ? `${printed}${f.number.decimal}${places.padEnd(fraction, '0')}` : printed;
}

/**
 * **The one function a value is printed by** (B1-G): the editor's node view, the read text, and
 * later the Typst projection and the Word writer all print what it returns. `value` is canonical in
 * `type` (ADR-0035), as `takeValue` answered it.
 *
 * - An integer is grouped in threes once it has `groupFrom` digits; a decimal is printed at exactly
 *   its declared scale, its canonical form's trailing zeros put back, never rounded; the minus as
 *   declared.
 * - A date in its order and separator, day and month padded by `pad`, the year always four digits.
 * - A time `HH`, `MM`, `SS` joined by its separator, its fraction to the column's declared digits
 *   after the decimal separator; a local date-time the date, a space and the time; an instant the
 *   same in UTC followed by a space and `UTC`, since a document has no time zone.
 * - A boolean in its declared words; text as it is, each line break and tab one space.
 */
export function formatValue(value: string | boolean, type: ValueType, f: ValueFormats): string {
  if (typeof value === 'boolean') return value ? f.boolean.true : f.boolean.false;
  switch (type.base) {
    case 'integer':
      return numeral(value, 0, f.number);
    case 'decimal':
      return numeral(value, type.scale, f.number);
    case 'date':
      return date(value, f.date);
    case 'time':
      return time(value, type.fraction, f);
    case 'localDateTime':
    case 'instant': {
      const bare = type.base === 'instant' ? value.slice(0, -1) : value;
      const at = bare.indexOf('T');
      const printed = `${date(bare.slice(0, at), f.date)} ${time(bare.slice(at + 1), type.fraction, f)}`;
      return type.base === 'instant' ? `${printed} UTC` : printed;
    }
    case 'boolean':
      return value;
    case 'text':
      return value.replace(BREAK, ' ');
  }
}

/**
 * **The formats a value is printed by in a document** (B1-G): the value catalogue's formats for the
 * document's language - the outline's `language`, its primary subtag lowercased - else the
 * catalogue's own, or the product's default (`DEFAULT_VALUE_FORMATS`) where the theme names no value
 * catalogue, as every theme before the default's 0.6.
 */
export function formatsFor(
  catalogue: ValueCatalogue | null,
  language: string | null,
): ValueFormats {
  if (catalogue === null) return DEFAULT_VALUE_FORMATS;
  const primary = language?.split('-')[0]?.toLowerCase();
  return (
    catalogue.byLanguage.find((each) => each.language === primary)?.formats ?? catalogue.formats
  );
}
