import { z } from 'zod';

import { canonicalJson } from '../stored/canonical.js';
import { typefaceSchema } from '../theme/schema.js';

import type { PublishingFormat } from './layout.js';

/**
 * The media type each format's bytes are kept and served as: what the store records at the put, and
 * so what a download answers. One entry per format a layout can make, so a format added to
 * `PUBLISHING_FORMATS` without its type fails the typecheck here.
 */
export const OUTPUT_CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const satisfies Record<PublishingFormat, string>;

/** A family name as the theme spells one: the rule a typeface's `family` is held to. */
const family = typefaceSchema.shape.family;

/**
 * The things an output's report can say (Word 1, ruling R13), each an entry of its own kind. Word 1's:
 * a face the theme names that Word could not carry, set in the Word face it declares (STY-052); a
 * Word-only publication carrying no page-cited output (PUB-074); and page numbers citing the PDF, not
 * the Word document, whose pagination is Word's (PUB-065). Later slices add their kinds - a table's
 * lost header column, an unrepeated header, an omitted label - each as a new member here, never by
 * changing one already stored.
 */
export const OUTPUT_REPORT_KINDS = [
  'face_substituted',
  'no_page_cited_output',
  'pages_cite_the_pdf',
] as const;

export const outputReportEntrySchema = z.discriminatedUnion('kind', [
  z
    .strictObject({ kind: z.literal('face_substituted'), family, wordFamily: family })
    .refine((entry) => entry.family !== entry.wordFamily, 'A face is not substituted by itself'),
  z.strictObject({ kind: z.literal('no_page_cited_output') }),
  z.strictObject({ kind: z.literal('pages_cite_the_pdf') }),
]);

/**
 * **What an output could not carry, closed**: a list of entries, each one kind's closed shape, and each
 * said once. Stored per output as it is written, since an output's record is insert-only, so what this
 * parse accepts a later reader must go on accepting. A PDF's is empty.
 */
export const outputReportSchema = z
  .array(outputReportEntrySchema)
  .refine(
    (entries) => new Set(entries.map((entry) => canonicalJson(entry))).size === entries.length,
    'A report says each thing once',
  );

export type OutputReportEntry = z.infer<typeof outputReportEntrySchema>;
export type OutputReport = OutputReportEntry[];

/** The one entry point for a stored or recorded report. Throws where it is not one. */
export function parseOutputReport(value: unknown): OutputReport {
  return outputReportSchema.parse(value);
}
