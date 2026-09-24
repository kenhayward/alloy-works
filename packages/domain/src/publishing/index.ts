export { assemble, publishedImagePath } from './assemble.js';
export type { Assembled, AssembleInput, PublishingAsset } from './assemble.js';
export { publishFailureCodes } from './failures.js';
export type { PublishFailure, PublishFailureCode, PublishStage } from './failures.js';
// The question the worker's pinned fonts answer, asked of one family at a time (editor 5), by the
// family's name since themes 1; and how the text asked about is set.
export type { Covers, Setting } from './glyphs.js';
// Promoted by editor 5 so the worker's regression corpus probes the exemption with the predicate
// `assemble` asks, rather than a copy of its ranges.
export { setWithoutAGlyph } from './glyphs.js';
// The maths tree, from an equation's stored MathML: what the template and the Word writer read of an
// equation, and why one cannot be set (equations 2, ruling R2).
export { mathsTree } from './maths.js';
// And the characters it sets on its own account, which the worker holds the maths face to (themes 1).
export { MATHS_CHARACTERS } from './maths.js';
export type {
  MathsAlignment,
  MathsAttachMode,
  MathsBrace,
  MathsConversion,
  MathsNode,
  MathsRefusal,
  MathsTree,
  MathsVariant,
} from './maths.js';
// Promoted by the editor's marks slice: the editor warns an author, at the time they give it, about
// a language tag a publication could not carry, and the rule it asks is this one rather than a
// second copy of it kept in the renderer (CNT-152).
export { publishedLanguage } from './language.js';
export {
  defaultLayout,
  FIRST_DEFAULT_LAYOUT,
  SECOND_DEFAULT_LAYOUT,
  THIRD_DEFAULT_LAYOUT,
  FOURTH_DEFAULT_LAYOUT,
  LAYOUT_SCHEMA_VERSION,
  LISTED_SEQUENCES,
  layoutMigrationChain,
  layoutSchema,
  layoutWordsSchema,
  parseLayout,
  PUBLISHING_FORMATS,
  readLayout,
  speaksFor,
  unsupportedFormats,
} from './layout.js';
export type {
  Layout,
  Layout2,
  Layout3,
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
  // Frozen by figures 5, which made `publishing/8`: the schema template 7 reads, and the schema of
  // every publication made before a run could be an image.
  PUBLISHING_SCHEMA_7,
  // Frozen by footnotes 2, which made `publishing/9`: the schema template 8 reads, and the schema of
  // every publication made before a run could be a footnote.
  PUBLISHING_SCHEMA_8,
  // Frozen by cross-references 2, which made `publishing/10`: the schema template 9 reads, and the
  // schema of every publication made before a run could be a cross-reference.
  PUBLISHING_SCHEMA_9,
  // Frozen by equations 2, which made `publishing/11`: the schema template 10 reads, and the schema
  // of every publication made before a run or a block could be an equation.
  PUBLISHING_SCHEMA_10,
  // Frozen by themes 1, which made `publishing/12`: the schema template 11 reads, and the schema of
  // every publication made before a publication was set from a theme.
  PUBLISHING_SCHEMA_11,
  // Frozen by themes 2, which made `publishing/13`: the schema template 12 reads, and the schema of
  // every publication made before a table and an image were set from their styles.
  PUBLISHING_SCHEMA_12,
} from './published.js';
export type {
  PublishedBlock,
  PublishedBlock1,
  PublishedDocument,
  PublishedDocument1,
  PublishedEquation,
  PublishedEquationBlock,
  PublishedEquationRun,
  PublishedFigure,
  PublishedFootnoteRun,
  PublishedImageRun,
  PublishedInline,
  PublishedItem,
  PublishedLanguage,
  PublishedList,
  PublishedMarker,
  PublishedPreformatted,
  PublishedQuotation,
  PublishedMark,
  PublishedNode,
  PublishedNode1,
  PublishedParagraph,
  PublishedParagraph1,
  PublishedPattern,
  PublishedPdfFormat,
  PublishedReferenceRun,
  PublishedRun,
  PublishedRun1,
  PublishedTitleRun,
} from './published.js';
