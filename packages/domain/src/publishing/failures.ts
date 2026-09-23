/**
 * Where a failure arose (PUB-086): resolving the document at the request, composing it in `assemble`,
 * the engine, or storing what it made.
 */
export type PublishStage = 'resolve' | 'compose' | 'engine' | 'store';

/**
 * Every failure a publish can end in, closed, and only ever added to: a request's stored failures are
 * read back through the contract's enum, so a code once written is never renamed or removed.
 */
export const publishFailureCodes = [
  // resolve: at the request, as the publisher.
  'occurrence_unreadable',
  'occurrence_unresolved',
  // resolve, from figures 3: a figure whose image the publisher may not read, or that names no image
  // at all - the two told apart no more than an occurrence's are, and naming the figure, never the
  // image (issue #143).
  'asset_unreadable',
  // compose: in `assemble`, before Typst is started.
  'title_not_publishable',
  'block_not_publishable',
  'inline_not_publishable',
  'style_missing',
  'language_not_publishable',
  'glyph_missing',
  'character_disallowed',
  // No outline node survives conditions, and the layout declares nothing with something to show: no
  // cover, and a contents would hold no entry (PUB-079, decision K). Never an empty artifact.
  'nothing_to_publish',
  // The layout's, not the document's: a character in the layout's own words that the engine cannot
  // set, and a layout language it cannot carry. Named apart so that neither reads as the document's.
  'layout_glyph_missing',
  'layout_language_not_publishable',
  // compose, from editor 5: a character the monospace face cannot set, in preformatted text or an
  // inline code run - named apart from `glyph_missing` because the body face could set it, so the
  // author is not told the character is in no typeface at all - and a preformatted line wider than
  // the page, which would otherwise be wrapped or cut off.
  'code_glyph_missing',
  'line_too_wide',
  // compose, from tables 2: a table whose caption says nothing, refused at publish rather than at save
  // because an author types the caption after inserting the table (decision T-F). A caption is what
  // names a table in the PDF and to a screen reader (TAB-034, TAB-039).
  'table_without_caption',
  // compose, from tables 2: a cell that starts in the header rows and spans below them. The pinned
  // engine grows the header to take in every row such a cell reaches, so a data cell beside it would
  // be read out as a column header; refused, naming the table, rather than published saying that.
  'table_header_spans_body',
  // compose, from figures 3: a figure whose caption says nothing - CNT-017's caption, refused at
  // publish as a table's is - and one given alternative text by neither itself nor its image, which
  // the engine would refuse the whole document for without saying which (PUB-033, AST-014).
  'figure_without_caption',
  'alternative_missing',
  // engine and store: the platform's, recorded after the last attempt.
  'engine_failed',
  'store_failed',
] as const;

export type PublishFailureCode = (typeof publishFailureCodes)[number];

/**
 * One failure, naming its stage, its code and the place it concerns: the outline node, and the block
 * within that node's component where there is one. `detail` is what the author needs to act and the
 * code does not say - the kind of block or mark that cannot be published yet, the style, the language
 * tag exactly as stored, or the character as `U+XXXX`, never the character itself - and is `null`
 * where the failure is about something the publisher may not read: **an unreadable occurrence carries
 * its node and nothing else** (issue #143).
 */
export interface PublishFailure {
  readonly stage: PublishStage;
  readonly code: PublishFailureCode;
  readonly node: string | null;
  readonly block: string | null;
  readonly detail: string | null;
}
