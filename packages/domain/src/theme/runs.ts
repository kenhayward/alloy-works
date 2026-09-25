import type { ResolvedParagraphStyle, ResolvedTheme } from './read.js';
import type { StyledMark, Typeface } from './schema.js';

/**
 * How a run renders, canonically and in Word. See runs.test.ts for the two Word rules that make
 * the second half necessary: the toggle rule, which reaches weight and posture, and one character
 * style to a run, which reaches every property a mark can state.
 */

export interface RunFormat {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  /** sRGB as `#rrggbb`, as the theme writes it. */
  readonly colour: string;
  readonly typeface: Typeface;
  readonly position: 'baseline' | 'subscript' | 'superscript';
  /**
   * In points: the paragraph's size times every scale the run's marks state. A subscript or a
   * superscript is not shrunk here - Word sets `w:vertAlign` at its own smaller size, and the PDF at
   * the theme's `script` - so this is the size the script is a fraction of.
   */
  readonly size: number;
}

export interface WordRun {
  /**
   * The one character style Word lets a run name: the first mark's, in the order given, whose style
   * states anything at all. A mark whose style states nothing - in the default theme a language, a
   * link and a quoted phrase, which lead the published order - would name a style that changes
   * nothing and leave the marks that do to be pinned.
   */
  readonly characterStyle?: StyledMark;
  /** Values set directly on the run, only where Word's reading of the styles would differ. */
  readonly pins: Partial<RunFormat>;
}

/**
 * The canonical rendering: the paragraph's, overridden by each mark's stated properties in the order
 * given, and its size multiplied by each mark's scale. Given a published run's marks, which are
 * outermost first (`PUBLISHED_MARK_ORDER`), the innermost mark stating a property wins, as template
 * 13 sets it - its innermost `text` is the one that applies. Two positions do not compound here as
 * the PDF's nested `sub` and `super` do: Word holds one, and a run both lowered and raised takes the
 * inner.
 */
export function runFormat(
  theme: ResolvedTheme,
  paragraph: ResolvedParagraphStyle,
  marks: readonly StyledMark[],
): RunFormat {
  let { bold, italic, colour, size } = paragraph.properties;
  let typeface = paragraph.typeface;
  let underline = false;
  let position: RunFormat['position'] = 'baseline';
  for (const mark of marks) {
    const style = theme.characterStyles[mark];
    const { properties } = style;
    if (properties.bold !== undefined) bold = properties.bold;
    if (properties.italic !== undefined) italic = properties.italic;
    if (properties.underline !== undefined) underline = properties.underline;
    if (properties.colour !== undefined) colour = properties.colour;
    if (style.typeface !== undefined) typeface = style.typeface;
    if (properties.position !== undefined) position = properties.position;
    if (properties.scale !== undefined) size *= properties.scale;
  }
  return { bold, italic, underline, colour, typeface, position, size };
}

/**
 * What Word needs: one character style, plus a direct value wherever Word's reading differs.
 *
 * Word's reading of a run is its paragraph style's, then the one character style it names:
 *
 * - a toggle property - weight and posture - is the paragraph style's value XOR the character
 *   style's `true`. An explicit `false` in a character style is not relied on either way: if the
 *   canonical value is false and the paragraph's is true, that difference is pinned like any other;
 * - every other property the character style states replaces the paragraph's, and one it does not
 *   state is the paragraph's - no underline and no position, since a paragraph style has neither;
 * - the size is always the paragraph's, since a character style states none (`ooxml.ts`).
 *
 * The typeface is compared by identifier; the writer names it by its Word face (`wordFamily`).
 */
export function wordRun(
  theme: ResolvedTheme,
  paragraph: ResolvedParagraphStyle,
  marks: readonly StyledMark[],
): WordRun {
  const canonical = runFormat(theme, paragraph, marks);
  const named = marks.find((mark) =>
    Object.values(theme.characterStyles[mark].properties).some((value) => value !== undefined),
  );
  const style = named === undefined ? undefined : theme.characterStyles[named];
  const stated = style?.properties ?? {};
  const p = paragraph.properties;
  const word: RunFormat = {
    bold: p.bold !== (stated.bold === true),
    italic: p.italic !== (stated.italic === true),
    underline: stated.underline ?? false,
    colour: stated.colour ?? p.colour,
    typeface: style?.typeface ?? paragraph.typeface,
    position: stated.position ?? 'baseline',
    size: p.size,
  };
  const pins: { -readonly [K in keyof RunFormat]?: RunFormat[K] } = {};
  if (word.bold !== canonical.bold) pins.bold = canonical.bold;
  if (word.italic !== canonical.italic) pins.italic = canonical.italic;
  if (word.underline !== canonical.underline) pins.underline = canonical.underline;
  if (word.colour !== canonical.colour) pins.colour = canonical.colour;
  if (word.typeface.id !== canonical.typeface.id) pins.typeface = canonical.typeface;
  if (word.position !== canonical.position) pins.position = canonical.position;
  if (word.size !== canonical.size) pins.size = canonical.size;
  return named === undefined ? { pins } : { characterStyle: named, pins };
}
