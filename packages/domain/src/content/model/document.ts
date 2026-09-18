import { z } from 'zod';

import { blockNodeSchema, footnoteContentSchema, type BlockNode } from './blocks.js';
import type { InlineNode } from './inline.js';

export const CURRENT_SCHEMA_VERSION = 1;

const bcp47 = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/, 'not a BCP 47 tag');

/**
 * The root, and its members are closed (CNT-146). The component's identifier belongs to the artifact
 * rather than to its content; everything else a component carries whatever its type is here.
 */
export const contentDocumentSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  title: z.string().min(1),
  language: bcp47,
  direction: z.enum(['ltr', 'rtl']),
  content: z.array(blockNodeSchema).min(1),
});

export type ContentDocument = z.infer<typeof contentDocumentSchema>;

function walk(blocks: readonly BlockNode[], visit: (block: BlockNode) => void): void {
  for (const block of blocks) {
    visit(block);
    if (block.type === 'list') for (const item of block.items) walk(item.content, visit);
    if (block.type === 'blockquote') walk(block.content, visit);
    if (block.type === 'table') {
      for (const row of block.rows) for (const cell of row.cells) walk(cell.content, visit);
    }
  }
}

/** Adds an identifier to those already held, refusing one already there (CNT-002). */
function claim(id: string, seen: Set<string>): void {
  if (seen.has(id)) throw new Error(`Identifier ${id} is used more than once in this component`);
  seen.add(id);
}

/**
 * The rules inline content is held to wherever it is stored, in one walk. The walk cannot live in
 * `inline.ts`, because a footnote holds blocks and a block holds inlines - so one of the two files
 * has to learn about the other after the fact, and this is that place.
 *
 * - **A footnote holds paragraphs** (CNT-129), and its content is parsed as such here.
 * - **Every identifier inside is claimed in `seen`** - a footnote's own and each of its paragraphs' -
 *   so none can share one with a block or with anything else in what holds it (CNT-002, issue #122).
 *   A cross-reference targets a footnote by identity (STR-026), so one it shared would name two
 *   things.
 *
 * Exported because inline content is stored in more than one place: a section title in an outline
 * is inline content too (structure.md), and runs this same walk rather than a copy of it, so one rule
 * governs inline content wherever it is stored. Throws on the first breach.
 */
export function checkInlineContent(inlines: readonly InlineNode[], seen: Set<string>): void {
  for (const inline of inlines) {
    if (inline.type !== 'footnote') continue;
    claim(inline.id, seen);
    for (const paragraph of footnoteContentSchema.parse(inline.content)) {
      claim(paragraph.id, seen);
      checkInlineContent(paragraph.content, seen);
    }
  }
}

/**
 * The one entry point. Validates on creation, on change and on read-back (CNT-010); nothing else
 * constructs a document.
 *
 * Three rules the schema cannot express on its own, because each is about a document rather than a
 * node: identifiers are unique within the component (CNT-002), two adjacent empty paragraphs are
 * refused (CNT-023), and a footnote's content is a restricted block sequence (CNT-129). A single
 * empty paragraph is admitted, because CNT-124 requires a new component to be one.
 */
export function parseContentDocument(value: unknown): ContentDocument {
  const document = contentDocumentSchema.parse(value);

  const seen = new Set<string>();
  walk(document.content, (block) => {
    claim(block.id, seen);
    if (block.type === 'paragraph') checkInlineContent(block.content, seen);
    if (block.type === 'blockquote' && block.attribution) {
      checkInlineContent(block.attribution, seen);
    }
    if (block.type === 'table' && block.note) checkInlineContent(block.note, seen);
  });

  const isEmptyParagraph = (block: BlockNode) =>
    block.type === 'paragraph' && block.content.length === 0;
  const refuseAdjacentEmpties = (blocks: readonly BlockNode[]) => {
    for (let index = 1; index < blocks.length; index += 1) {
      const previous = blocks[index - 1];
      const current = blocks[index];
      if (previous && current && isEmptyParagraph(previous) && isEmptyParagraph(current)) {
        throw new Error(`Blocks ${previous.id} and ${current.id} are adjacent empty paragraphs`);
      }
    }
  };
  refuseAdjacentEmpties(document.content);
  walk(document.content, (block) => {
    if (block.type === 'list') for (const item of block.items) refuseAdjacentEmpties(item.content);
    if (block.type === 'blockquote') refuseAdjacentEmpties(block.content);
  });

  return document;
}
