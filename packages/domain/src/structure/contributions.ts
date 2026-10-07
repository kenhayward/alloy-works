import type { BlockNode } from '../content/model/blocks.js';
import type { InlineNode } from '../content/model/inline.js';
import { placeTableNotes } from '../data/table-notes.js';
import type { Bound } from '../publishing/bind.js';

/**
 * What one caption-bearing block (CNT-081) or one footnote contributes to the sequences: its
 * identifier, the sequence it takes from, and whether it takes a number at all - a block equation can
 * say no (CNT-047), and a figure or a table the author marked unnumbered does (STR-071). A small
 * projection of content: no position, and no text but a figure's or a table's caption, which a
 * generated list shows beside its number. The numbering table copies none of it, so the table still
 * carries nothing a component holds but the identifiers it already exposes.
 */
export interface Contribution {
  readonly block: string;
  readonly sequence: string;
  readonly numbered: boolean;
  /** A figure's or a table's caption, for a generated list to show beside its number. */
  readonly caption?: string;
  /**
   * A footnote in a table's cell (TB3-D): sequence `tableNote`, out of the document's footnotes,
   * lettered in its table's own sequence by `placeTableNotes`, which `number` labels after its table's.
   */
  readonly table?: string;
  readonly letter?: string;
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

/**
 * A caption's words, for a generated list: its text runs joined. A caption is inline content, and what
 * a list sets beside a number is the text a reader sees there; the marks and anything that is not text
 * are the published caption's, which tables 2 carries.
 */
export function captionText(caption: readonly InlineNode[]): string {
  return caption.map((inline) => (inline.type === 'text' ? inline.value : '')).join('');
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
      // The table takes its number before anything inside it. **A footnote in a table leaves the
      // document's sequence** (TB3-D): a cell's is lettered in the table's own, and its caption's and
      // note's, which `assemble` refuses, take nothing. A table holds no table or figure, and a cell
      // no equation block (decision T-D), so nothing else inside it is numbered.
      return [
        {
          block: block.id,
          sequence: 'table',
          numbered: block.numbered !== false,
          caption: captionText(block.caption),
        },
        ...placeTableNotes(block).map(({ note, letter }): Contribution => ({
          block: note.id,
          sequence: 'tableNote',
          // As its table is (STR-071): one in an unnumbered table has no label, and no number form.
          numbered: block.numbered !== false,
          table: block.id,
          letter,
        })),
      ];
    case 'boundTable':
      // Numbered as a table, with its caption (the TB1 plan, TB1-D), so the page's numbers equal the
      // publish's, where the stage has set it as one. Its notes are lettered by its rows, which the
      // page's numbering has not got, and the footnotes in its words take nothing (TB3-D).
      return [
        {
          block: block.id,
          sequence: 'table',
          numbered: block.numbered !== false,
          caption: captionText(block.caption),
        },
      ];
    case 'figure':
      return [
        {
          block: block.id,
          sequence: 'figure',
          numbered: block.numbered !== false,
          caption: captionText(block.caption),
        },
        ...inlineContributions(block.caption),
      ];
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
 * What a component's content contributes to the sequences, in document order (STR-071): every figure,
 * table and block equation with whether it is numbered, and every footnote, wherever each is
 * nested - a list item, a blockquote, a table cell. Pure, and linear in the content. It reads content
 * that has already been through `parseContentDocument`, so it recurses no deeper than that parse did.
 *
 * **It takes `Bound` content alone** (the B3 plan, B3-D; PUB-108): what has been through the binding
 * stage, so a caption is counted with its values in it. The document page counts through `unbound`,
 * the one named way to count without values.
 */
export function contributionsOf(content: Bound): Contribution[] {
  return content.content.flatMap(blockContributions);
}
