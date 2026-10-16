import type { Mark } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';

import { editorSchema } from './schema.js';

const conditionType = editorSchema.marks.condition!;

/** A condition as the author chooses it: an axis by its key, and the values it is kept for. */
export interface ConditionChoice {
  readonly axis: string;
  readonly values: readonly string[];
}

/** A condition the selection carries, as the Condition dialog reads it. */
export interface ConditionHeld extends ConditionChoice {
  readonly id: string;
}

/** Whether a condition could be set over the selection: text selected, in text that takes marks. */
export const conditionable = (state: EditorState): boolean => {
  const { selection } = state;
  return (
    selection instanceof TextSelection &&
    !selection.empty &&
    selection.$from.parent.inlineContent &&
    selection.$from.parent.type.allowsMarkType(conditionType) &&
    selection.$to.parent.type.allowsMarkType(conditionType)
  );
};

/** Every condition over the selected text, once each, in the order they were set. */
export function conditionsOver(state: EditorState): ConditionHeld[] {
  const found = new Map<string, ConditionHeld>();
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node) => {
    for (const mark of node.marks) {
      if (mark.type !== conditionType) continue;
      const id = mark.attrs.id as string;
      if (!found.has(id)) {
        found.set(id, {
          id,
          axis: mark.attrs.axis as string,
          values: mark.attrs.values as readonly string[],
        });
      }
    }
  });
  return [...found.values()];
}

/** Takes off every condition on one axis over `from` to `to`, in `tr`. */
function clearAxis(tr: Transaction, from: number, to: number, axis: string): void {
  const marks: Mark[] = [];
  tr.doc.nodesBetween(from, to, (node) => {
    for (const mark of node.marks) {
      if (mark.type === conditionType && mark.attrs.axis === axis && !marks.includes(mark)) {
        marks.push(mark);
      }
    }
  });
  for (const mark of marks) tr.removeMark(from, to, mark);
}

/**
 * Sets a condition over the selection (CNT-032, REU-021; the R6 plan, R6-H): any it already carries
 * on that axis is replaced, and one on another axis is kept beside it, so ranges may overlap.
 */
export function setCondition(choice: ConditionChoice, newIdentifier: () => string): Command {
  return (state, dispatch) => {
    if (!conditionable(state) || choice.values.length === 0) return false;
    if (dispatch) {
      const { from, to } = state.selection;
      const tr = state.tr;
      clearAxis(tr, from, to, choice.axis);
      tr.addMark(
        from,
        to,
        conditionType.create({
          id: newIdentifier(),
          axis: choice.axis,
          values: [...choice.values],
        }),
      );
      dispatch(tr);
    }
    return true;
  };
}

/** Takes every condition on one axis off the selection. */
export function removeCondition(axis: string): Command {
  return (state, dispatch) => {
    if (!conditionable(state)) return false;
    if (dispatch) {
      const { from, to } = state.selection;
      const tr = state.tr;
      clearAxis(tr, from, to, axis);
      dispatch(tr);
    }
    return true;
  };
}

/**
 * **An alternative** (REU-047; R6-H): the selected text copied beside itself, within its paragraph,
 * kept for the other values of the axis in place of the selection's, and selected for the author to
 * write the wording those readers are given.
 */
export function addAlternative(choice: ConditionChoice, newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if (!conditionable(state) || !$from.sameParent($to) || choice.values.length === 0) return false;
    if (dispatch) {
      const { from, to } = state.selection;
      const copy = state.doc.slice(from, to);
      const tr = state.tr.insert(to, copy.content);
      const end = to + copy.content.size;
      clearAxis(tr, to, end, choice.axis);
      tr.addMark(
        to,
        end,
        conditionType.create({
          id: newIdentifier(),
          axis: choice.axis,
          values: [...choice.values],
        }),
      );
      dispatch(tr.setSelection(TextSelection.create(tr.doc, to, end)).scrollIntoView());
    }
    return true;
  };
}

/** **Condition** as a registry command: whether one could be set. What it is, the dialog chooses. */
export const canPlaceCondition: Command = (state) => conditionable(state);
