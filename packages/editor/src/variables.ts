import type { Command, EditorState } from 'prosemirror-state';
import { NodeSelection } from 'prosemirror-state';

import { editorSchema } from './schema.js';

const variableNode = editorSchema.nodes.variable!;

/**
 * Whether a variable could be placed at the selection's end (the R5 plan, R5b): wherever a binding
 * could, since each content expression names both, and so never in preformatted text or a title.
 */
export const variablePlaceable = (state: EditorState): boolean => {
  const { $to } = state.selection;
  const index = $to.index();
  return (
    $to.parent.type.schema === editorSchema &&
    $to.parent.inlineContent &&
    $to.parent.canReplaceWith(index, index, variableNode)
  );
};

/** The key of the variable the selection holds whole, or null. */
export function variableSelected(state: EditorState): string | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== variableNode) return null;
  return selection.node.attrs.name as string;
}

/** **Variable** as a registry command: whether one could be placed. Which is chosen in a dialog. */
export const canPlaceVariable: Command = (state) => variablePlaceable(state);

/**
 * Places the variable an author chose from the declared ones (REU-018) at the selection's end and
 * selects it whole, as a binding is placed.
 */
export function insertVariable(key: string): Command {
  return (state, dispatch) => {
    if (!variablePlaceable(state)) return false;
    if (dispatch) {
      const { $to } = state.selection;
      const tr = state.tr.insert($to.pos, variableNode.create({ name: key }));
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, $to.pos)).scrollIntoView());
    }
    return true;
  };
}
