import { z } from 'zod';

/**
 * The canonical content model: a tree of typed NODES carrying MARKS applied to ranges of text.
 * See docs/decisions/0005-purpose-built-node-and-mark-content-model.md.
 *
 * The whole point of the mark half is that a mark is a member of a set applied to a range, not an
 * element that has to nest. Two annotations over overlapping ranges therefore need no construct of
 * their own: the overlap simply produces a text node carrying both. What makes that usable rather
 * than merely representable is that every mark carries an `id`, so an annotation split across
 * several fragments is still one annotation, and accepting or excluding it is one action.
 *
 * This is a spike draft. It covers what the gate cases in
 * docs/specification/Content_Model_Spike.md need and deliberately nothing else.
 */

/**
 * Every mark is a semantic annotation. None is a positional marker paired with a partner
 * elsewhere in the tree - that is what standoff markup needs, and needing it would mean the model
 * had failed on its own terms.
 */
export const markTypes = ['comment', 'condition', 'suggestion'] as const;

export type MarkType = (typeof markTypes)[number];

const markId = z.string().min(1);

/** Profiling. Content survives publication when the document's profile selects one of `values`. */
export const conditionMarkSchema = z.object({
  type: z.literal('condition'),
  id: markId,
  axis: z.string().min(1),
  values: z.array(z.string().min(1)).min(1),
});

/** A proposed change, shown as a redline, that an author accepts or rejects. */
export const suggestionMarkSchema = z.object({
  type: z.literal('suggestion'),
  id: markId,
  operation: z.enum(['insert', 'delete']),
  author: z.string().min(1),
});

/** The anchor half of a review thread. The thread itself lives outside the content. */
export const commentMarkSchema = z.object({
  type: z.literal('comment'),
  id: markId,
  threadId: z.string().min(1),
});

export const markSchema = z.discriminatedUnion('type', [
  commentMarkSchema,
  conditionMarkSchema,
  suggestionMarkSchema,
]);

export type Mark = z.infer<typeof markSchema>;
export type ConditionMark = z.infer<typeof conditionMarkSchema>;
export type SuggestionMark = z.infer<typeof suggestionMarkSchema>;
export type CommentMark = z.infer<typeof commentMarkSchema>;

export const textNodeSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  marks: z.array(markSchema),
});

/**
 * A footnote anchored to a point in running text. Its content is text runs rather than arbitrary
 * blocks: enough for the gate cases, and deliberately not more. Case 4 - a citation inside a
 * footnote inside a table cell - is what decides whether this has to become fully recursive.
 */
export const footnoteNodeSchema = z.object({
  type: z.literal('footnote'),
  id: z.string().min(1),
  content: z.array(textNodeSchema),
});

/**
 * A reference to something else by identity. It carries no number and no title: those are resolved
 * at publish time in the context of the document doing the resolving, which is what lets the same
 * component be referenced from two documents that number it differently.
 */
export const crossReferenceNodeSchema = z.object({
  type: z.literal('crossReference'),
  targetId: z.string().min(1),
  display: z.enum(['number', 'title', 'page']),
});

export const inlineNodeSchema = z.discriminatedUnion('type', [
  textNodeSchema,
  footnoteNodeSchema,
  crossReferenceNodeSchema,
]);

/**
 * Blocks carry a stable `id`. It is what lets comparison say "this paragraph moved and was
 * reworded" instead of "a paragraph vanished and a different one appeared" - see case 7. The id
 * has to be in the schema from the first revision ever stored, because revisions are immutable
 * and an id cannot be granted retrospectively to content that was written without one.
 *
 * It is optional only because content can arrive without identity - imported from Word, restored
 * from an export, or authored in an unrelated session. Comparison falls back to content similarity
 * for those, and says that it did.
 */
export const paragraphNodeSchema = z.object({
  type: z.literal('paragraph'),
  id: z.string().min(1).optional(),
  content: z.array(inlineNodeSchema),
});

/**
 * A footnote anchored to one cell of a table a query produces.
 *
 * The anchor names the DATA, never the position: the value of the table's key column, plus a
 * column name. A row index would be meaningless against generated content - the next run of the
 * same query can reorder, insert or drop rows without the document having been edited at all. The
 * anchor is `strictObject` so that `rowIndex` is a validation failure rather than a silent
 * misunderstanding.
 */
export const cellFootnoteSchema = z.object({
  id: z.string().min(1),
  anchor: z.strictObject({
    rowKey: z.string().min(1),
    column: z.string().min(1),
  }),
  content: z.array(paragraphNodeSchema),
});

/** A table whose rows come from a query rather than from an author. */
export const boundTableNodeSchema = z.object({
  type: z.literal('boundTable'),
  id: z.string().min(1),
  query: z.object({
    id: z.string().min(1),
    parameters: z.record(z.string(), z.string()),
  }),
  /** The column whose value identifies a row, and therefore anchors anything attached to it. */
  keyColumn: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1),
  footnotes: z.array(cellFootnoteSchema),
});

export const blockNodeSchema = z.discriminatedUnion('type', [
  paragraphNodeSchema,
  boundTableNodeSchema,
]);

export const contentDocumentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(blockNodeSchema),
});

export type TextNode = z.infer<typeof textNodeSchema>;
export type FootnoteNode = z.infer<typeof footnoteNodeSchema>;
export type CrossReferenceNode = z.infer<typeof crossReferenceNodeSchema>;
export type InlineNode = z.infer<typeof inlineNodeSchema>;
export type ParagraphNode = z.infer<typeof paragraphNodeSchema>;
export type CellFootnote = z.infer<typeof cellFootnoteSchema>;
export type BoundTableNode = z.infer<typeof boundTableNodeSchema>;
export type BlockNode = z.infer<typeof blockNodeSchema>;
export type ContentDocument = z.infer<typeof contentDocumentSchema>;

/** Validates an untrusted value - anything read from storage, IPC or the network. */
export function parseContentDocument(value: unknown): ContentDocument {
  return contentDocumentSchema.parse(value);
}

export function condition(
  id: string,
  { axis, values }: { axis: string; values: readonly string[] },
): ConditionMark {
  return conditionMarkSchema.parse({ type: 'condition', id, axis, values: [...values] });
}

export function suggestion(
  id: string,
  { operation, author }: { operation: SuggestionMark['operation']; author: string },
): SuggestionMark {
  return suggestionMarkSchema.parse({ type: 'suggestion', id, operation, author });
}

export function comment(id: string, { threadId }: { threadId: string }): CommentMark {
  return commentMarkSchema.parse({ type: 'comment', id, threadId });
}

export function text(value: string, marks: readonly Mark[] = []): TextNode {
  return { type: 'text', text: value, marks: [...marks] };
}

export function footnote(id: string, content: readonly TextNode[]): FootnoteNode {
  return footnoteNodeSchema.parse({ type: 'footnote', id, content: [...content] });
}

export function crossReference(
  targetId: string,
  display: CrossReferenceNode['display'] = 'number',
): CrossReferenceNode {
  return crossReferenceNodeSchema.parse({ type: 'crossReference', targetId, display });
}

export function paragraph(content: readonly InlineNode[], id?: string): ParagraphNode {
  return id === undefined
    ? { type: 'paragraph', content: [...content] }
    : { type: 'paragraph', id, content: [...content] };
}

export function cellFootnote(value: {
  id: string;
  anchor: { rowKey: string; column: string };
  content: readonly ParagraphNode[];
}): CellFootnote {
  return cellFootnoteSchema.parse(value);
}

export function boundTable(value: {
  id: string;
  query: { id: string; parameters: Record<string, string> };
  keyColumn: string;
  columns: readonly string[];
  footnotes: readonly CellFootnote[];
}): BoundTableNode {
  return boundTableNodeSchema.parse({ type: 'boundTable', ...value });
}

export function doc(content: readonly BlockNode[]): ContentDocument {
  return parseContentDocument({ type: 'doc', content: [...content] });
}
