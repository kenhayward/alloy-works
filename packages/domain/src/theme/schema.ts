import { z } from 'zod';

/**
 * A presentation theme, as data. See docs/design/themes.md.
 *
 * Prototype scope: the paragraph properties the design's riskiest claims turn on - size, weight,
 * style, colour, first-line indent, the two spacings and line spacing - plus keep-with-next, the
 * one pagination-bound property, and character styles for two marks. Every value is typed, and
 * the two kinds of free text that reach a renderer - identifiers and family names - are
 * restricted to characters that cannot escape the syntax they are written into (STY-N03).
 */

/** Points: the one length unit a theme is written in. */
const points = z.number().nonnegative();

/** sRGB as lower-case hex. One spelling, so no projection ever has to normalise. */
const colour = z.string().regex(/^#[0-9a-f]{6}$/);

/**
 * A stable style identifier (STY-005). Restricted so that it is safe verbatim as a CSS class, a
 * Typst dictionary key and a Word style id - every projection keys on it without escaping.
 */
export const styleIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

/** A family name as the font files declare it: letters, digits, spaces, and `.`, `_`, `-`. */
const familyName = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,62}$/u);

export const markNames = ['strong', 'emphasis'] as const;

export type MarkName = (typeof markNames)[number];

export const paragraphPropertiesSchema = z.strictObject({
  /** The id of a typeface the theme declares. */
  typeface: z.string().min(1).optional(),
  size: points.positive().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  colour: colour.optional(),
  firstLineIndent: points.optional(),
  /** Added to the previous block's space after, in every output (STY-050). */
  spaceBefore: points.optional(),
  spaceAfter: points.optional(),
  /** A minimum distance from baseline to baseline, never a multiple (STY-051). */
  lineSpacing: points.positive().optional(),
  /** Pagination-bound: rendered by the PDF and Word, shown in the editor only by preview. */
  keepWithNext: z.boolean().optional(),
});

export const paragraphStyleSchema = z.strictObject({
  id: styleIdSchema,
  name: z.string().min(1).max(80),
  basedOn: styleIdSchema.optional(),
  properties: paragraphPropertiesSchema,
});

/** How a mark renders in this theme (STY-009, STY-010). Stated properties override the paragraph's. */
export const characterStyleSchema = z.strictObject({
  mark: z.enum(markNames),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});

export const typefaceSchema = z.strictObject({
  id: z.string().min(1),
  family: familyName,
  /** STY-052: a permitted face for Word output, where this one may not be embedded there. */
  wordFamily: familyName.optional(),
});

export const themeSchema = z.strictObject({
  id: z.string().min(1),
  paper: colour,
  typefaces: z.array(typefaceSchema).min(1),
  /** Every property stated: the root every style's inheritance chain ends in. */
  defaults: paragraphPropertiesSchema.required(),
  paragraphStyles: z.array(paragraphStyleSchema),
  characterStyles: z.array(characterStyleSchema),
});

export type Theme = z.infer<typeof themeSchema>;
export type ParagraphProperties = z.infer<typeof paragraphPropertiesSchema>;
export type ParagraphStyle = z.infer<typeof paragraphStyleSchema>;
export type CharacterStyle = z.infer<typeof characterStyleSchema>;
export type Typeface = z.infer<typeof typefaceSchema>;
