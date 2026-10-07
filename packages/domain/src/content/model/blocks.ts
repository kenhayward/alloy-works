import { z } from 'zod';

import { boundedText, COLUMN_ALIGNMENTS, fieldFormatSchema } from '../../data/field-format.js';
import { sourceNameSchema } from '../../data/protocol.js';

import {
  alternativeSchema,
  bindingNodeSchema,
  equationContentSchema,
  footnoteNodeSchema,
  inlineNodeSchema,
  tableBindingSchema,
} from './inline.js';
import { artifactIdentifierSchema } from './identifier.js';

const identified = { id: z.string().min(1) };

/** CNT-094: appearance comes from a named style. There is no alignment, indent or spacing member. */
const styled = { style: z.string().min(1).default('body') };

export type BlockNode =
  | { type: 'paragraph'; id: string; style: string; content: z.infer<typeof inlineNodeSchema>[] }
  | {
      type: 'list';
      id: string;
      kind: 'ordered' | 'unordered' | 'definition';
      start?: number | undefined;
      format?: 'decimal' | 'alphabetic' | 'roman' | undefined;
      items: { term?: z.infer<typeof inlineNodeSchema>[] | undefined; content: BlockNode[] }[];
    }
  | {
      type: 'table';
      id: string;
      style: string;
      caption: z.infer<typeof inlineNodeSchema>[];
      headerRows: number;
      headerColumns: number;
      keyColumns?: number[] | undefined;
      note?: z.infer<typeof inlineNodeSchema>[] | undefined;
      numbered?: false | undefined;
      rows: { cells: { content: BlockNode[]; colspan: number; rowspan: number }[] }[];
    }
  | {
      type: 'figure';
      id: string;
      asset?: string | undefined;
      binding?: z.infer<typeof bindingNodeSchema> | undefined;
      imageStyle: string;
      caption: z.infer<typeof inlineNodeSchema>[];
      alternative: z.infer<typeof alternativeSchema>;
      numbered?: false | undefined;
    }
  | BoundTableNode
  | { type: 'preformatted'; id: string; text: string; language?: string | undefined }
  | {
      type: 'blockquote';
      id: string;
      content: BlockNode[];
      attribution?: z.infer<typeof inlineNodeSchema>[] | undefined;
    }
  | { type: 'equation'; id: string; mathml: string; latex?: string | undefined; numbered: boolean };

export const blockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    paragraphNodeSchema,
    listNodeSchema,
    tableNodeSchema,
    boundTableNodeSchema,
    figureNodeSchema,
    preformattedNodeSchema,
    blockquoteNodeSchema,
    blockEquationNodeSchema,
  ]),
);

export const paragraphNodeSchema = z.strictObject({
  type: z.literal('paragraph'),
  ...identified,
  ...styled,
  content: z.array(inlineNodeSchema),
});

export const listNodeSchema = z.strictObject({
  type: z.literal('list'),
  ...identified,
  kind: z.enum(['ordered', 'unordered', 'definition']),
  // CNT-153: local to this list and independent of the outline's numbering.
  start: z.number().int().min(0).optional(),
  format: z.enum(['decimal', 'alphabetic', 'roman']).optional(),
  // A list item holds block content, so nesting is unbounded by construction and CNT-118's six
  // levels is a floor rather than a limit.
  //
  // An item of a definition list carries the term it defines, as inline content rather than a
  // string: a term is a phrase an author writes, and a plain string is what makes an equation, a
  // mark or a cross-reference unrepresentable in a caption (issue #88). Optional, and so additive -
  // every document stored under schema version 1 stays valid, the canonical form of one is
  // unchanged, `CURRENT_SCHEMA_VERSION` stays 1 and the migration chain stays empty. Optional on a
  // definition list's item too, because an item whose term has not been typed yet is where a cursor
  // stands, as CNT-124's empty paragraph is. WHERE a term may stand at all is a rule in the walk
  // (`document.ts`) rather than a shape here, because it is a narrowing, and a narrowing is safe to
  // add while nothing has stored a list where tightening this insert-only shape later would not be.
  // The same reasoning keeps `start`'s `min(0)` above. `min(1)` is not a narrowing of that kind: an
  // empty term is a second spelling of an absent one, and one document may not have two digests.
  //
  // It reaches no further than that, and deliberately: a term holding a space, or a zero-width
  // space, is a third spelling with a digest of its own, and it is accepted - exactly as a
  // paragraph holding a space is accepted, and by the same rule, since a run of whitespace is a run
  // with text in it. Refusing here and nowhere else would make the term the one inline home in the
  // model with a notion of blankness the rest does not share.
  items: z
    .array(
      z.strictObject({
        term: z.array(inlineNodeSchema).min(1).optional(),
        content: z.array(blockNodeSchema).min(1),
      }),
    )
    .min(1),
});

/** One stored list, in all three of CNT-117's kinds, as the repository spells such a narrowing. */
export type ListNode = Extract<BlockNode, { type: 'list' }>;

/**
 * Whether a list's start number is one its numbering cannot express: a zeroth item is a convention
 * decimal has and letters and roman numerals do not (CNT-153, which superseded CNT-119 for it).
 *
 * **One predicate, asked in two places, deliberately.** `checkBlock` asks it on the way in, so that
 * no producer - an author, an import, a paste, a future API client - can store the shape and be told
 * weeks later; `assemble` asks it again as a publish-time backstop, so that content assembled by any
 * path is refused by name rather than numbered from something nobody wrote. Both are required, and
 * two spellings of one rule would let a change to either side pass silently - which is why there is
 * one spelling, here, and neither side carries a copy of it.
 */
export function startsOutsideItsNumbering(list: ListNode): boolean {
  return list.start === 0 && (list.format === 'alphabetic' || list.format === 'roman');
}

/**
 * **A figure or a table the author has marked unnumbered** (issue #129, STR-071; W14's W-H): it takes
 * no number and uses up none. Absent is numbered, and `false` is the only value stored, so a numbered
 * one has one spelling and one digest - `numbered: true` stored explicitly would be a second. Optional,
 * and so additive, as a definition list's term is: every table and figure stored before it stays
 * valid, its canonical form unchanged, and `CURRENT_SCHEMA_VERSION` stays 1. An equation says
 * `numbered` always (CNT-047), because it was stored that way from its first version; a figure and a
 * table were stored without it, and a required member would have been a migration.
 */
const unnumbered = z.literal(false).optional();

export const tableNodeSchema = z.strictObject({
  type: z.literal('table'),
  ...identified,
  /** CNT-094: a table takes its appearance from a table style (STY-012), as a paragraph does from its. */
  style: z.string().min(1).default('table'),
  /**
   * Inline content, as a paragraph's is, so a caption can hold a mark, a link, an equation (CNT-046)
   * or a cross-reference (issue #88). A string until tables 1, changed in place at schema version 1
   * because a read-only count found no table or figure stored anywhere.
   */
  caption: z.array(inlineNodeSchema),
  headerRows: z.number().int().min(0),
  headerColumns: z.number().int().min(0),
  /** CNT-107: where declared, a footnote anchors by key value rather than by position. */
  keyColumns: z.array(z.number().int().min(0)).optional(),
  /** CNT-038: a note on the table as a whole, which is not an inline anchor because a table is not a span. */
  note: z.array(inlineNodeSchema).optional(),
  numbered: unnumbered,
  // The grid - rows covering one number of columns, no two cells covering one place - is a rule of
  // the walk, which can see the whole table (`checkTable` in document.ts).
  rows: z
    .array(
      z.strictObject({
        cells: z.array(
          z.strictObject({
            // At least one block, as a list item holds: a cursor needs somewhere to stand.
            content: z.array(blockNodeSchema).min(1),
            colspan: z.number().int().min(1).default(1),
            rowspan: z.number().int().min(1).default(1),
          }),
        ),
      }),
    )
    .min(1),
});

/** The most columns a bound table shows, and the most it sorts by (tables.md, "The presentation"). */
export const BOUND_TABLE_COLUMNS_MAX = 64;
export const BOUND_TABLE_SORT_MAX = 4;

/**
 * **A column a bound table shows** (TAB-001 to TAB-003, TAB-036; no-wrap, half of TAB-035): the result column by its
 * name, never a position; its header, 1 to 200 characters in NFC; a unit printed in the header or
 * after each value; a format merged over the table style's (TAB-037); an alignment over the type's
 * (TAB-046); and `wrap: false` where it must not wrap - `false` the only value stored, as `numbered`.
 */
export const boundColumnSchema = z.strictObject({
  column: sourceNameSchema,
  header: boundedText(1, 200),
  unit: z.strictObject({ text: boundedText(1, 40), place: z.enum(['header', 'value']) }).optional(),
  format: fieldFormatSchema.optional(),
  align: z.enum(COLUMN_ALIGNMENTS).optional(),
  wrap: z.literal(false).optional(),
});

export type BoundColumn = z.infer<typeof boundColumnSchema>;

/** A stable sort key (TAB-007): a result column by name, its direction, and where its nulls go. */
const sortKeySchema = z.strictObject({
  column: sourceNameSchema,
  direction: z.enum(['ascending', 'descending']),
  nulls: z.enum(['first', 'last']),
});

/**
 * **A bound table** (tables.md; the TB1 plan, TB1-A and TB1-B): a block holding a binding to a whole
 * result - an inline binding's members with no `take` - and the presentation that makes a table of it.
 * Additive at content schema 1, as B6's figure binding was: nothing stored before holds one. TB3
 * adds `notes`, an optional member, additive again. What zod
 * cannot hold - a column shown twice under one header, a sort naming one twice - is the walk's
 * (`document.ts`).
 */
export type BoundTableNode = {
  type: 'boundTable';
  id: string;
  style: string;
  numbered?: false | undefined;
  binding: z.infer<typeof tableBindingSchema>;
  caption: z.infer<typeof inlineNodeSchema>[];
  columns: BoundColumn[];
  headerColumn: boolean;
  sort?: z.infer<typeof sortKeySchema>[] | undefined;
  empty?: z.infer<typeof inlineNodeSchema>[] | undefined;
  source?: z.infer<typeof inlineNodeSchema>[] | undefined;
  note?: z.infer<typeof inlineNodeSchema>[] | undefined;
  notes?: z.infer<typeof footnoteNodeSchema>[] | undefined;
};

/** The most notes a bound table holds (the TB3 plan, TB3-A). */
export const BOUND_TABLE_NOTES_MAX = 200;

export const boundTableNodeSchema = z.strictObject({
  type: z.literal('boundTable'),
  ...identified,
  style: z.string().min(1).default('table'),
  numbered: unnumbered,
  binding: tableBindingSchema,
  caption: z.array(inlineNodeSchema),
  columns: z.array(boundColumnSchema).min(1).max(BOUND_TABLE_COLUMNS_MAX),
  headerColumn: z.boolean(),
  sort: z.array(sortKeySchema).min(1).max(BOUND_TABLE_SORT_MAX).optional(),
  // `min(1)`, each: an empty one is a second spelling of an absent one, as an attribution's is.
  empty: z.array(inlineNodeSchema).min(1).optional(),
  source: z.array(inlineNodeSchema).min(1).optional(),
  note: z.array(inlineNodeSchema).min(1).optional(),
  // Anchored `keyed` or `column`, and only those (TB3-A), which the walk holds.
  notes: z.array(footnoteNodeSchema).min(1).max(BOUND_TABLE_NOTES_MAX).optional(),
});

export const figureNodeSchema = z.strictObject({
  type: z.literal('figure'),
  ...identified,
  // An asset VERSION, pinned (figures 1, R4; decision F-H): a component version shows the image it
  // was saved with. Tightened in place at schema version 1 on a read-only count of none stored.
  //
  // **Or a binding** (the B6 plan, B6-A): a whole binding node taking an image column, placed as this
  // figure's image. Exactly one of the two, held by the walk (`figure_image`). Additive at schema 1
  // (B6-B): every figure stored before has `asset` and no `binding`, so it parses and digests as it did.
  asset: artifactIdentifierSchema.optional(),
  binding: bindingNodeSchema.optional(),
  imageStyle: z.string().min(1),
  /** Inline content, as a table's caption is (issue #88). */
  caption: z.array(inlineNodeSchema),
  alternative: alternativeSchema,
  numbered: unnumbered,
});

export const preformattedNodeSchema = z.strictObject({
  type: z.literal('preformatted'),
  ...identified,
  text: z.string(),
  language: z.string().min(1).optional(),
});

export const blockquoteNodeSchema = z.strictObject({
  type: z.literal('blockquote'),
  ...identified,
  content: z.array(blockNodeSchema).min(1),
  // `min(1)`: an empty attribution is a second spelling of an absent one (editor 5, decision G).
  attribution: z.array(inlineNodeSchema).min(1).optional(),
});

export const blockEquationNodeSchema = z.strictObject({
  type: z.literal('equation'),
  ...identified,
  ...equationContentSchema,
  /** CNT-047: numbered or explicitly unnumbered. There is no third state. */
  numbered: z.boolean(),
});

/**
 * CNT-129: a restricted block sequence. The schema admits paragraphs alone, closing out a table; an
 * image and a footnote are refused too, by the walk in `document.ts` rather than here.
 */
export const footnoteContentSchema = z.array(paragraphNodeSchema).min(1);
