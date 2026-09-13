import { z } from 'zod';

/**
 * Thirteen marks, and the set is closed (CNT-006). Adding one is a schema version with a migration
 * and a fixture, not a configuration option.
 *
 * Every mark carries an identifier (CNT-004), which is what makes an annotation fragmented across
 * text nodes remain one annotation, and what makes accepting it one operation (CNT-005).
 */
export const markTypes = [
  'emphasis',
  'strong',
  'underline',
  'subscript',
  'superscript',
  'inlineCode',
  'definedTerm',
  'quotedPhrase',
  'condition',
  'suggestion',
  'comment',
  'hyperlink',
  'language',
] as const;

export type MarkType = (typeof markTypes)[number];

/** CNT-127. Widened only by a requirement, never by a caller. */
export const allowedLinkSchemes = ['http:', 'https:', 'mailto:'] as const;

const identified = { id: z.string().min(1) };

/**
 * A BCP 47 tag, carrying a region wherever the region changes the content (CNT-140, LOC-034). This is
 * a shape check rather than a registry check: `zz-ZZ` passes and is somebody else's problem, but
 * `portuguese` does not, and neither does a bare tag where a script or region was meant.
 */
const bcp47 = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/, 'not a BCP 47 tag');

const plain = (type: MarkType) => z.strictObject({ type: z.literal(type), ...identified });

export const emphasisMarkSchema = plain('emphasis');
export const strongMarkSchema = plain('strong');
/** Named for its appearance rather than its meaning, and CNT-085 says so rather than pretending. */
export const underlineMarkSchema = plain('underline');
export const subscriptMarkSchema = plain('subscript');
export const superscriptMarkSchema = plain('superscript');
export const inlineCodeMarkSchema = plain('inlineCode');
export const quotedPhraseMarkSchema = plain('quotedPhrase');

/** LIB-015: a term is referenced from content and never typed as text. No text member exists. */
export const definedTermMarkSchema = z.strictObject({
  type: z.literal('definedTerm'),
  ...identified,
  term: z.string().min(1),
});

export const conditionMarkSchema = z.strictObject({
  type: z.literal('condition'),
  ...identified,
  axis: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
});

export const suggestionMarkSchema = z.strictObject({
  type: z.literal('suggestion'),
  ...identified,
  operation: z.enum(['insert', 'delete', 'replace']),
  author: z.string().min(1),
});

export const commentMarkSchema = z.strictObject({
  type: z.literal('comment'),
  ...identified,
  threadId: z.string().min(1),
});

export const hyperlinkMarkSchema = z.strictObject({
  type: z.literal('hyperlink'),
  ...identified,
  href: z.string().refine((value) => {
    // CNT-127: refused on entry and never stored. Parsing rather than pattern-matching, so that a
    // target the URL parser reads differently from a regular expression cannot slip past.
    try {
      return (allowedLinkSchemes as readonly string[]).includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'scheme is not allowlisted'),
  title: z.string().min(1).optional(),
});

export const languageMarkSchema = z.strictObject({
  type: z.literal('language'),
  ...identified,
  tag: bcp47,
});

export const markSchema = z.discriminatedUnion('type', [
  emphasisMarkSchema,
  strongMarkSchema,
  underlineMarkSchema,
  subscriptMarkSchema,
  superscriptMarkSchema,
  inlineCodeMarkSchema,
  quotedPhraseMarkSchema,
  definedTermMarkSchema,
  conditionMarkSchema,
  suggestionMarkSchema,
  commentMarkSchema,
  hyperlinkMarkSchema,
  languageMarkSchema,
]);

export type Mark = z.infer<typeof markSchema>;
