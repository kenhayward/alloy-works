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

/**
 * Refuses an identifier not already in NFC. The canonical form writes every string in NFC, so two
 * spellings of one identifier - composed and decomposed - would pass a comparison of raw strings as
 * two and be stored and digested as one; and a reference spelled one way would resolve where the
 * other would not. Refused rather than normalised: the caller stores exactly what the digest covers.
 */
function refuseUnnormalised(identifier: string, what: string): void {
  if (identifier !== identifier.normalize('NFC')) {
    throw new Error(`${what} ${identifier} is not in NFC`);
  }
}

/**
 * Adds an identifier to those already held, refusing one already there (CNT-002), or one not in NFC,
 * which the stored form would fold into another.
 */
function claim(id: string, seen: Set<string>): void {
  refuseUnnormalised(id, 'Identifier');
  if (seen.has(id)) throw new Error(`Identifier ${id} is used more than once in this component`);
  seen.add(id);
}

/**
 * Two adjacent empty paragraphs are spacing, which CNT-023 makes unrepresentable; one is where a
 * cursor stands (CNT-124). Held in every sequence of blocks the model has - the top level, a list
 * item, a blockquote, a table cell and a footnote - because admission's normalise collapses them in
 * every one, and a rule the two write paths disagree on is a rule one of them breaks.
 */
function refuseAdjacentEmpties(blocks: readonly BlockNode[]): void {
  const isEmptyParagraph = (block: BlockNode | undefined) =>
    block?.type === 'paragraph' && block.content.length === 0;
  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1];
    const current = blocks[index];
    if (previous && current && isEmptyParagraph(previous) && isEmptyParagraph(current)) {
      throw new Error(`Blocks ${previous.id} and ${current.id} are adjacent empty paragraphs`);
    }
  }
}

/**
 * The rules inline content is held to wherever it is stored, in one walk. The walk cannot live in
 * `inline.ts`, because a footnote holds blocks and a block holds inlines - so one of the two files
 * has to learn about the other after the fact, and this is that place.
 *
 * - **A footnote holds paragraphs** (CNT-129), and its content is parsed as such here. Those
 *   paragraphs hold nothing outside CNT-129's closed list: no image, and no footnote - so the walk
 *   descends one footnote deep and no further, whatever it is given.
 * - **Every identifier inside is claimed in `seen`** - a footnote's own, each of its paragraphs', and
 *   a cross-reference's - so none can share one with a block or with anything else in what holds it
 *   (CNT-002, issue #122). A cross-reference targets a footnote by identity (STR-026), so one it
 *   shared would name two things. Each is in NFC, and so is the block a target names, because the
 *   stored form is.
 * - **A cross-reference targets only what its home can reach.** In a component, never an outline
 *   node: a node belongs to one document's outline, and a component is used in many. In a section
 *   title, an outline node alone: a title is in no component, and an outline is answered with a
 *   component the reader may not read withheld, which a title's reference would carry past.
 * - **A reference in a section title shows a number or a page, and nothing that could be a title.**
 *   Resolving a title that shows a title resolves that title, so a node naming itself, or two titles
 *   naming each other, would never finish. The `withoutPages` form a page reference falls back to is
 *   held to the same rule, and so is `relative`, which says nothing a heading needs. Widening this
 *   later, once resolution can refuse a cycle by name, changes nothing stored.
 *
 * **Returns the inlines as parsed** (issue #124): a footnote's content arrives unparsed, because the
 * inline schema cannot name a paragraph, so the walk hands back each footnote with its parsed
 * paragraphs in place of what arrived - their `style`, and their runs' `marks`, filled in as the
 * parse fills them in everywhere else. What is stored and digested is what is returned, so two
 * spellings of one footnote are one value, one canonical string and one digest. Everything else is
 * returned as it was given, already parsed by the schema that reached it.
 *
 * Exported because inline content is stored in more than one place: a section title in an outline
 * is inline content too (structure.md), and runs this same walk rather than a copy of it, so one rule
 * governs inline content wherever it is stored. Throws on the first breach.
 */
export function checkInlineContent(
  inlines: readonly InlineNode[],
  home: InlineHome,
  seen: Set<string>,
): InlineNode[] {
  return inlines.map((inline) => {
    if (inline.type === 'crossReference') {
      claim(inline.id, seen);
      if (inline.target.kind !== 'node') refuseUnnormalised(inline.target.block, 'Target');
      if (home === 'component' && inline.target.kind === 'node') {
        throw new Error(`Cross-reference ${inline.id} in a component targets an outline node`);
      }
      if (home === 'title' && inline.target.kind !== 'node') {
        throw new Error(`Cross-reference ${inline.id} in a title targets what a title cannot name`);
      }
      if (home === 'title' && !shownInATitle(inline)) {
        throw new Error(`Cross-reference ${inline.id} in a title shows what could name a title`);
      }
    }
    if (inline.type !== 'footnote') return inline;
    claim(inline.id, seen);
    const parsed = footnoteContentSchema.parse(inline.content);
    refuseAdjacentEmpties(parsed);
    const paragraphs = parsed.map((paragraph) => {
      claim(paragraph.id, seen);
      for (const inner of paragraph.content) {
        if (inner.type === 'image' || inner.type === 'footnote') {
          throw new Error(`Footnote ${inline.id} holds a node a footnote may not: ${inner.type}`);
        }
      }
      return { ...paragraph, content: checkInlineContent(paragraph.content, home, seen) };
    });
    return { ...inline, content: paragraphs };
  });
}

/**
 * The block half of the walk: claims every block's identifier, runs `checkInlineContent` over every
 * inline home a block has - a paragraph's content, a blockquote's attribution, a table's note - and
 * rebuilds each block from what it returns, so what is stored is the parsed form all the way down.
 */
function checkBlocks(blocks: readonly BlockNode[], seen: Set<string>): BlockNode[] {
  refuseAdjacentEmpties(blocks);
  return blocks.map((block) => checkBlock(block, seen));
}

function checkBlock(block: BlockNode, seen: Set<string>): BlockNode {
  claim(block.id, seen);
  switch (block.type) {
    case 'paragraph':
      return { ...block, content: checkInlineContent(block.content, 'component', seen) };
    case 'list':
      return {
        ...block,
        items: block.items.map((item) => ({ ...item, content: checkBlocks(item.content, seen) })),
      };
    case 'blockquote': {
      const attribution =
        block.attribution && checkInlineContent(block.attribution, 'component', seen);
      return {
        ...block,
        ...(attribution === undefined ? {} : { attribution }),
        content: checkBlocks(block.content, seen),
      };
    }
    case 'table': {
      const note = block.note && checkInlineContent(block.note, 'component', seen);
      return {
        ...block,
        ...(note === undefined ? {} : { note }),
        rows: block.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({ ...cell, content: checkBlocks(cell.content, seen) })),
        })),
      };
    }
    default:
      return block;
  }
}

/** Whether a reference shows only what cannot contain a title: a number, or a page falling back to one. */
function shownInATitle(reference: { display: string; withoutPages?: string | undefined }): boolean {
  if (reference.display === 'number') return true;
  return (
    reference.display === 'page' &&
    (reference.withoutPages === undefined || reference.withoutPages === 'number')
  );
}

/** Where inline content is stored, which decides what a cross-reference in it may target. */
export type InlineHome = 'component' | 'title';

/**
 * The one entry point. Validates on creation, on change and on read-back (CNT-010); nothing else
 * constructs a document.
 *
 * Four rules the schema cannot express on its own, because each is about a document rather than a
 * node: identifiers are unique within the component (CNT-002), two adjacent empty paragraphs are
 * refused (CNT-023), a footnote's content is a restricted block sequence (CNT-129), and a
 * cross-reference in a component never targets an outline node. One walk holds all four: the block
 * half here, and `checkInlineContent` for inline content, sharing one set of claimed identifiers, with
 * adjacency held in every sequence of blocks either half reaches, a footnote's among them. A single
 * empty paragraph is admitted, because CNT-124 requires a new component to be one. What is returned
 * is what the walk parsed, and nothing else.
 */
export function parseContentDocument(value: unknown): ContentDocument {
  const parsed = contentDocumentSchema.parse(value);
  return { ...parsed, content: checkBlocks(parsed.content, new Set()) };
}
