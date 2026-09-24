import type { ResolvedParagraphStyle, ResolvedTheme } from './read.js';
import {
  SCRIPT_SCALE,
  STYLED_MARKS,
  type ImageLength,
  type ImageStyle,
  type Place,
  type Role,
  type StyledMark,
  type TableRule,
  type TableStyle,
} from './schema.js';

/**
 * The PDF's projection: resolved styles as data for the fixed Typst template (ADR-0013). The template
 * reads values and evaluates nothing, so no theme - however its names are spelled - can become code in
 * the publishing pipeline. Every value is already in the engine's own terms - a weight, a posture, an
 * alignment and whether to justify, a fill or `null` for none, a stroke's thickness and paint - so the
 * template translates nothing either, and holds no typographic literal of its own: the maths face is
 * here too.
 *
 * **Two projections, one for each published shape that carries one.** `projectTypst` is
 * `publishing/13`'s `theme` (themes 2, ruling R1): every paragraph style with its contextual spacing,
 * and every table style and image style by identifier. `projectTypst12` is `publishing/12`'s (themes 1,
 * ruling R6), **frozen with template 12**, which reads exactly that shape. Each has its **own types**,
 * written out rather than derived from the other's, so a change made for one cannot move the other: a
 * shared type, widened for template 13, would silently widen what template 12 is handed too. 13's is
 * computed from 12's frozen projection and adds to it, never the other way about.
 */

/** A paragraph style as template 13 sets it. */
export interface TypstParagraphStyle {
  /**
   * Its identifier, the key it is carried under: what template 13 asks of two consecutive blocks to
   * know whether they are set in one style, which contextual spacing is between. Two styles stating
   * the same values are still two styles, as they are to Word.
   */
  readonly id: string;
  readonly font: string;
  readonly size: number;
  readonly weight: 'regular' | 'bold';
  readonly style: 'normal' | 'italic';
  readonly fill: string;
  /** The paragraph's fill, or null where it has none. */
  readonly background: string | null;
  /** Points between the fill's edge and the text; the template draws it only around a fill. */
  readonly padding: number;
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
  /**
   * Whether two consecutive paragraphs of this style, both asking for it, add neither's space before
   * or after between them (themes 2, ruling R1), as Word's `w:contextualSpacing` does.
   */
  readonly contextualSpacing: boolean;
}

/** A mark's rendering: only what its character style states. */
export interface TypstMark {
  readonly weight?: 'regular' | 'bold';
  readonly style?: 'normal' | 'italic';
  readonly underline?: boolean;
  readonly fill?: string;
  readonly font?: string;
  readonly position?: 'subscript' | 'superscript';
  /** A fraction of the size of the text the mark stands in: the template's `em`, multiplied. */
  readonly scale?: number;
}

/** A rule as the engine strokes it: its thickness in points and its paint. */
export interface TypstStroke {
  readonly thickness: number;
  readonly paint: string;
}

/** A header row or a header column, as template 13 sets it. */
export interface TypstTableHeader {
  /** Its cells' fill, or null where it has none. */
  readonly fill: string | null;
  /**
   * `bold` where the header sets its text bold, or null where it leaves the text the weight its cell's
   * paragraph style gives it: a header that is not bold does not make a bold cell style regular.
   */
  readonly weight: 'bold' | null;
  /** The rule on its body side - below the row, after the column - or null for none of its own. */
  readonly stroke: TypstStroke | null;
}

/** A table style as template 13 sets it (STY-076, STY-013; TH-I). */
export interface TypstTableStyle {
  readonly headerRow: TypstTableHeader;
  readonly headerColumn: TypstTableHeader;
  /** The fill of alternate body rows, or null for no banding. */
  readonly band: string | null;
  /** The table's outer edge, and the rules between its rows and between its columns; null for none. */
  readonly strokes: {
    readonly outer: TypstStroke | null;
    readonly horizontal: TypstStroke | null;
    readonly vertical: TypstStroke | null;
  };
  /** A cell's inset on every side, in points. */
  readonly inset: number;
  /** `table.header(repeat: ..)`: whether the header rows repeat on each page the table crosses. */
  readonly repeatHeader: boolean;
  /** Whether each row is `breakable: false`, moving whole to the next page rather than splitting. */
  readonly keepRowsWhole: boolean;
  /** Whether a page after the table's first carries its label, in the layout's `words.continued`. */
  readonly continuationLabel: boolean;
}

/** An image style as template 13 places it (STY-015 to STY-018; TH-J). */
export interface TypstImageStyle {
  /** What the style fixes, as it states it: `assemble` computes every image's size from it. */
  readonly fixed: ImageStyle['fixed'];
  /** The most the other dimension may be, as the style states it. */
  readonly maximum: ImageLength;
  /** In its line, as a block, or floated to the page's head or foot (`figure`'s `placement`). */
  readonly placement: 'inline' | 'block' | 'float';
  /** Where a block or a floated image stands within its band, or null for one in a line of text. */
  readonly align: 'start' | 'center' | 'end' | null;
}

/** The theme as `publishing/13` carries it. */
export interface TypstTheme {
  readonly paper: string;
  /** The family every equation is set in. */
  readonly maths: string;
  /**
   * The size a subscript or a superscript is set at, as a fraction of its text (`SCRIPT_SCALE`): the
   * template's `sub` and `super` read it here rather than taking the engine's.
   */
  readonly script: number;
  /** By identifier. */
  readonly styles: Readonly<Record<string, TypstParagraphStyle>>;
  readonly marks: Readonly<Record<StyledMark, TypstMark>>;
  /** Each place's default style's identifier: what a stored `body` resolves to there. */
  readonly places: Readonly<Record<Place, string>>;
  /** Each role's style's identifier. */
  readonly roles: Readonly<Record<Role, string>>;
  /** Every table style, by identifier, in the catalogue's order. */
  readonly tables: Readonly<Record<string, TypstTableStyle>>;
  /** Every image style, by identifier, in the catalogue's order. */
  readonly images: Readonly<Record<string, TypstImageStyle>>;
}

/**
 * The theme for template 13. Given the identifiers a document uses, it projects those and every
 * paragraph style a place or a role names, which the template may reach whatever the document holds;
 * given none, every style. Every table and image style is projected either way: a catalogue of them is
 * small, and the member is then the theme's alone. An identifier the theme lacks is a defect of the
 * caller's: `assemble` refuses a document's own as `style_missing` before it asks.
 */
export function projectTypst(theme: ResolvedTheme, used?: Iterable<string>): TypstTheme {
  const frozen = projectTypst12(theme, used);
  const styles = Object.fromEntries(
    Object.entries(frozen.styles).map(([id, style]) => [
      id,
      {
        ...style,
        id,
        contextualSpacing: theme.paragraphStyles.get(id)!.properties.contextualSpacing,
      },
    ]),
  );
  return {
    ...frozen,
    styles,
    marks: { ...frozen.marks },
    tables: Object.fromEntries(
      [...theme.tableStyles.values()].map((style) => [style.id, table(style)]),
    ),
    images: Object.fromEntries(
      [...theme.imageStyles.values()].map((style) => [style.id, image(style)]),
    ),
  };
}

function stroke(rule: TableRule): TypstStroke | null {
  return rule === 'none' ? null : { thickness: rule.width, paint: rule.colour };
}

function header(stated: TableStyle['headerRow']): TypstTableHeader {
  return {
    fill: stated.fill === 'none' ? null : stated.fill,
    weight: stated.bold ? 'bold' : null,
    stroke: stroke(stated.rule),
  };
}

function table(style: TableStyle): TypstTableStyle {
  return {
    headerRow: header(style.headerRow),
    headerColumn: header(style.headerColumn),
    band: style.banding.fill === 'none' ? null : style.banding.fill,
    strokes: {
      outer: stroke(style.rules.outer),
      horizontal: stroke(style.rules.horizontal),
      vertical: stroke(style.rules.vertical),
    },
    inset: style.padding,
    repeatHeader: style.breaks.repeatHeader,
    keepRowsWhole: style.breaks.keepRowsWhole,
    continuationLabel: style.breaks.continuationLabel,
  };
}

function image(style: ImageStyle): TypstImageStyle {
  return {
    fixed: { ...style.fixed },
    maximum: { ...style.maximum },
    placement: style.placement,
    align:
      style.placement === 'inline'
        ? null
        : style.alignment === 'centre'
          ? 'center'
          : style.alignment,
  };
}

// ---------------------------------------------------------------------------------------------------
// publishing/12's projection, frozen with template 12. Its types are its own, written out in full.
// ---------------------------------------------------------------------------------------------------

/** A paragraph style as template 12 sets it: 13's but for contextual spacing, which 12 never reads. */
export interface TypstParagraphStyle12 {
  readonly font: string;
  readonly size: number;
  readonly weight: 'regular' | 'bold';
  readonly style: 'normal' | 'italic';
  readonly fill: string;
  readonly background: string | null;
  readonly padding: number;
  readonly align: 'start' | 'center' | 'end';
  readonly justify: boolean;
  readonly firstLineIndent: number;
  readonly startIndent: number;
  readonly endIndent: number;
  readonly spaceBefore: number;
  readonly spaceAfter: number;
  readonly lineSpacing: number;
  readonly keepWithNext: boolean;
  readonly keepTogether: boolean;
  readonly widowControl: boolean;
  readonly hyphenate: boolean;
  readonly descent: number;
  readonly leading: number;
}

/** A mark as template 12 renders it. */
export interface TypstMark12 {
  readonly weight?: 'regular' | 'bold';
  readonly style?: 'normal' | 'italic';
  readonly underline?: boolean;
  readonly fill?: string;
  readonly font?: string;
  readonly position?: 'subscript' | 'superscript';
  readonly scale?: number;
}

/** The theme as `publishing/12` carries it: no table or image style, and no contextual spacing. */
export interface TypstTheme12 {
  readonly paper: string;
  readonly maths: string;
  readonly script: number;
  readonly styles: Readonly<Record<string, TypstParagraphStyle12>>;
  readonly marks: Readonly<Record<StyledMark, TypstMark12>>;
  readonly places: Readonly<Record<Place, string>>;
  readonly roles: Readonly<Record<Role, string>>;
}

/**
 * The theme for template 12, as themes 1 projected it: given the identifiers a document uses, those
 * and every style a place or a role names; given none, every style. Nothing of what themes 2 added
 * reaches it, since template 12 reads none of it.
 */
export function projectTypst12(theme: ResolvedTheme, used?: Iterable<string>): TypstTheme12 {
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
      .map((style) => [style.id, paragraph12(style)]),
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
        scale?: number;
      } = {};
      if (properties.bold !== undefined) out.weight = properties.bold ? 'bold' : 'regular';
      if (properties.italic !== undefined) out.style = properties.italic ? 'italic' : 'normal';
      if (properties.underline !== undefined) out.underline = properties.underline;
      if (properties.colour !== undefined) out.fill = properties.colour;
      if (typeface !== undefined) out.font = typeface.family;
      if (properties.position !== undefined) out.position = properties.position;
      if (properties.scale !== undefined) out.scale = properties.scale;
      return [mark, out];
    }),
  ) as Record<StyledMark, TypstMark12>;

  return {
    paper: theme.paper,
    maths: theme.maths.family,
    script: SCRIPT_SCALE,
    styles,
    marks,
    places: { ...theme.places },
    roles: { ...theme.roles },
  };
}

function paragraph12(style: ResolvedParagraphStyle): TypstParagraphStyle12 {
  const p = style.properties;
  return {
    font: style.typeface.family,
    size: p.size,
    weight: p.bold ? 'bold' : 'regular',
    style: p.italic ? 'italic' : 'normal',
    fill: p.colour,
    background: p.background === 'none' ? null : p.background,
    padding: p.padding,
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
