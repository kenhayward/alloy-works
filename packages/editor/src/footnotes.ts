import type { Node } from 'prosemirror-model';
import { NodeSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

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

/** The footnote's own editor open in each surface, while one is (ruling R8). */
const opened = new WeakMap<EditorView, EditorView>();

/**
 * The nested editor over the footnote a surface has selected whole, or null where none is open: what
 * the toolbar and the prompts act on while it is (ruling R9).
 */
export function openFootnote(view: EditorView): EditorView | null {
  return opened.get(view) ?? null;
}

/** Records the footnote editor open in a surface, or that none is; `footnoteView`'s alone to call. */
export function recordOpenFootnote(view: EditorView, inner: EditorView | null): void {
  if (inner === null) opened.delete(view);
  else opened.set(view, inner);
}

/**
 * `Enter` on a footnote selected whole puts the focus in its editor (ruling R8), and never falls
 * through to a split, which would replace the selected footnote with a paragraph break.
 */
export const enterFootnote: Command = (state, _dispatch, view) => {
  if (footnoteAt(state) === null) return false;
  if (view !== undefined) openFootnote(view)?.focus();
  return true;
};

/**
 * Places a footnote anchored to its span at the end of the selection, in a paragraph and nowhere else
 * (FN-A, FN-B), with one empty paragraph to write in, and selects it whole so its editor opens (ruling
 * R7). **What is selected stays where it is**: a footnote is placed after the words it is about, as
 * Word places one, never in their stead. Answered by the paragraph's own content expression, so a
 * footnote's paragraph - which holds text alone - declines without a rule of its own.
 */
export function insertFootnote(newIdentifier: () => string): Command {
  return (state, dispatch, view) => {
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
      // Selected whole, its editor is open: the author writes the note next, as in Word.
      if (view !== undefined) openFootnote(view)?.focus();
    }
    return true;
  };
}

/**
 * A mark command that leaves every footnote's text as it was (ruling R5). A mark put on, changed or
 * taken off over a range reaches every inline node inside it, a footnote's paragraphs included, and a
 * footnote's text is a range of its own: the words either side of a footnote are what an author
 * selected, not the note beneath them. A mark command changes no node's size, so each footnote is
 * where it was, and each of its text nodes is given back the marks it had.
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
            // Mark by mark, text node by text node, so no position moves: a replace of the content
            // would read to the identity plugin as the footnote's later paragraphs placed anew, and
            // rename them (final review, finding 1).
            node.descendants((child, offset) => {
              if (!child.isText) return true;
              const from = pos + 1 + offset;
              const to = from + child.nodeSize;
              tr.removeMark(from, to);
              for (const mark of child.marks) tr.addMark(from, to, mark);
              return false;
            });
          }
          dispatch(tr);
        }),
      view,
    );
}

/** Whether a node is a footnote, whose content every walk of the component's own text passes over. */
export const isFootnote = (node: Node): boolean => node.type === footnoteNode;
