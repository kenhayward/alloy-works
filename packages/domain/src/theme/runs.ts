import { ThemeError, type ResolvedParagraphStyle, type ResolvedTheme } from './resolve.js';
import type { MarkName } from './schema.js';

/**
 * How a run renders, canonically and in Word. See runs.test.ts for the two Word rules that make
 * the second half necessary.
 */

export interface RunFormat {
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface WordRun {
  /** The one character style Word lets a run name: the first mark's. */
  readonly characterStyle?: MarkName;
  /** Values set directly on the run, only where Word's reading of the styles would differ. */
  readonly pins: Partial<RunFormat>;
}

/** The canonical rendering: the paragraph's, overridden by each mark's stated properties. */
export function runFormat(
  theme: ResolvedTheme,
  paragraph: ResolvedParagraphStyle,
  marks: readonly MarkName[],
): RunFormat {
  let { bold, italic } = paragraph.properties;
  for (const mark of marks) {
    const style = theme.characterStyles[mark];
    if (style === undefined) {
      throw new ThemeError('unknown-mark', `Mark "${mark}" has no character style in theme "${theme.id}"`);
    }
    if (style.bold !== undefined) bold = style.bold;
    if (style.italic !== undefined) italic = style.italic;
  }
  return { bold, italic };
}

/**
 * What Word needs: one character style, plus a direct value wherever Word's reading differs.
 *
 * Word's reading of a toggle property is the paragraph style's value XOR the character style's
 * `true`. An explicit `false` in a character style is not relied on either way - if the canonical
 * value is false and the paragraph's is true, that difference is pinned like any other.
 */
export function wordRun(
  theme: ResolvedTheme,
  paragraph: ResolvedParagraphStyle,
  marks: readonly MarkName[],
): WordRun {
  const canonical = runFormat(theme, paragraph, marks);
  const first = marks[0];
  const named = first === undefined ? undefined : theme.characterStyles[first];
  const word = {
    bold: paragraph.properties.bold !== (named?.bold === true),
    italic: paragraph.properties.italic !== (named?.italic === true),
  };
  const pins: { bold?: boolean; italic?: boolean } = {};
  if (word.bold !== canonical.bold) pins.bold = canonical.bold;
  if (word.italic !== canonical.italic) pins.italic = canonical.italic;
  return first === undefined ? { pins } : { characterStyle: first, pins };
}
