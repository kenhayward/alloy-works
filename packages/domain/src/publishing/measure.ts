import type { ListNode } from '../content/model/blocks.js';
import { formatCounter } from '../structure/scheme.js';
import type { ResolvedParagraphStyle } from '../theme/read.js';
import type { ImageLength, ImageStyle } from '../theme/schema.js';

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
 *
 * **What `assemble` measures from the theme, which templates 12 and 13 keep** (themes 1, ruling R6;
 * themes 2, ruling R5). Every room `assemble` works out before the engine runs is read from the theme
 * the document is set from, so the template must lay the page out by the same numbers, or a line
 * `assemble` passed runs off it:
 *
 * - **Preformatted text** is set in the `preformatted` role's style: one column is its size times its
 *   face's advance, and its measure loses the style's start and end indents and, where it has a fill,
 *   its padding on each side (`columnsAt`).
 * - **A block quotation** is inset by exactly the `quotation` place's style's start and end indents,
 *   and nothing else: the template stops the engine's own inset of a quotation.
 * - **A list** indents its content, at each level, by template 11's number of ems - two for a
 *   definition list, and otherwise the widest marker it prints at an em a character and half an em
 *   after it - in ems of the `listItem` place's style's size (`listIndent`).
 * - **A figure's caption** is estimated in ems of the `caption` role's style's size (`captionHeight`).
 * - **An image** is printed at the size its image style gives it (`styledSize`, themes 2): the
 *   dimension the style fixes, in points, a share of the measure, a share of the text block's height or,
 *   in a line of text, ems of the size of the paragraph style it stands in, or of the role's style that
 *   sets the text it stands in (a term the `listItem` place's, an attribution or a table's note its
 *   role's); the other from its proportions; both held to the style's maximum. Template 13 prints it at
 *   exactly that size, which is why the size is here and not in the template.
 * - **A table's cell** insets what it holds by its table style's padding on each side, which template 13
 *   sets as the cell's inset; its rules are drawn over the cell's edges and take no room from it.
 *
 * Under the default theme each gives the answer the fixed numbers gave before themes 1: the default
 * image styles are template 11's rules - a figure the measure wide and at most 0.6 of the text block
 * high, an image in a line 1.2 ems high - and the default table style pads 5 points, the engine's.
 */

/** Tab stops every eight columns: the stop POSIX `expand`, a terminal and `cat` use (decision E). */
export const TAB_STOP = 8;
/**
 * The body text's size before themes 1, in points: what the maths tree turns a length in points into
 * ems of, and the size a request made before layouts, which has no theme, is measured in.
 */
export const BODY_SIZE = 11;
/** A definition hangs two ems of its item's size beneath its term. */
export const DEFINITION_EMS = 2;

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
 * How tall a figure's caption may stand below its image, in points, estimated **generously** - more
 * than it takes, never less - since `assemble` has no font metrics and a figure does not break, so
 * a caption longer than the room below its image would run off its page (figures 3, final review).
 * In ems of `size`, the `caption` role's style's (themes 1): each grapheme is taken as 0.6 em, wider
 * than an ordinary letter of Liberation Serif; one line more than that fills is added for words that
 * wrap early; each line is 1.5 em, above the template's measured pitch; and an em stands between the
 * image and its caption, above the engine's gap. A caption of capitals throughout may still be
 * under-estimated, which is the known limit.
 */
export function captionHeight(graphemes: number, width: number, size: number): number {
  const lines = Math.ceil((graphemes * CAPTION_ADVANCE * size) / width) + 1;
  return lines * CAPTION_LINE * size + CAPTION_GAP * size;
}

/**
 * What an image style's lengths are shares of where the image stands (themes 2, ruling R5): the
 * layout's measure, the width of its text block, which is the column the editor shows; the height of
 * its text block; and the size of the text an image in a line stands in, which an em is. The room where
 * the image stands - less than the measure in a quotation, a list or a table's cell - is not among
 * them: a share of the measure is the same in a quotation as outside it, and the room is held to after.
 */
export interface ImageFrame {
  readonly measure: number;
  readonly textHeight: number;
  readonly size: number;
}

/** One of an image style's lengths in points, where the image stands. */
export function imageLength(length: ImageLength, frame: ImageFrame): number {
  switch (length.unit) {
    case 'pt':
      return length.value;
    case 'measure':
      return length.value * frame.measure;
    case 'textHeight':
      return length.value * frame.textHeight;
    case 'em':
      return length.value * frame.size;
  }
}

/**
 * The size an image is printed at by its style (STY-015 to STY-017), in points, from its pixels as
 * displayed: the dimension the style fixes at the length it gives; the other **from the image's own
 * proportions**, so an image is never distorted (STY-016); and where that other would be more than the
 * style's maximum, the maximum instead, the fixed one re-derived from it, the proportion kept
 * (STY-017). Under the default theme a figure is the measure wide and at most 0.6 of the text block
 * high, and an image in a line 1.2 ems of its text high - template 11's rules, as before.
 */
export function styledSize(
  style: Pick<ImageStyle, 'fixed' | 'maximum'>,
  pixels: { readonly width: number; readonly height: number },
  frame: ImageFrame,
): { readonly width: number; readonly height: number } {
  const fixed = imageLength(style.fixed, frame);
  const most = imageLength(style.maximum, frame);
  if (style.fixed.dimension === 'width') {
    const height = (fixed * pixels.height) / pixels.width;
    return height > most
      ? { width: (most * pixels.width) / pixels.height, height: most }
      : { width: fixed, height };
  }
  const width = (fixed * pixels.width) / pixels.height;
  return width > most
    ? { width: most, height: (most * pixels.height) / pixels.width }
    : { width, height: fixed };
}

/** A caption's grapheme taken as this many ems across. */
export const CAPTION_ADVANCE = 0.6;
/** A caption's line taken as this many ems down. */
export const CAPTION_LINE = 1.5;
/** Between an image and its caption, taken as an em. */
export const CAPTION_GAP = 1;

/**
 * How far a list's content stands in from its own edge, in points: two ems for a definition list,
 * and otherwise the widest marker the list prints, at a full em a character, and half an em after
 * it - ems of `size`, the `listItem` place's style's (themes 1). **Deliberately conservative**
 * (#164): `assemble` has no font metrics, and an em a character is wider than every marker the
 * engine was measured setting, so a line inside a numbered list may be refused that would have
 * fitted - never the reverse.
 */
export function listIndent(list: ListNode, size: number): number {
  if (list.kind === 'definition') return DEFINITION_EMS * size;
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
  return size * widest + size / 2;
}

/**
 * How many columns of preformatted text fit where a block stands, `indent` points in from the text
 * block, set in `preformatted` - the theme's style for the `preformatted` role (themes 1, ruling R6):
 * one column is the style's size times its face's advance, which the reader requires of that face
 * (`preformatted_not_monospaced`), and the measure loses the style's own indents at each end and, where
 * it has a fill, the padding between the fill's edge and the text on each side. Under the default theme
 * - 8.8pt of Liberation Mono, 1229/2048 of an em a column, 6pt of padding - this is the answer the
 * fixed `CODE_SIZE`, `CODE_ADVANCE` and `PANEL_INSET` gave before themes 1.
 */
export function columnsAt(
  format: PublishedPdfFormat,
  indent: number,
  preformatted: ResolvedParagraphStyle,
): number {
  const { size, startIndent, endIndent, background, padding } = preformatted.properties;
  const advance = size * preformatted.typeface.advance!;
  const panel = background === 'none' ? 0 : 2 * padding;
  return Math.floor((textMeasure(format) - indent - startIndent - endIndent - panel) / advance);
}
