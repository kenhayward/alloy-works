import { z } from 'zod';

import { unitTexts } from '../compare/content.js';
import type { ContentDocument } from '../content/model/index.js';
import type { OutlineDocument, OutlineView } from '../structure/outline.js';
import { walkOutline } from '../structure/outline.js';

/**
 * Where a thread stands (collaboration.md, Threads; COL-012): a span of a component's text, by its
 * block and the text it quotes with the text before it; a table's cell, by its first block; a whole
 * component; or an outline node. Never a position, so it holds through any change that keeps its
 * block and its text (COL-016).
 */
export const threadAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('span'),
    block: z.string().min(1).max(64),
    quote: z.string().min(1).max(500),
    before: z.string().max(200),
  }),
  z.strictObject({
    kind: z.literal('cell'),
    table: z.string().min(1).max(64),
    block: z.string().min(1).max(64),
  }),
  z.strictObject({ kind: z.literal('component') }),
  z.strictObject({ kind: z.literal('node'), node: z.string().regex(/^[a-z2-7]{26}$/) }),
]);
export type ThreadAnchor = z.infer<typeof threadAnchorSchema>;

/** Any control character but a line feed: a comment is lines of words. */
const CONTROL = /(?!\n)\p{Cc}/u;

/**
 * A comment's text (TH-B): words and mentions, 1 to 4,000 characters of words, at most 20 mentions,
 * each a principal by identifier. Never markup.
 */
export const commentPartsSchema = z
  .array(
    z.union([
      z.strictObject({
        text: z
          .string()
          .min(1)
          .refine((value) => !CONTROL.test(value)),
      }),
      z.strictObject({ mention: z.uuid() }),
    ]),
  )
  .min(1)
  .refine(
    (parts) => {
      const words = parts.reduce(
        (sum, part) => sum + ('text' in part ? [...part.text].length : 0),
        0,
      );
      return words <= 4000;
    },
    { message: 'A comment is at most 4,000 characters' },
  )
  .refine((parts) => parts.filter((part) => 'mention' in part).length <= 20, {
    message: 'A comment names at most 20 people',
  });
export type CommentParts = z.infer<typeof commentPartsSchema>;

/** The people a comment names, each once, in the order first named. */
export function mentionsIn(parts: CommentParts): string[] {
  return [...new Set(parts.flatMap((part) => ('mention' in part ? [part.mention] : [])))];
}

/**
 * Whether an anchor still stands on what a thread is on (COL-016, COL-017): a span's block holds its
 * quoted text, a cell's first block stands in its table, a node is in the outline. The text is
 * `unitTexts`'s, the comparison's one account of a block's text, which suggestions will anchor by too.
 */
export function anchorStands(
  anchor: ThreadAnchor,
  on: { readonly content: ContentDocument } | { readonly outline: OutlineDocument | OutlineView },
): boolean {
  if (anchor.kind === 'component') return true;
  if (anchor.kind === 'node') {
    if (!('outline' in on)) return false;
    let found = false;
    walkOutline(on.outline.nodes as OutlineDocument['nodes'], (node) => {
      if (node.id === anchor.node) found = true;
    });
    return found;
  }
  if (!('content' in on)) return false;
  const texts = unitTexts(on.content);
  if (anchor.kind === 'cell') return texts.get(`cell:${anchor.block}`)?.parent === anchor.table;
  const block = texts.get(anchor.block);
  return block !== undefined && block.text.includes(anchor.quote);
}
