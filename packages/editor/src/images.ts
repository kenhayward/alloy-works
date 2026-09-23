import type { Alternative } from '@alloy-works/domain';
import {
  NodeSelection,
  Plugin,
  TextSelection,
  type Command,
  type EditorState,
} from 'prosemirror-state';

import { kept } from './figures.js';
import { editorSchema } from './schema.js';

const imageNode = editorSchema.nodes.image!;
const footnoteNode = editorSchema.nodes.footnote!;
const crossReferenceNode = editorSchema.nodes.crossReference!;

/**
 * An inline node that carries no marks and ends no annotation: an image, a footnote's mark and a
 * cross-reference (cross-references 1, ruling R6). Asked of a node wherever it stands, so the rule
 * reaches every inline home a reference has - a caption and a term among them, where no image stands.
 */
const unmarkedInline = (node: { type: unknown }) =>
  node.type === imageNode || node.type === footnoteNode || node.type === crossReferenceNode;
const paragraphNode = editorSchema.nodes.paragraph!;

/** The image selected whole, as the panel reads it: where it stands, what it shows, how it is described. */
export interface ImageAt {
  /** Where the `image` node starts. */
  readonly pos: number;
  readonly asset: string;
  readonly alternative: Alternative;
}

/** The inline image selected whole, or null: an image is an atom, so it is only ever selected so. */
export function imageAt(state: EditorState): ImageAt | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== imageNode) return null;
  return {
    pos: selection.from,
    asset: selection.node.attrs.asset as string,
    alternative: selection.node.attrs.alternative as Alternative,
  };
}

/**
 * **Image**: the image just uploaded, with the alternative text the dialog was answered with, at the
 * cursor in a paragraph - in place of what is selected within it - with the cursor after it (figures 4,
 * rulings R2 and R5). A paragraph is the one place an image stands, wherever the paragraph is; a term,
 * an attribution, a caption and preformatted text take none. An own text that says nothing is not
 * stored, as a figure's is not.
 */
export function insertImage(asset: string, alternative: Alternative): Command {
  return (state, dispatch) => {
    const given = kept(alternative);
    const { $from, $to } = state.selection;
    if (given === null || !$from.sameParent($to) || $from.parent.type !== paragraphNode) {
      return false;
    }
    if (dispatch) {
      const image = imageNode.create({ asset, imageStyle: 'inline', alternative: given });
      const tr = state.tr.replaceSelectionWith(image, false);
      const after = tr.mapping.map(state.selection.to);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, after)).scrollIntoView());
    }
    return true;
  };
}

/** Changes the selected image's attributes, keeping it where it stands. */
function changeImage(change: (attrs: Record<string, unknown>) => Record<string, unknown>): Command {
  return (state, dispatch) => {
    const image = imageAt(state);
    if (image === null) return false;
    if (dispatch) {
      const node = state.doc.nodeAt(image.pos)!;
      const tr = state.tr.setNodeMarkup(image.pos, undefined, change({ ...node.attrs }));
      // Still selected whole, so the panel stays on it.
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, image.pos)));
    }
    return true;
  };
}

/** Sets how the selected image's alternative text is given; an own text that says nothing is refused. */
export function setImageAlternative(alternative: Alternative): Command {
  const given = kept(alternative);
  return given === null ? () => false : changeImage((attrs) => ({ ...attrs, alternative: given }));
}

/** Gives the selected image another asset version, and how its alternative text is given with it. */
export function replaceImageAsset(asset: string, alternative: Alternative): Command {
  const given = kept(alternative);
  return given === null
    ? () => false
    : changeImage((attrs) => ({ ...attrs, asset, alternative: given }));
}

/**
 * **An image carries no marks** (ruling R1), kept after every transaction. A paragraph allows every
 * mark, and ProseMirror puts a mark on each inline node it is applied over, so a mark put over words
 * and an image rested on the image too - shown on the surface, never stored, since the stored image
 * has no marks (final review of figures 4). Taken off in the transaction that put it there, so an undo
 * has nothing of it to bring back.
 *
 * **A footnote carries none either** (footnotes 1, ruling R4), and for it the mark is taken off the
 * node alone: taken off over the node's range, it would come off the footnote's own text too. Nor
 * does a cross-reference (cross-references 1, ruling R6).
 */
export const imagesUnmarked = new Plugin({
  appendTransaction(transactions, _before, state) {
    if (!transactions.some((transaction) => transaction.docChanged)) return null;
    const marked: number[] = [];
    state.doc.descendants((node, pos) => {
      if (unmarkedInline(node) && node.marks.length > 0) marked.push(pos);
      return true;
    });
    if (marked.length === 0) return null;
    const tr = state.tr;
    for (const pos of marked) {
      for (const mark of tr.doc.nodeAt(pos)!.marks) tr.removeNodeMark(pos, mark);
    }
    return tr;
  },
});

/**
 * **A cursor straight after an image carries the marks of the text before it**, as though the image
 * were not there. ProseMirror takes the marks for what is typed from the node before the cursor, and an
 * image carries none, so text typed there fell out of the link or the emphasis it stood in, and the
 * link was split and its far half renamed (re-review of figures 4). ProseMirror's own rule decides which
 * carry on: an inclusive mark does, and one that is not - a link - only where the text after has it
 * too. Set as the stored marks, which typing reads first, and never over marks a command stored. A
 * footnote's mark is passed over the same way (footnotes 1, ruling R4), and so is a cross-reference.
 */
export const marksPastImages = new Plugin({
  appendTransaction(transactions, _before, state) {
    if (!transactions.some((each) => each.docChanged || each.selectionSet)) return null;
    const { selection, storedMarks } = state;
    if (!selection.empty || storedMarks !== null) return null;
    const { $from } = selection;
    const parent = $from.parent;
    if (!parent.inlineContent || $from.textOffset !== 0) return null;
    let index = $from.index() - 1;
    if (index < 0 || !unmarkedInline(parent.child(index))) return null;
    while (index >= 0 && unmarkedInline(parent.child(index))) index -= 1;
    if (index < 0) return null;
    const before = parent.child(index);
    const after = parent.maybeChild($from.index());
    const marks = before.marks.filter(
      (mark) => mark.type.spec.inclusive !== false || (after !== null && mark.isInSet(after.marks)),
    );
    return marks.length === 0 ? null : state.tr.setStoredMarks(marks);
  },
});

/** Removes the selected image, leaving the cursor where it stood. */
export const deleteImage: Command = (state, dispatch) => {
  if (imageAt(state) === null) return false;
  if (dispatch) dispatch(state.tr.deleteSelection().scrollIntoView());
  return true;
};
