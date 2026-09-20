import { z } from 'zod';

import { alternativeSchema, equationContentSchema, inlineNodeSchema } from './inline.js';

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
      caption: string;
      headerRows: number;
      headerColumns: number;
      keyColumns?: number[] | undefined;
      note?: z.infer<typeof inlineNodeSchema>[] | undefined;
      rows: { cells: { content: BlockNode[]; colspan: number; rowspan: number }[] }[];
    }
  | {
      type: 'figure';
      id: string;
      asset: string;
      imageStyle: string;
      caption: string;
      alternative: z.infer<typeof alternativeSchema>;
    }
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
  // CNT-119: local to this list and independent of the outline's numbering.
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

export const tableNodeSchema = z.strictObject({
  type: z.literal('table'),
  ...identified,
  caption: z.string(),
  headerRows: z.number().int().min(0),
  headerColumns: z.number().int().min(0),
  /** CNT-107: where declared, a footnote anchors by key value rather than by position. */
  keyColumns: z.array(z.number().int().min(0)).optional(),
  /** CNT-038: a note on the table as a whole, which is not an inline anchor because a table is not a span. */
  note: z.array(inlineNodeSchema).optional(),
  rows: z.array(
    z.strictObject({
      cells: z.array(
        z.strictObject({
          content: z.array(blockNodeSchema),
          colspan: z.number().int().min(1).default(1),
          rowspan: z.number().int().min(1).default(1),
        }),
      ),
    }),
  ),
});

export const figureNodeSchema = z.strictObject({
  type: z.literal('figure'),
  ...identified,
  asset: z.string().min(1),
  imageStyle: z.string().min(1),
  caption: z.string(),
  alternative: alternativeSchema,
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
  attribution: z.array(inlineNodeSchema).optional(),
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
