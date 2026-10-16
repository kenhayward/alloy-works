import type { Mark, Node } from 'prosemirror-model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

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

/**
 * Whether a condition could be set over the selection: text selected, in text that takes marks, and
 * text alone. A footnote, a reference, a value, a variable, an image or an equation carries no mark,
 * so a condition over one would leave it published to every reader: it is not offered.
 */
export const conditionable = (state: EditorState): boolean => {
  const { selection } = state;
  if (
    !(selection instanceof TextSelection) ||
    selection.empty ||
    !selection.$from.parent.inlineContent ||
    !selection.$from.parent.type.allowsMarkType(conditionType) ||
    !selection.$to.parent.type.allowsMarkType(conditionType)
  ) {
    return false;
  }
  let textAlone = true;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isInline && !node.isText) textAlone = false;
    return textAlone;
  });
  return textAlone;
};

/** The nodes whose own `conditions` a numbered block's are (the R11 plan, R11-B). */
const CONDITIONED = new Set(['tableFigure', 'boundTable', 'figure', 'equationBlock']);

type Held = readonly { readonly axis: string; readonly values: readonly string[] }[];

/**
 * **The block a condition is set on** (REU-021; the R12 plan): the table, bound table, figure or
 * block equation selected whole, or the one an empty cursor stands in. None where text is selected,
 * which takes a mark as it always did.
 */
function blockTarget(state: EditorState): { readonly pos: number; readonly node: Node } | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    return CONDITIONED.has(selection.node.type.name)
      ? { pos: selection.from, node: selection.node }
      : null;
  }
  if (!selection.empty) return null;
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (CONDITIONED.has(node.type.name)) return { pos: $from.before(depth), node };
  }
  return null;
}

/** Whether a condition set now would go on a block rather than on text: no alternative is offered. */
export const conditionOnBlock = (state: EditorState): boolean =>
  !conditionable(state) && blockTarget(state) !== null;

/** A block's conditions written back whole, none as null, as the mapping stores them. */
function setBlockConditions(state: EditorState, next: Held): Transaction {
  const target = blockTarget(state)!;
  return state.tr.setNodeMarkup(target.pos, undefined, {
    ...target.node.attrs,
    conditions:
      next.length === 0 ? null : next.map((each) => ({ ...each, values: [...each.values] })),
  });
}

const heldOn = (node: Node): Held => (node.attrs.conditions as Held | null) ?? [];

/** Every condition over the selected text, or on the block, once each, in the order they were set. */
export function conditionsOver(state: EditorState): ConditionHeld[] {
  if (conditionOnBlock(state)) {
    return heldOn(blockTarget(state)!.node).map((each) => ({ id: each.axis, ...each }));
  }
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
    if (choice.values.length === 0) return false;
    // On a block, its conditions whole: any on this axis replaced, others kept (the R12 plan).
    if (conditionOnBlock(state)) {
      if (dispatch) {
        const held = heldOn(blockTarget(state)!.node).filter((each) => each.axis !== choice.axis);
        dispatch(setBlockConditions(state, [...held, choice]));
      }
      return true;
    }
    if (!conditionable(state)) return false;
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
    if (conditionOnBlock(state)) {
      if (dispatch) {
        const held = heldOn(blockTarget(state)!.node).filter((each) => each.axis !== axis);
        dispatch(setBlockConditions(state, held));
      }
      return true;
    }
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

/** Where a surface's state keeps the axes its environment declares, by key (the R6 plan, R6-H). */
const conditionAxesKey = new PluginKey<readonly string[]>('conditionAxes');

/**
 * The environment's declared axes, held as the host tells them: what a paste keeps a condition on,
 * dropping one on an axis nothing declares (`admit`).
 */
export function conditionAxesPlugin(initial: readonly string[] = []): Plugin {
  return new Plugin<readonly string[]>({
    key: conditionAxesKey,
    state: {
      init: () => initial,
      apply: (tr, held) => (tr.getMeta(conditionAxesKey) as readonly string[] | undefined) ?? held,
    },
  });
}

/** The axes a surface's state holds, or none. */
export const conditionAxesOf = (state: EditorState): readonly string[] =>
  conditionAxesKey.getState(state) ?? [];

/** The state with these axes held, outside the history. */
export const setConditionAxesIn = (state: EditorState, axes: readonly string[]): EditorState =>
  state.apply(state.tr.setMeta(conditionAxesKey, axes).setMeta('addToHistory', false));

/** Tells a surface the axes its environment declares, once they are read. */
export function setConditionAxes(view: EditorView, axes: readonly string[]): void {
  view.dispatch(view.state.tr.setMeta(conditionAxesKey, axes).setMeta('addToHistory', false));
}

/** **Condition** as a registry command: whether one could be set. What it is, the dialog chooses. */
export const canPlaceCondition: Command = (state) =>
  conditionable(state) || blockTarget(state) !== null;

/** What a block's conditions keep it for, in the words a condition mark's title uses. */
const saidOf = (held: Held) =>
  held.map((each) => `Only where ${each.axis} is ${each.values.join(' or ')}`).join('; ');

/**
 * **A conditional block, drawn** (REU-026; the R12 plan): each block carrying conditions marked
 * `aw-conditional`, with what it depends on said, as a condition mark's text is.
 */
export function conditionedBlocks(state: EditorState): DecorationSet {
  const drawn: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (CONDITIONED.has(node.type.name) && heldOn(node).length > 0) {
      drawn.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: 'aw-conditional',
          title: saidOf(heldOn(node)),
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(state.doc, drawn);
}

const conditionedKey = new PluginKey<DecorationSet | null>('conditionedBlocks');

/**
 * Draws every conditional block (the R12 plan), found again only when the document changes, and
 * nothing at all where none is conditional.
 */
export function conditionedBlocksPlugin(): Plugin {
  const found = (state: EditorState) => {
    const set = conditionedBlocks(state);
    return set.find().length === 0 ? null : set;
  };
  return new Plugin<DecorationSet | null>({
    key: conditionedKey,
    state: {
      init: (_config, state) => found(state),
      apply: (tr, held, _old, state) => (tr.docChanged ? found(state) : held),
    },
    props: { decorations: (state) => conditionedKey.getState(state) ?? null },
  });
}
