export { assemble } from './assemble.js';
export type { Assembled, AssembleInput, PublishingAsset } from './assemble.js';
export { publishFailureCodes } from './failures.js';
export type { PublishFailure, PublishFailureCode, PublishStage } from './failures.js';
// The question the worker's pinned fonts answer, asked of one family at a time (editor 5).
export type { Covers, Face } from './glyphs.js';
// Promoted by editor 5 so the worker's regression corpus probes the exemption with the predicate
// `assemble` asks, rather than a copy of its ranges.
export { setWithoutAGlyph } from './glyphs.js';
// Promoted by the editor's marks slice: the editor warns an author, at the time they give it, about
// a language tag a publication could not carry, and the rule it asks is this one rather than a
// second copy of it kept in the renderer (CNT-152).
export { publishedLanguage } from './language.js';
export {
  defaultLayout,
  FIRST_DEFAULT_LAYOUT,
  SECOND_DEFAULT_LAYOUT,
  LAYOUT_SCHEMA_VERSION,
  LISTED_SEQUENCES,
  layoutMigrationChain,
  layoutSchema,
  parseLayout,
  PUBLISHING_FORMATS,
  readLayout,
  speaksFor,
  unsupportedFormats,
} from './layout.js';
export type {
  Layout,
  LayoutField,
  LayoutList,
  LayoutReadOutcome,
  PdfFormat,
  SlotPart,
} from './layout.js';
export {
  DRAFT_NOTICE,
  PUBLISHING_SCHEMA,
  PUBLISHING_SCHEMA_1,
  // Frozen by the editor's marks slice, which made `publishing/3`: the schema template 2 reads, and
  // the schema of every publication made before a run carried its marks.
  PUBLISHING_SCHEMA_2,
  // Frozen by the editor's lists slice, which made `publishing/4`: the schema template 3 reads, and
  // the schema of every publication made before a block could be a list.
  PUBLISHING_SCHEMA_3,
  // Frozen by editor 5, which made `publishing/5`: the schema template 4 reads, and the schema of
  // every publication made before a block could be a quotation or preformatted text.
  PUBLISHING_SCHEMA_4,
  // Frozen by tables 2, which made `publishing/6`: the schema template 5 reads, and the schema of
  // every publication made before a block could be a table.
  PUBLISHING_SCHEMA_5,
  // Frozen by figures 3, which made `publishing/7`: the schema template 6 reads, and the schema of
  // every publication made before a block could be a figure.
  PUBLISHING_SCHEMA_6,
} from './published.js';
export type {
  PublishedBlock,
  PublishedBlock1,
  PublishedDocument,
  PublishedDocument1,
  PublishedFigure,
  PublishedItem,
  PublishedLanguage,
  PublishedList,
  PublishedPreformatted,
  PublishedQuotation,
  PublishedMark,
  PublishedNode,
  PublishedNode1,
  PublishedParagraph,
  PublishedParagraph1,
  PublishedPattern,
  PublishedPdfFormat,
  PublishedRun,
  PublishedRun1,
} from './published.js';
