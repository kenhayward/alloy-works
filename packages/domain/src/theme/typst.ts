import type { ResolvedTheme } from './resolve.js';
import { markNames, type MarkName } from './schema.js';

/**
 * The PDF's projection: resolved styles as data for the fixed Typst template (ADR-0013). It is
 * serialised as theme.json; the template reads values and evaluates nothing, so no theme - however
 * its names are spelled - can become code in the publishing pipeline.
 */

export interface TypstStyle {
  readonly font: string;
  readonly size: number;
  readonly weight: 'regular' | 'bold';
  readonly style: 'normal' | 'italic';
  readonly fill: string;
  readonly firstLineIndent: number;
  readonly spaceBefore: number;
  readonly spaceAfter: number;
  readonly lineSpacing: number;
  readonly keepWithNext: boolean;
}

export interface TypstMark {
  readonly weight?: 'regular' | 'bold';
  readonly style?: 'normal' | 'italic';
}

export interface TypstTheme {
  readonly paper: string;
  readonly styles: Readonly<Record<string, TypstStyle>>;
  readonly marks: Readonly<Partial<Record<MarkName, TypstMark>>>;
}

export function projectTypst(theme: ResolvedTheme): TypstTheme {
  const styles: Record<string, TypstStyle> = {};
  for (const style of theme.paragraphStyles) {
    const p = style.properties;
    const face = theme.typefaces[p.typeface];
    if (face === undefined) throw new Error(`Unresolved typeface "${p.typeface}"`);
    styles[style.id] = {
      font: face.family,
      size: p.size,
      weight: p.bold ? 'bold' : 'regular',
      style: p.italic ? 'italic' : 'normal',
      fill: p.colour,
      firstLineIndent: p.firstLineIndent,
      spaceBefore: p.spaceBefore,
      spaceAfter: p.spaceAfter,
      lineSpacing: p.lineSpacing,
      keepWithNext: p.keepWithNext,
    };
  }

  const marks: Partial<Record<MarkName, TypstMark>> = {};
  for (const mark of markNames) {
    const style = theme.characterStyles[mark];
    if (style === undefined) continue;
    const out: { weight?: 'regular' | 'bold'; style?: 'normal' | 'italic' } = {};
    if (style.bold !== undefined) out.weight = style.bold ? 'bold' : 'regular';
    if (style.italic !== undefined) out.style = style.italic ? 'italic' : 'normal';
    marks[mark] = out;
  }

  return { paper: theme.paper, styles, marks };
}
