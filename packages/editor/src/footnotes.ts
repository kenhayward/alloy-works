import type { Node } from 'prosemirror-model';
import { NodeSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';

import { editorSchema } from './schema.js';

const footnoteNode = editorSchema.nodes.footnote!;
const footnoteParagraphNode = editorSchema.nodes.footnoteParagraph!;
const paragraphNode = editorSchema.nodes.paragraph!;

/** A footnote selected whole, which is what opens its editor (footnotes 1, ruling R8). */
export interface FootnoteAt {
  /** Where the `footnote` node starts. */
  readonly pos: number;
  readonly id: string | null;
}

/** The footnote the selection holds whole, or null. */
export function footnoteAt(state: EditorState): FootnoteAt | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== footnoteNode) return null;
  return { pos: selection.from, id: (selection.node.attrs.id as string | null) ?? null };
}

/**
 * Places a footnote anchored to its span at the end of the selection, in a paragraph and nowhere else
 * (FN-A, FN-B), with one empty paragraph to write in, and selects it whole so its editor opens (ruling
 * R7). **What is selected stays where it is**: a footnote is placed after the words it is about, as
 * Word places one, never in their stead. Answered by the paragraph's own content expression, so a
 * footnote's paragraph - which holds text alone - declines without a rule of its own.
 */
export function insertFootnote(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const { $to } = state.selection;
    if ($to.parent.type !== paragraphNode) return false;
    const index = $to.index();
    if (!$to.parent.canReplaceWith(index, index, footnoteNode)) return false;
    if (dispatch) {
      const footnote = footnoteNode.create(
        { id: newIdentifier(), anchor: { kind: 'span' } },
        footnoteParagraphNode.create({ id: newIdentifier() }),
      );
      const tr = state.tr.insert($to.pos, footnote);
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, $to.pos)).scrollIntoView());
    }
    return true;
  };
}

/**
 * A mark command that leaves every footnote's text as it was (ruling R5). A mark put on, changed or
 * taken off over a range reaches every inline node inside it, a footnote's paragraphs included, and a
 * footnote's text is a range of its own: the words either side of a footnote are what an author
 * selected, not the note beneath them. A mark command changes no node's size, so each footnote is
 * where it was and its content is put back as it stood.
 *
 * Run over a footnote's own editing state, whose document is the footnote, there is no footnote
 * inside to spare and this changes nothing.
 */
export function sparingFootnotes(command: Command): Command {
  return (state, dispatch, view) =>
    command(
      state,
      dispatch &&
        ((tr: Transaction) => {
          const kept: { pos: number; node: Node }[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type !== footnoteNode) return true;
            kept.push({ pos, node });
            return false;
          });
          for (const { pos, node } of kept) {
            const now = tr.doc.nodeAt(pos);
            if (now?.type !== footnoteNode || now.content.eq(node.content)) continue;
            tr.replaceWith(pos + 1, pos + now.nodeSize - 1, node.content);
          }
          dispatch(tr);
        }),
      view,
    );
}

/** Whether a node is a footnote, whose content every walk of the component's own text passes over. */
export const isFootnote = (node: Node): boolean => node.type === footnoteNode;
