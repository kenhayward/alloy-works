import { escapeXml } from '../content/ooxml/xml.js';
import type { NumberableOutline, NumberingEntry, NumberingTable } from '../structure/numbering.js';
import { walkOutline, type OutlineMatter } from '../structure/outline.js';
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
 * `word/numbering.xml` for the headings, and after them the document's lists (Word 2, ruling R4),
 * each a definition and a `w:num` of its own (`listNumberingXml`). `links` names, by depth, the heading style the body's list is
 * linked from at that level - a style two depths share is linked from the shallower alone, since a
 * level names one style and a style one level - and a depth it does not name has no style, its
 * headings numbered by a direct `w:numPr`.
 *
 * Each level writes its number as `number` does: every part to its own depth in the format for its
 * place, the last format repeating, joined by the separator, then a space before the title, as the
 * PDF sets "1 Introduction". No indents: the heading style's stand.
 */
export function numberingXml(
  scheme: NumberingScheme,
  links: ReadonlyMap<number, string>,
  lists: readonly { readonly abstract: string; readonly num: string }[] = [],
): string {
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
    abstracts.join('') +
    lists.map((list) => list.abstract).join('') +
    nums.join('') +
    lists.map((list) => list.num).join('') +
    '</w:numbering>'
  );
}

/** What a section rule or a caption rule asks that Word does not compute as the scheme writes it. */
export interface WordNumberingProblem {
  /** The first heading or caption that meets it, or null where the rule itself cannot be written. */
  readonly node: string | null;
  /** The caption's block, or null for a heading and for a rule that cannot be written. */
  readonly block: string | null;
  /**
   * `<sequence>:<matter>:<why>`: for `section`, `separator`, `letters`, `roman` or `depth`; for
   * `figure` and `table`, `separator`, `prefix`, `restart`, `letters` or `roman`.
   */
  readonly detail: string;
}

/**
 * **What Word cannot number as the layout's scheme does** (Word 1, ruling R7; Word 2, ruling R1):
 * `numbering_not_in_word`, said before anything is written, rather than a number Word prints
 * differently from the PDF's. The section sequence and the figure and table sequences reach Word - an
 * equation's and a footnote's number arrive with the slices that write them, and are asked of then -
 * and of the section rules, four things:
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
 *
 * A caption's number is Word's fields, `captionField`, and what they compute is followed through
 * `outline` - the outline the table was numbered from, every node of which is a heading in Word - and
 * held to the table's (`captionsNotInWord`).
 */
export function numberingNotInWord(
  scheme: NumberingScheme,
  table: NumberingTable,
  outline: NumberableOutline,
): WordNumberingProblem[] {
  const rules = scheme.sequences['section']!;
  const problems: WordNumberingProblem[] = [];
  for (const matter of ['front', 'body', 'appendix'] as const) {
    if (rules[matter].separator.includes('%')) {
      problems.push({ node: null, block: null, detail: `section:${matter}:separator` });
    }
  }
  const said = new Set<string>();
  const say = (node: string, matter: OutlineMatter, why: string) => {
    const detail = `section:${matter}:${why}`;
    if (said.has(detail)) return;
    said.add(detail);
    problems.push({ node, block: null, detail });
  };
  for (const entry of table.entries) {
    if (entry.sequence !== 'section') continue;
    const rule = rules[entry.matter];
    if (entry.sections.length > WORD_LEVELS) say(entry.node, entry.matter, 'depth');
    entry.sections.forEach((value, index) => {
      const format = rule.format[Math.min(index, rule.format.length - 1)]!;
      if (lettersPart(format, value)) say(entry.node, entry.matter, 'letters');
      if (romanPart(format, value)) say(entry.node, entry.matter, 'roman');
    });
  }
  return [...problems, ...captionsNotInWord(scheme, table, outline)];
}

/** Whether a counter in letters is one Word writes otherwise: past `z`, where it doubles the letter. */
export const lettersPart = (format: NumberFormat, value: number) =>
  (format === 'lowerAlpha' || format === 'upperAlpha') &&
  wordLetters(value) !== formatCounter(value, 'lowerAlpha');

/** Whether a counter in roman numerals is past 3999, which the scheme writes in decimal. */
export const romanPart = (format: NumberFormat, value: number) =>
  (format === 'lowerRoman' || format === 'upperRoman') && value > 3999;

/** The sequences whose captions Word numbers by fields (Word 2, ruling R1). */
const CAPTIONED = ['figure', 'table'] as const;
type Captioned = (typeof CAPTIONED)[number];
const isCaptioned = (sequence: string): sequence is Captioned =>
  (CAPTIONED as readonly string[]).includes(sequence);

/**
 * Each captioned sequence's `SEQ` identifier: one per sequence, whatever the matter, since a list of
 * figures' `TOC \c` field names one; and not the label's word, which a layout may leave empty or write
 * in another language.
 */
const SEQUENCE_NAMES: Readonly<Record<Captioned, string>> = { figure: 'Figure', table: 'Table' };

/**
 * A sequence's `SEQ` name, which its captions' fields count and a list after the contents collects them
 * by (`TOC \c`); null for a sequence Word does not number by fields.
 */
export function sequenceName(sequence: string): string | null {
  return isCaptioned(sequence) ? SEQUENCE_NAMES[sequence] : null;
}

/** Each number format as a field's `\*` switch names it, by name, never by position. */
const FIELD_FORMATS: Readonly<Record<NumberFormat, string>> = {
  decimal: 'arabic',
  lowerAlpha: 'alphabetic',
  upperAlpha: 'ALPHABETIC',
  lowerRoman: 'roman',
  upperRoman: 'ROMAN',
};

/**
 * **A caption's number as Word's fields write it** (Word 2, ruling R1; measured, M3): the label's word
 * and a space; then, where the scheme prefixes this caption's number with its chapter's, `STYLEREF
 * <prefix> \s` - the number of the last heading at that level, in its matter's format - and the
 * separator; then `SEQ <sequence> \* <format>`, with `\s <restart>` where the rule restarts, counting
 * from 1 again at each heading at that level or above. Each is prefilled from the numbering table's
 * label, so a reader who never updates the fields sees the PDF's number.
 *
 * A caption the scheme writes with no prefix - one in the body before its first chapter - is the `SEQ`
 * alone, since a `STYLEREF` there would find no chapter's number, or the wrong one. Null where the
 * entry is not a figure's or a table's, and where the scheme gives it no number - a chapter-hungry rule
 * outside the body before its first chapter (`number`) - which is written with no field, so that
 * Word's count, like the scheme's, spends nothing on it.
 */
export interface CaptionField {
  /** The label's word, `Figure`; empty where the layout gives none. */
  readonly word: string;
  /** The heading level whose number `STYLEREF` gives before the counter, or null for none. */
  readonly prefix: number | null;
  /** Written between the prefix and the counter, where there is a prefix. */
  readonly separator: string;
  /** The `SEQ` field's identifier. */
  readonly sequence: string;
  /** The format its `\*` switch names. */
  readonly format: string;
  /** The heading level `\s` counts from 1 again at, or null where the rule never restarts. */
  readonly restart: number | null;
}

export function captionField(scheme: NumberingScheme, entry: NumberingEntry): CaptionField | null {
  if (!isCaptioned(entry.sequence) || entry.label === null) return null;
  const rule = scheme.sequences[entry.sequence]?.[entry.matter];
  if (rule === undefined) return null;
  // As `number` writes it: a prefix where one of its parts is a chapter's number.
  const prefixed =
    rule.prefix !== null && entry.sections.slice(0, rule.prefix).some((part) => part > 0);
  return {
    word: rule.label,
    prefix: prefixed ? rule.prefix : null,
    separator: rule.separator,
    sequence: SEQUENCE_NAMES[entry.sequence],
    format: FIELD_FORMATS[rule.format[rule.format.length - 1]!],
    restart: rule.restartAt,
  };
}

/**
 * **What Word's caption fields compute, followed through the document as Word reads it** (Word 2,
 * ruling R1), held to what the scheme wrote. Word's reading, measured in Word 16 - M3 at the first
 * level, and for this slice at the second, after a heading with no number, and before any heading:
 *
 * - every node is a heading in the style for its depth, the ninth's for any deeper, numbered or not;
 * - `STYLEREF n \s` gives the whole number of the last heading at level `n` before it - a shallower
 *   heading since does not clear it - and 0 for a heading with no number;
 * - `SEQ x \s n` counts from 1 again where a heading at level `n` or above, numbered or not, stands
 *   between it and the last `SEQ x`, and `SEQ x` alone carries on; one identifier counts through every
 *   matter.
 *
 * So a caption is refused, `<sequence>:<matter>:<why>`, once per matter and naming the first caption
 * that meets it, where:
 *
 * - `separator`: its number is prefixed and the separator holds a character a run cannot carry;
 * - `prefix`: the heading `STYLEREF` finds is not the one whose number the scheme wrote - one with no
 *   number, one in another matter, one from an earlier chapter, or none, as past the ninth level;
 * - `restart`: the rule restarts past the ninth level, where no heading style is, or Word's count is
 *   not the scheme's - after a heading with no number, or across matters the scheme counts apart;
 * - `letters` and `roman`: its counter, as a heading's is judged.
 */
function captionsNotInWord(
  scheme: NumberingScheme,
  table: NumberingTable,
  outline: NumberableOutline,
): WordNumberingProblem[] {
  const headings = new Map<string, NumberingEntry>();
  const captions = new Map<string, NumberingEntry[]>();
  for (const entry of table.entries) {
    if (entry.sequence === 'section') headings.set(entry.node, entry);
    else if (isCaptioned(entry.sequence)) {
      captions.set(entry.node, [...(captions.get(entry.node) ?? []), entry]);
    }
  }
  const problems: WordNumberingProblem[] = [];
  const said = new Set<string>();
  const say = (entry: NumberingEntry, why: string) => {
    const detail = `${entry.sequence}:${entry.matter}:${why}`;
    if (said.has(detail)) return;
    said.add(detail);
    problems.push({ node: entry.node, block: entry.block, detail });
  };
  /** The last heading Word has met at each level: its section entry, or null where it has no number. */
  const last = new Map<number, NumberingEntry | null>();
  /** Each `SEQ` identifier's last count, and the shallowest heading level met since. */
  const counts = new Map<string, { value: number; since: number }>();
  // A node's heading, then its occurrence's captions, then its children: the order `number` walks in.
  walkOutline(outline.nodes, (node, depth) => {
    const level = Math.min(depth, WORD_LEVELS);
    last.set(level, headings.get(node.id) ?? null);
    for (const count of counts.values()) count.since = Math.min(count.since, level);
    for (const entry of captions.get(node.id) ?? []) {
      const field = captionField(scheme, entry);
      if (field === null || entry.value === null) continue;
      if (field.prefix !== null) {
        if (!writable(field.separator)) say(entry, 'separator');
        const heading = last.get(field.prefix);
        const wrote = entry.sections.slice(0, field.prefix);
        const found =
          heading?.matter === entry.matter &&
          heading.sections.length === field.prefix &&
          heading.sections.every((part, index) => part === wrote[index]);
        if (!found) say(entry, 'prefix');
      }
      const previous = counts.get(field.sequence);
      const value =
        previous === undefined || (field.restart !== null && previous.since <= field.restart)
          ? 1
          : previous.value + 1;
      counts.set(field.sequence, { value, since: Infinity });
      if ((field.restart !== null && field.restart > WORD_LEVELS) || value !== entry.value) {
        say(entry, 'restart');
      }
      const rule = scheme.sequences[entry.sequence]![entry.matter];
      const format = rule.format[rule.format.length - 1]!;
      if (lettersPart(format, entry.value)) say(entry, 'letters');
      if (romanPart(format, entry.value)) say(entry, 'roman');
    }
  });
  return problems;
}

/**
 * Whether a run carries a caption's separator as it is: no control character but a tab and a line
 * feed, which the writer writes as `w:tab` and `w:br`, and neither of the noncharacters XML refuses. A
 * carriage return is refused too, since XML reads it as a line feed.
 */
function writable(text: string): boolean {
  return [...text].every((character) => {
    const codePoint = character.codePointAt(0)!;
    if (codePoint === 0x09 || codePoint === 0x0a) return true;
    return codePoint >= 0x20 && codePoint !== 0xfffe && codePoint !== 0xffff;
  });
}

/** A counter in letters as Word writes one (ECMA-376, `lowerLetter`): the letter, repeated per round. */
function wordLetters(value: number): string {
  if (value < 1) return formatCounter(value, 'lowerAlpha');
  const letter = String.fromCharCode(97 + ((value - 1) % 26));
  return letter.repeat(Math.ceil(value / 26));
}
