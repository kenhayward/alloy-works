import { escapeXml } from '../content/ooxml/xml.js';
import type { NumberingTable } from '../structure/numbering.js';
import type { OutlineMatter } from '../structure/outline.js';
import { formatCounter, type NumberFormat, type NumberingScheme } from '../structure/scheme.js';

/**
 * A heading's number as Word computes it (Word 1, ruling R7; measured, M2): one numbering definition
 * per matter, from the layout's section rules. The body's is linked from the heading styles, level by
 * level, so a heading in the body is numbered by its style alone; front matter's and the appendices'
 * are given to their headings by a direct `w:numPr`, which is how one style prints "i", "1" and "A"
 * in the three matters. Word keeps each list's counters across the document, so a body heading after
 * an appendix carries on the body's numbering, as `number` does.
 *
 * The number is Word's, never the heading's text (PUB-024): a recipient who adds a section sees every
 * later number move, as it would have in the PDF had the author added it.
 */

/** Each matter's list, by its `w:numId`: the body's first, since the heading styles link to it. */
export const HEADING_LISTS: Readonly<Record<OutlineMatter, number>> = {
  body: 1,
  front: 2,
  appendix: 3,
};

/** The levels Word numbers: nine, `w:ilvl` 0 to 8 (WO-I). */
export const WORD_LEVELS = 9;

/** The order the definitions are written in, which is the order of their identifiers. */
const MATTERS = ['body', 'front', 'appendix'] as const satisfies readonly OutlineMatter[];

/**
 * Each number format as `ST_NumberFormat` spells it, by name, never by position: a heading's number
 * and a page's alike.
 */
export const WORD_FORMATS: Readonly<Record<NumberFormat, string>> = {
  decimal: 'decimal',
  lowerAlpha: 'lowerLetter',
  upperAlpha: 'upperLetter',
  lowerRoman: 'lowerRoman',
  upperRoman: 'upperRoman',
};

/**
 * `word/numbering.xml` for the headings. `links` names, by depth, the heading style the body's list is
 * linked from at that level - a style two depths share is linked from the shallower alone, since a
 * level names one style and a style one level - and a depth it does not name has no style, its
 * headings numbered by a direct `w:numPr`.
 *
 * Each level writes its number as `number` does: every part to its own depth in the format for its
 * place, the last format repeating, joined by the separator, then a space before the title, as the
 * PDF sets "1 Introduction". No indents: the heading style's stand.
 */
export function numberingXml(scheme: NumberingScheme, links: ReadonlyMap<number, string>): string {
  const abstracts = MATTERS.map((matter) => {
    const rule = scheme.sequences['section']![matter];
    const levels = Array.from({ length: WORD_LEVELS }, (_, ilvl) => {
      const format = rule.format[Math.min(ilvl, rule.format.length - 1)]!;
      const text = Array.from({ length: ilvl + 1 }, (_, part) => `%${part + 1}`).join(
        rule.separator,
      );
      const style = matter === 'body' ? links.get(ilvl + 1) : undefined;
      return (
        `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/>` +
        `<w:numFmt w:val="${WORD_FORMATS[format]}"/>` +
        (style === undefined ? '' : `<w:pStyle w:val="${style}"/>`) +
        `<w:suff w:val="space"/><w:lvlText w:val="${escapeXml(text)}"/>` +
        '<w:lvlJc w:val="left"/></w:lvl>'
      );
    });
    return (
      `<w:abstractNum w:abstractNumId="${HEADING_LISTS[matter]}">` +
      `<w:multiLevelType w:val="multilevel"/>${levels.join('')}</w:abstractNum>`
    );
  });
  const nums = MATTERS.map(
    (matter) =>
      `<w:num w:numId="${HEADING_LISTS[matter]}">` +
      `<w:abstractNumId w:val="${HEADING_LISTS[matter]}"/></w:num>`,
  );
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `${abstracts.join('')}${nums.join('')}</w:numbering>`
  );
}

/** What a section rule asks that Word does not compute as the scheme writes it. */
export interface WordNumberingProblem {
  /** The first heading that meets it, or null where the rule itself cannot be written. */
  readonly node: string | null;
  /** `section:<matter>:<why>` - `separator`, `letters`, `roman` or `depth`. */
  readonly detail: string;
}

/**
 * **What Word cannot number as the layout's scheme does** (Word 1, ruling R7): `numbering_not_in_word`,
 * said before anything is written, rather than a number Word prints differently from the PDF's. Only
 * the section sequence reaches Word in this slice - a caption's, an equation's and a footnote's number
 * arrive with the slices that write them, and are asked of then - and of its rules, four things:
 *
 * - **a separator holding `%`**, which a level's text reads as a number to come (`%1`); asked of every
 *   matter, whether or not it numbers anything here, since each definition is written all the same;
 * - **letters past `z`**: the scheme counts on as a spreadsheet's columns do (`z`, `aa`, `ab`) and Word
 *   doubles the letter (`z`, `aa`, `bb`), so the two agree to the 27th and part from the 28th;
 * - **a roman numeral past 3999**, which the scheme writes in decimal and Word in its own way;
 * - **a heading numbered past the ninth level**, where Word has no level (WO-I). One that is not
 *   numbered is asked for no number, and is not refused.
 *
 * The last three depend on the numbers the document holds, so each is said once per matter, naming
 * the first heading that meets it. Nothing else is: a section rule's format, its separator and its
 * restart - which the section sequence never has - are Word's own, measured (M2), and a matter
 * re-entered carries on its list as `number` carries on its counters.
 */
export function numberingNotInWord(
  scheme: NumberingScheme,
  table: NumberingTable,
): WordNumberingProblem[] {
  const rules = scheme.sequences['section']!;
  const problems: WordNumberingProblem[] = [];
  for (const matter of ['front', 'body', 'appendix'] as const) {
    if (rules[matter].separator.includes('%')) {
      problems.push({ node: null, detail: `section:${matter}:separator` });
    }
  }
  const said = new Set<string>();
  const say = (node: string, matter: OutlineMatter, why: string) => {
    const detail = `section:${matter}:${why}`;
    if (said.has(detail)) return;
    said.add(detail);
    problems.push({ node, detail });
  };
  for (const entry of table.entries) {
    if (entry.sequence !== 'section') continue;
    const rule = rules[entry.matter];
    if (entry.sections.length > WORD_LEVELS) say(entry.node, entry.matter, 'depth');
    entry.sections.forEach((value, index) => {
      const format = rule.format[Math.min(index, rule.format.length - 1)]!;
      if (
        (format === 'lowerAlpha' || format === 'upperAlpha') &&
        wordLetters(value) !== formatCounter(value, 'lowerAlpha')
      ) {
        say(entry.node, entry.matter, 'letters');
      }
      if ((format === 'lowerRoman' || format === 'upperRoman') && value > 3999) {
        say(entry.node, entry.matter, 'roman');
      }
    });
  }
  return problems;
}

/** A counter in letters as Word writes one (ECMA-376, `lowerLetter`): the letter, repeated per round. */
function wordLetters(value: number): string {
  if (value < 1) return formatCounter(value, 'lowerAlpha');
  const letter = String.fromCharCode(97 + ((value - 1) % 26));
  return letter.repeat(Math.ceil(value / 26));
}
