import type { CrossReferenceDisplay, CrossReferenceTarget } from '@alloy-works/domain';
import { NodeSelection, type Command, type EditorState } from 'prosemirror-state';

import { editorSchema } from './schema.js';

const crossReferenceNode = editorSchema.nodes.crossReference!;

/** What an author chooses for a reference in the dialog (cross-references 1, ruling R11). */
export interface ReferenceChoice {
  readonly target: CrossReferenceTarget;
  readonly display: CrossReferenceDisplay;
}

/** A cross-reference selected whole, as the dialog reads it to change one. */
export interface ReferenceAt {
  /** Where the `crossReference` node starts. */
  readonly pos: number;
  readonly id: string | null;
  readonly target: CrossReferenceTarget;
  readonly display: CrossReferenceDisplay;
  /** STR-055's form for an output with no pages, as stored; null where none is. */
  readonly withoutPages: string | null;
}

/** The reference the selection holds whole, or null: a reference is an atom, only ever selected so. */
export function referenceAt(state: EditorState): ReferenceAt | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== crossReferenceNode) {
    return null;
  }
  const { id, target, display, withoutPages } = selection.node.attrs;
  return {
    pos: selection.from,
    id: (id as string | null) ?? null,
    target: target as CrossReferenceTarget,
    display: display as CrossReferenceDisplay,
    withoutPages: (withoutPages as string | null) ?? null,
  };
}

/**
 * Whether a reference could be placed at the selection's end: in a node whose content expression
 * admits one there - a paragraph, a footnote's paragraph, a term, an attribution, a caption or a
 * table's note - and so never in preformatted text, and never with a table selected whole, whose end
 * stands between blocks. Answered by the content expressions rather than by a list of homes, as a
 * footnote's placement is, so a footnote's own editor admits one without a rule of its own.
 */
export const referencePlaceable = (state: EditorState): boolean => {
  const { $to } = state.selection;
  const index = $to.index();
  return $to.parent.inlineContent && $to.parent.canReplaceWith(index, index, crossReferenceNode);
};

/**
 * Places a reference at the end of the selection, in an inline home, and selects it whole (ruling
 * R9). **What is selected stays where it is**: a reference is placed after the words it follows, as a
 * footnote is, never in their stead. It carries no identifier: the identity plugin names it as it
 * names a block (ruling R7, XR-E), and a footnote's editor's transactions reach that plugin through
 * the component's own.
 */
export function insertReference({ target, display }: ReferenceChoice): Command {
  return (state, dispatch) => {
    if (!referencePlaceable(state)) return false;
    if (dispatch) {
      const { $to } = state.selection;
      const tr = state.tr.insert($to.pos, crossReferenceNode.create({ target, display }));
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, $to.pos)).scrollIntoView());
    }
    return true;
  };
}

/**
 * Changes the reference at `pos` to point at another target, or to show another form, keeping its
 * identifier - it is the same reference, changed - and keeping it selected whole, so the dialog that
 * changed it can be opened on it again. **A form for an output with no pages is dropped unless the
 * form is still a page**: it is the page form's alternative alone (STR-055), and the stored model
 * refuses one on any other. False, and nothing done, where no reference stands at `pos`.
 */
export function changeReference(pos: number, { target, display }: ReferenceChoice): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type !== crossReferenceNode) return false;
    if (dispatch) {
      const withoutPages = display === 'page' ? (node.attrs.withoutPages as string | null) : null;
      const tr = state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        target,
        display,
        withoutPages,
      });
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    }
    return true;
  };
}

/**
 * **Reference** as a registry command (ruling R9): whether one could be placed, and nothing more. Its
 * target and its form are values only the author can give, in a dialog the renderer owns, so the
 * keymap hands its shortcut to the renderer (`commandKeymap`) and the renderer runs `insertReference`
 * or `changeReference` with the answer. Run with a dispatch, it places nothing; a toolbar asks it
 * without one, as it asks every block command, whether to offer the button.
 */
export const canPlaceReference: Command = (state) => referencePlaceable(state);
