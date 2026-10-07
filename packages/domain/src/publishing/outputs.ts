import { z } from 'zod';

import { nodeIdentifierSchema } from '../content/model/identifier.js';
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
 * the Word document, whose pagination is Word's (PUB-065). Word 2's (ruling R7), each of one table
 * Word could not set as its table style asks: a header column, which Word cannot mark as one
 * (TAB-049); a header its style does not repeat, which Word repeats anyway, since it marks header rows
 * only by repeating them; and a continuation label, which Word cannot set. Word 4's (the final
 * review's I2): a heading or a listed caption holding an equation that is not a row of plain runs, which
 * Word's rebuilt contents, lists and running heads set as its characters in a row. W14.6's (W-J,
 * PUB-100), each a structure the PDF gives a reader that Word has no place for: an image's
 * description in a language other than the document's, since Word's description holds none; a
 * quotation, preformatted text and a definition list, which the PDF tags `BlockQuote`, `Code` and a
 * list and Word sets as paragraphs in their styles; a quoted phrase and inline code, which the PDF
 * tags `Quote` and `Code` and Word sets as runs in their character styles; a numbered equation, which
 * Word sets as a table of one row; and, once for a document setting an equation, the alternative
 * the PDF's formula carries, which Word's own maths reading replaces, and the characters of the Word
 * face the maths is set in, which nothing here can check. From W14.6's final review: once for every
 * document, the titles the PDF tags as headings - the document's, the contents' and each list's - which
 * Word sets as body text, kept out of its contents; and each list after the contents Word cannot link
 * to its captions, which only a list of figures, one of them floated, is. TB3's (TB3-J): a table the
 * PDF scaled to its measure, which Word reflows to the page instead. Later slices add their kinds
 * as new members here, never by changing one already stored.
 */
export const OUTPUT_REPORT_KINDS = [
  'face_substituted',
  'no_page_cited_output',
  'pages_cite_the_pdf',
  'header_column_lost',
  'header_repeated',
  'continuation_label_omitted',
  'equation_flattened',
  'description_language_lost',
  'quotation_not_structure',
  'preformatted_not_structure',
  'definition_list_not_structure',
  'quoted_phrase_not_structure',
  'inline_code_not_structure',
  'equation_numbered_as_table',
  'equation_alternative_lost',
  'maths_coverage_unchecked',
  'titles_not_headings',
  'list_not_linked',
  'table_reflowed',
] as const;

/**
 * The titles template 13 tags as headings that Word sets as body text (the final review of W14.6), in
 * the order they stand: the document's, always; the contents', where the layout sets one; and the
 * lists', where any list stands after the contents.
 */
export const UNHEADED_TITLES = ['document', 'contents', 'lists'] as const;

/**
 * A table a report names: its place - the outline node it is published under and its identifier in
 * that node's component, as a publish failure names a block - and its label, `Table 1.1`, where the
 * layout's numbering gives it one, so a reader is told which table without the outline to hand.
 */
const table = {
  node: nodeIdentifierSchema,
  block: z.string().min(1),
  label: z.string().min(1).nullable(),
};

/**
 * A heading or a caption a report names: its place, as `table`'s - but a heading's, which is its node's
 * and so names no block - and its heading's number or its caption's label, `3` or `Table 1.1`, where
 * it has one.
 */
const titled = {
  node: nodeIdentifierSchema,
  block: z.string().min(1).nullable(),
  label: z.string().min(1).nullable(),
};

/**
 * A block a report names by its place alone (W14.6): a quotation, preformatted text, a definition list,
 * the figure or the block of runs an image stands in, or the block of runs holding a quoted phrase or
 * inline code - never a heading's, which carries no mark (`assemble`'s `wordTitle`).
 */
const block = {
  node: nodeIdentifierSchema,
  block: z.string().min(1),
};

export const outputReportEntrySchema = z.discriminatedUnion('kind', [
  z
    .strictObject({ kind: z.literal('face_substituted'), family, wordFamily: family })
    .refine((entry) => entry.family !== entry.wordFamily, 'A face is not substituted by itself'),
  z.strictObject({ kind: z.literal('no_page_cited_output') }),
  z.strictObject({ kind: z.literal('pages_cite_the_pdf') }),
  z.strictObject({ kind: z.literal('header_column_lost'), ...table }),
  z.strictObject({ kind: z.literal('header_repeated'), ...table }),
  z.strictObject({ kind: z.literal('continuation_label_omitted'), ...table }),
  z.strictObject({ kind: z.literal('equation_flattened'), ...titled }),
  z.strictObject({ kind: z.literal('description_language_lost'), ...block }),
  z.strictObject({ kind: z.literal('quotation_not_structure'), ...block }),
  z.strictObject({ kind: z.literal('preformatted_not_structure'), ...block }),
  z.strictObject({ kind: z.literal('definition_list_not_structure'), ...block }),
  z.strictObject({ kind: z.literal('quoted_phrase_not_structure'), ...block }),
  z.strictObject({ kind: z.literal('inline_code_not_structure'), ...block }),
  z.strictObject({
    kind: z.literal('equation_numbered_as_table'),
    ...block,
    label: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('equation_alternative_lost') }),
  z.strictObject({ kind: z.literal('maths_coverage_unchecked'), wordFamily: family }),
  z.strictObject({
    kind: z.literal('titles_not_headings'),
    titles: z
      .array(z.enum(UNHEADED_TITLES))
      .refine(
        (titles) =>
          titles[0] === 'document' &&
          titles.every(
            (title, at) =>
              at === 0 || UNHEADED_TITLES.indexOf(title) > UNHEADED_TITLES.indexOf(titles[at - 1]!),
          ),
        "The document's title, then each other once, in the order they stand",
      ),
  }),
  // Only a figure floats (Word 2, ruling R8), so only a list of figures is written unlinked.
  z.strictObject({ kind: z.literal('list_not_linked'), sequence: z.literal('figure') }),
  z.strictObject({ kind: z.literal('table_reflowed'), ...table }),
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
