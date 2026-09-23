import type { ListNode } from '../content/model/blocks.js';
import { formatCounter } from '../structure/scheme.js';

import type { PublishedPdfFormat } from './published.js';

/**
 * How wide a line of preformatted text may be where it stands, in columns, computed before the
 * engine runs (editor 5, decision F). A line wider than its place is **refused, never wrapped and
 * never clipped**: a wrap is a break a reader cannot tell from one the author made, and a clipped
 * line runs off the page with no warning - both measured against the pinned engine, and both wrong
 * for CNT-018, which keeps whitespace exactly.
 *
 * Every number here is **measured against the pinned engine and faces**, not chosen, and the template
 * asserts the same bound per line as a backstop that must never fire (task 8).
 */

/** Tab stops every eight columns: the stop POSIX `expand`, a terminal and `cat` use (decision E). */
export const TAB_STOP = 8;
/** The body text's size, in points: what a list marker is set at. */
export const BODY_SIZE = 11;
/** Preformatted text's size, in points: Typst's `raw` at 0.8 em of the body, set explicitly. */
export const CODE_SIZE = 8.8;
/** One column of Liberation Mono at `CODE_SIZE`: it advances 1229/2048 of an em, 5.28 pt measured. */
export const CODE_ADVANCE = (CODE_SIZE * 1229) / 2048;
/** The panel a preformatted block is set in insets its text this much on each side. */
export const PANEL_INSET = 6;
/**
 * A quotation indents its body by one em of the body text **on each side**: the engine pads a block
 * quotation horizontally, so it costs twice this of the width a line inside it has. Measured by task
 * 9's PDF test, where an attribution aligned to a quotation's end stood one em short of the page's.
 */
export const QUOTATION_INDENT = 11;
/** A definition hangs two ems beneath its term. */
export const DEFINITION_INDENT = 22;

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * How many columns a line takes: one per **grapheme cluster**, which is what a reader sees as a
 * character - a letter and the combining accent over it are one column, not two (final review,
 * finding 8). The surface counts the same way, so the two agree on where a tab lands.
 */
export function columnsOf(line: string): number {
  return [...graphemes.segment(line)].length;
}

/**
 * One line with each tab expanded to the next stop, counting **grapheme clusters**, as the column
 * measure below counts them. The stored text keeps its tabs; only what is set
 * is expanded, because the engine ignores `tab-size` without a language and a language deletes
 * whitespace (spike 2).
 */
export function expandTabs(line: string): string {
  let column = 0;
  let out = '';
  for (const { segment } of graphemes.segment(line)) {
    if (segment === '\t') {
      const pad = TAB_STOP - (column % TAB_STOP);
      out += ' '.repeat(pad);
      column += pad;
    } else {
      out += segment;
      column += 1;
    }
  }
  return out;
}

/** The width of the text block the template lays pages out with: across, less both margins and the gutter. */
export function textMeasure(format: PublishedPdfFormat): number {
  const across = format.orientation === 'landscape' ? format.height : format.width;
  return across - format.margins.inside - format.gutter - format.margins.outside;
}

/**
 * The height of the text block the template lays pages out in: down, less the top and bottom margins,
 * where the running head and foot stand. What a figure is kept to a share of (figures 3, ruling R3).
 */
export function textBlockHeight(format: PublishedPdfFormat): number {
  const down = format.orientation === 'landscape' ? format.width : format.height;
  return down - format.margins.top - format.margins.bottom;
}

/**
 * How far a list's content stands in from its own edge, in points: two ems for a definition list,
 * and otherwise the widest marker the list prints, at a full em a character, and half an em after
 * it. **Deliberately conservative** (#164): `assemble` has no font metrics, and an em a character is
 * wider than every marker the engine was measured setting, so a line inside a numbered list may be
 * refused that would have fitted - never the reverse.
 */
export function listIndent(list: ListNode): number {
  if (list.kind === 'definition') return DEFINITION_INDENT;
  let widest = 1;
  if (list.kind === 'ordered') {
    const format =
      list.format === 'roman'
        ? 'lowerRoman'
        : list.format === 'alphabetic'
          ? 'lowerAlpha'
          : 'decimal';
    const first = list.start ?? 1;
    for (let number = first; number < first + list.items.length; number += 1) {
      widest = Math.max(widest, [...formatCounter(number, format)].length + 1);
    }
  }
  return BODY_SIZE * widest + BODY_SIZE / 2;
}

/** How many columns of preformatted text fit where a block stands, `indent` points in from the text block. */
export function columnsAt(format: PublishedPdfFormat, indent: number): number {
  return Math.floor((textMeasure(format) - 2 * PANEL_INSET - indent) / CODE_ADVANCE);
}
