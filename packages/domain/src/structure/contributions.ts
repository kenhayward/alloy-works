import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';

/**
 * What one caption-bearing block (CNT-081) or one footnote contributes to the sequences: its
 * identifier, the sequence it takes from, and whether it takes a number at all - only a block equation
 * can say no (CNT-047). A small projection of content, and nothing else: no caption text, no position,
 * so the numbering table carries nothing a component holds but the identifiers it already exposes.
 */
export interface Contribution {
  readonly block: string;
  readonly sequence: string;
  readonly numbered: boolean;
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
        { block: block.id, sequence: 'table', numbered: true },
        ...block.rows.flatMap((row) =>
          row.cells.flatMap((cell) => cell.content.flatMap(blockContributions)),
        ),
        ...inlineContributions(block.note ?? []),
      ];
    case 'figure':
      return [{ block: block.id, sequence: 'figure', numbered: true }];
    case 'equation':
      return [{ block: block.id, sequence: 'equation', numbered: block.numbered }];
    case 'preformatted':
      return [];
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
