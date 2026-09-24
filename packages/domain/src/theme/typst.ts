import type { ResolvedParagraphStyle, ResolvedTheme } from './read.js';
import { STYLED_MARKS, type Place, type Role, type StyledMark } from './schema.js';

/**
 * The PDF's projection: resolved styles as data for the fixed Typst template (ADR-0013), carried as
 * `publishing/12`'s `theme` (themes 1, ruling R6). The template reads values and evaluates nothing, so
 * no theme - however its names are spelled - can become code in the publishing pipeline. Every value is
 * already in the engine's own terms - a weight, a posture, an alignment and whether to justify, a fill
 * or `null` for none - so the template translates nothing either, and holds no typographic literal of
 * its own: the maths face is here too.
 */

export interface TypstParagraphStyle {
  readonly font: string;
  readonly size: number;
  readonly weight: 'regular' | 'bold';
  readonly style: 'normal' | 'italic';
  readonly fill: string;
  /** The paragraph's fill, or null where it has none. */
  readonly background: string | null;
  /** Justified text is aligned to the start and justified, as the engine says it. */
  readonly align: 'start' | 'center' | 'end';
  readonly justify: boolean;
  readonly firstLineIndent: number;
  readonly startIndent: number;
  readonly endIndent: number;
  readonly spaceBefore: number;
  readonly spaceAfter: number;
  readonly lineSpacing: number;
  /** `sticky`, measured (TH-D). */
  readonly keepWithNext: boolean;
  /** `breakable: false`, measured. */
  readonly keepTogether: boolean;
  /** The widow and orphan costs at 100%, or at 0% where off, measured. */
  readonly widowControl: boolean;
  readonly hyphenate: boolean;
  /** The face's descender, in ems: where the template puts the baseline inside a line (STY-054). */
  readonly descent: number;
  /** Points between one line's box and the next: line spacing less one em (ADR-0014). */
  readonly leading: number;
}

/** A mark's rendering: only what its character style states. */
export interface TypstMark {
  readonly weight?: 'regular' | 'bold';
  readonly style?: 'normal' | 'italic';
  readonly underline?: boolean;
  readonly fill?: string;
  readonly font?: string;
  readonly position?: 'subscript' | 'superscript';
}

export interface TypstTheme {
  readonly paper: string;
  /** The family every equation is set in. */
  readonly maths: string;
  /** By identifier. */
  readonly styles: Readonly<Record<string, TypstParagraphStyle>>;
  readonly marks: Readonly<Record<StyledMark, TypstMark>>;
  /** Each place's default style's identifier: what a stored `body` resolves to there. */
  readonly places: Readonly<Record<Place, string>>;
  /** Each role's style's identifier. */
  readonly roles: Readonly<Record<Role, string>>;
}

/**
 * The theme for the template. Given the identifiers a document uses, it projects those and every style
 * a place or a role names, which the template may reach whatever the document holds; given none, every
 * style. An identifier the theme lacks is a defect of the caller's: `assemble` refuses a document's own
 * as `style_missing` before it asks.
 */
export function projectTypst(theme: ResolvedTheme, used?: Iterable<string>): TypstTheme {
  const wanted =
    used === undefined
      ? new Set(theme.paragraphStyles.keys())
      : new Set([...used, ...Object.values(theme.places), ...Object.values(theme.roles)]);

  for (const id of wanted) {
    if (!theme.paragraphStyles.has(id)) throw new Error(`The theme has no paragraph style ${id}`);
  }
  // In the catalogue's order, whatever order they were asked for in.
  const styles = Object.fromEntries(
    [...theme.paragraphStyles.values()]
      .filter((style) => wanted.has(style.id))
      .map((style) => [style.id, paragraph(style)]),
  );

  const marks = Object.fromEntries(
    STYLED_MARKS.map((mark) => {
      const { properties, typeface } = theme.characterStyles[mark];
      const out: {
        weight?: 'regular' | 'bold';
        style?: 'normal' | 'italic';
        underline?: boolean;
        fill?: string;
        font?: string;
        position?: 'subscript' | 'superscript';
      } = {};
      if (properties.bold !== undefined) out.weight = properties.bold ? 'bold' : 'regular';
      if (properties.italic !== undefined) out.style = properties.italic ? 'italic' : 'normal';
      if (properties.underline !== undefined) out.underline = properties.underline;
      if (properties.colour !== undefined) out.fill = properties.colour;
      if (typeface !== undefined) out.font = typeface.family;
      if (properties.position !== undefined) out.position = properties.position;
      return [mark, out];
    }),
  ) as Record<StyledMark, TypstMark>;

  return {
    paper: theme.paper,
    maths: theme.maths.family,
    styles,
    marks,
    places: { ...theme.places },
    roles: { ...theme.roles },
  };
}

function paragraph(style: ResolvedParagraphStyle): TypstParagraphStyle {
  const p = style.properties;
  return {
    font: style.typeface.family,
    size: p.size,
    weight: p.bold ? 'bold' : 'regular',
    style: p.italic ? 'italic' : 'normal',
    fill: p.colour,
    background: p.background === 'none' ? null : p.background,
    align: p.alignment === 'centre' ? 'center' : p.alignment === 'justify' ? 'start' : p.alignment,
    justify: p.alignment === 'justify',
    firstLineIndent: p.firstLineIndent,
    startIndent: p.startIndent,
    endIndent: p.endIndent,
    spaceBefore: p.spaceBefore,
    spaceAfter: p.spaceAfter,
    lineSpacing: p.lineSpacing,
    keepWithNext: p.keepWithNext,
    keepTogether: p.keepTogether,
    widowControl: p.widowControl,
    hyphenate: p.hyphenate,
    descent: style.typeface.descent,
    leading: Number((p.lineSpacing - p.size).toFixed(3)),
  };
}
