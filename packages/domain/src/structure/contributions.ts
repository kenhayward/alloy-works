import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';

/**
 * What one caption-bearing block (CNT-081) or one footnote contributes to the sequences: its
 * identifier, the sequence it takes from, and whether it takes a number at all - only a block equation
 * can say no (CNT-047). A small projection of content: no position, and no text but a figure's or a
 * table's caption, which a generated list shows beside its number. The numbering table copies none of
 * it, so the table still carries nothing a component holds but the identifiers it already exposes.
 */
export interface Contribution {
  readonly block: string;
  readonly sequence: string;
  readonly numbered: boolean;
  /** A figure's or a table's caption, for a generated list to show beside its number. */
  readonly caption?: string;
}

/**
 * Inline content's contributions, in document order: a footnote takes from the footnote sequence where
 * its anchor stands (CNT-041). A footnote holds no footnote (CNT-129, `checkInlineContent`), so this
 * does not descend into one.
 */
export function inlineContributions(inlines: readonly InlineNode[]): Contribution[] {
  return inlines.flatMap((inline) =>
    inline.type === 'footnote' ? [{ block: inline.id, sequence: 'footnote', numbered: true }] : [],
  );
}

function blockContributions(block: BlockNode): Contribution[] {
  switch (block.type) {
    case 'paragraph':
      return inlineContributions(block.content);
    case 'list':
      return block.items.flatMap((item) => item.content.flatMap(blockContributions));
    case 'blockquote':
      return [
        ...block.content.flatMap(blockContributions),
        ...inlineContributions(block.attribution ?? []),
      ];
    case 'table':
      // The table takes its number before anything inside it, and its note - rendered below the body -
      // after its cells.
      return [
        { block: block.id, sequence: 'table', numbered: true, caption: block.caption },
        ...block.rows.flatMap((row) =>
          row.cells.flatMap((cell) => cell.content.flatMap(blockContributions)),
        ),
        ...inlineContributions(block.note ?? []),
      ];
    case 'figure':
      return [{ block: block.id, sequence: 'figure', numbered: true, caption: block.caption }];
    case 'equation':
      return [{ block: block.id, sequence: 'equation', numbered: block.numbered }];
    case 'preformatted':
      return [];
    default: {
      // **Unreachable, and named rather than left to fall through.** The assignment is what makes
      // an eighth `BlockNode` kind fail to compile; the throw is what happens if one arrives anyway.
      // Falling through instead would return `undefined`, which every caller's `flatMap` folds into
      // the contributions - so a figure or a table inside the new kind would take no number, and
      // nothing would say why.
      const unreachable: never = block;
      throw new Error(
        `No contribution rule for a block of kind ${(unreachable as BlockNode).type}`,
      );
    }
  }
}

/**
 * What a component's content contributes to the sequences, in document order (STR-023): every figure
 * and table, every block equation with whether it is numbered, and every footnote, wherever each is
 * nested - a list item, a blockquote, a table cell. Pure, and linear in the content. It reads content
 * that has already been through `parseContentDocument`, so it recurses no deeper than that parse did.
 */
export function contributionsOf(content: ContentDocument): Contribution[] {
  return content.content.flatMap(blockContributions);
}
