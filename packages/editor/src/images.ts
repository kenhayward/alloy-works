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
 */
export const imagesUnmarked = new Plugin({
  appendTransaction(transactions, _before, state) {
    if (!transactions.some((transaction) => transaction.docChanged)) return null;
    const marked: { from: number; to: number }[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type === imageNode && node.marks.length > 0) {
        marked.push({ from: pos, to: pos + node.nodeSize });
      }
      return true;
    });
    if (marked.length === 0) return null;
    const tr = state.tr;
    for (const { from, to } of marked) {
      for (const mark of tr.doc.nodeAt(from)!.marks) tr.removeMark(from, to, mark.type);
    }
    return tr;
  },
});

/** Removes the selected image, leaving the cursor where it stood. */
export const deleteImage: Command = (state, dispatch) => {
  if (imageAt(state) === null) return false;
  if (dispatch) dispatch(state.tr.deleteSelection().scrollIntoView());
  return true;
};
