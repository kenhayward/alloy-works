import type { Alternative, Binding } from '@alloy-works/domain';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';

import type { BindingChoice } from './bindings.js';

import { editorSchema } from './schema.js';

export { assetContentPath, IMAGE_OWN_DESCRIPTION } from './schema.js';

const figureNode = editorSchema.nodes.figure!;
const figureCaptionNode = editorSchema.nodes.figureCaption!;
const paragraphNode = editorSchema.nodes.paragraph!;

/** The figure the selection stands in, as the panel reads it. */
export interface FigureAt {
  /** Where the `figure` node starts. */
  readonly pos: number;
  readonly id: string | null;
  /** The asset version it shows, or null where a binding gives its image (the B6 plan, B6-A). */
  readonly asset: string | null;
  /** The binding it takes its image from, as stored, or null where it shows an asset version. */
  readonly binding: Binding | null;
  /** Its image style, which the Figure panel's Image style list shows. */
  readonly imageStyle: string;
  readonly alternative: Alternative;
  /** Whether it takes a number, which the Figure panel's Numbered box shows (STR-071). */
  readonly numbered: boolean;
}

/** The innermost figure the selection stands in - its caption, or the figure selected whole - or null. */
export function figureAt(state: EditorState): FigureAt | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type !== figureNode) continue;
    return {
      pos: $from.before(depth),
      id: (node.attrs.id as string | null) ?? null,
      asset: (node.attrs.asset as string | null) ?? null,
      binding: (node.attrs.binding as Binding | null) ?? null,
      imageStyle: node.attrs.imageStyle as string,
      alternative: node.attrs.alternative as Alternative,
      numbered: node.attrs.numbered !== false,
    };
  }
  const selected = state.doc.nodeAt(state.selection.from);
  if (
    selected?.type === figureNode &&
    state.selection.to === state.selection.from + selected.nodeSize
  ) {
    return {
      pos: state.selection.from,
      id: (selected.attrs.id as string | null) ?? null,
      asset: (selected.attrs.asset as string | null) ?? null,
      binding: (selected.attrs.binding as Binding | null) ?? null,
      imageStyle: selected.attrs.imageStyle as string,
      alternative: selected.attrs.alternative as Alternative,
      numbered: selected.attrs.numbered !== false,
    };
  }
  return null;
}

/**
 * Where a figure may not go: anywhere but a paragraph, and inside a table's cell, which holds
 * paragraphs and lists alone (tables 1, decision T-D) - an image in a cell is an inline image, which
 * is figures 4's.
 */
function nowhereForAFigure(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to)) return true;
  if ($from.parent.type !== paragraphNode) return true;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec.tableRole as string | undefined;
    if (role === 'cell' || role === 'header_cell') return true;
  }
  return false;
}

/**
 * An own text that says something, as it was typed - trimming it would take the space an author has
 * just typed between two words, since the panel sets the text on every keystroke - or anything else
 * as it came; null for an own text that says nothing.
 */
export function kept(alternative: Alternative): Alternative | null {
  if (alternative.kind !== 'own') return alternative;
  return alternative.text.trim() === '' ? null : alternative;
}

/**
 * **Figure**: the image just uploaded, with the alternative text the dialog was answered with, after
 * the paragraph the cursor is in - or in its place, where that paragraph is empty - with the cursor in
 * its caption, which says **Caption** until something is typed (figures 2, ruling R3).
 */
export function insertFigure(
  asset: string,
  alternative: Alternative,
  newIdentifier: () => string,
  /** The image style it is placed in, chosen in the dialog; the schema's default unsaid (ET-G). */
  imageStyle = 'figure',
): Command {
  return (state, dispatch) => {
    const given = kept(alternative);
    if (given === null || nowhereForAFigure(state)) return false;
    const { $from } = state.selection;
    const depth = $from.depth;
    const index = $from.index(depth - 1);
    const parent = $from.node(depth - 1);
    const empty = $from.parent.content.size === 0;
    const at = empty ? index : index + 1;
    if (!parent.canReplaceWith(at, empty ? index + 1 : at, figureNode)) return false;
    if (dispatch) {
      const figure = figureNode.create(
        { id: newIdentifier(), asset, imageStyle, alternative: given },
        [figureCaptionNode.create()],
      );
      const start = empty ? $from.before(depth) : $from.after(depth);
      const tr = empty
        ? state.tr.replaceWith(start, $from.after(depth), figure)
        : state.tr.insert(start, figure);
      // Into the figure, and into its caption.
      dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 2)).scrollIntoView());
    }
    return true;
  };
}

/**
 * **A bound figure** (the B6 plan, B6-H): the Value dialog's choice placed _As a figure_, where a figure
 * may go, its binding given a fresh identifier as a placed binding is, and described by its
 * definition's column - never by text of its own (B6-C). The cursor is left in its caption, as
 * **Figure** leaves it.
 */
export function insertBoundFigure(
  choice: BindingChoice,
  newIdentifier: () => string,
  imageStyle = 'figure',
): Command {
  return (state, dispatch) => {
    if (nowhereForAFigure(state)) return false;
    const { $from } = state.selection;
    const depth = $from.depth;
    const index = $from.index(depth - 1);
    const parent = $from.node(depth - 1);
    const empty = $from.parent.content.size === 0;
    const at = empty ? index : index + 1;
    if (!parent.canReplaceWith(at, empty ? index + 1 : at, figureNode)) return false;
    if (dispatch) {
      const binding: Binding = {
        type: 'binding',
        id: newIdentifier(),
        query: choice.query,
        ...(choice.version === undefined ? {} : { version: choice.version }),
        parameters: choice.parameters,
        mode: choice.mode,
        take: choice.take,
      };
      const figure = figureNode.create(
        {
          id: newIdentifier(),
          asset: null,
          binding,
          imageStyle,
          alternative: { kind: 'inherited' },
        },
        [figureCaptionNode.create()],
      );
      const start = empty ? $from.before(depth) : $from.after(depth);
      const tr = empty
        ? state.tr.replaceWith(start, $from.after(depth), figure)
        : state.tr.insert(start, figure);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 2)).scrollIntoView());
    }
    return true;
  };
}

/**
 * Changes the binding of the figure at `pos`, keeping its identifier - the same binding, changed, as
 * `changeBinding` keeps an inline one's - and the figure's caption, number, alternative and the
 * selection. False where no bound figure stands there.
 */
export function changeFigureBinding(pos: number, choice: BindingChoice): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    const held = node?.type === figureNode ? (node.attrs.binding as Binding | null) : null;
    if (node === null || held === null) return false;
    if (dispatch) {
      const binding: Binding = {
        type: 'binding',
        id: held.id,
        query: choice.query,
        ...(choice.version === undefined ? {} : { version: choice.version }),
        parameters: choice.parameters,
        mode: choice.mode,
        take: choice.take,
      };
      dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, binding }));
    }
    return true;
  };
}

/**
 * Sets how the figure's alternative text is given: the image's own description, its own text - in
 * the component's language, which is why the model stores no tag with it - or decorative. An own
 * text that says nothing is not stored, and the state stays as it was (figures 2, ruling R5).
 */
export function setFigureAlternative(alternative: Alternative): Command {
  return (state, dispatch) => {
    const figure = figureAt(state);
    const given = kept(alternative);
    if (figure === null || given === null) return false;
    if (dispatch) {
      const node = state.doc.nodeAt(figure.pos)!;
      dispatch(
        state.tr.setNodeMarkup(figure.pos, undefined, { ...node.attrs, alternative: given }),
      );
    }
    return true;
  };
}

/**
 * Replaces the figure's image, and how its alternative text is given, with what the dialog answered:
 * the figure keeps its identity - so its number and every reference to it - its caption and its
 * place (component-editor.md, "Figures").
 */
export function replaceFigureImage(asset: string, alternative: Alternative): Command {
  return (state, dispatch) => {
    const figure = figureAt(state);
    const given = kept(alternative);
    if (figure === null || given === null) return false;
    if (dispatch) {
      const node = state.doc.nodeAt(figure.pos)!;
      dispatch(
        state.tr.setNodeMarkup(figure.pos, undefined, {
          ...node.attrs,
          asset,
          // An uploaded image in place of a bound one: the figure holds one or the other (B6-A).
          binding: null,
          alternative: given,
        }),
      );
    }
    return true;
  };
}

/**
 * **Numbered**, from the Figure panel (STR-071): marks the figure the cursor stands in unnumbered, so
 * it takes no number and uses up none, or numbered again. One step for the undo history; declined
 * where it already is what it is asked to be, or where there is no figure.
 */
export function setFigureNumbered(numbered: boolean): Command {
  return (state, dispatch) => {
    const figure = figureAt(state);
    if (figure === null || figure.numbered === numbered) return false;
    if (dispatch) {
      const node = state.doc.nodeAt(figure.pos)!;
      dispatch(state.tr.setNodeMarkup(figure.pos, undefined, { ...node.attrs, numbered }));
    }
    return true;
  };
}

/** Removes the figure, caption and all; where it was the only block, an empty paragraph stays. */
export const deleteFigure: Command = (state, dispatch) => {
  const figure = figureAt(state);
  if (figure === null) return false;
  if (dispatch) {
    const node = state.doc.nodeAt(figure.pos)!;
    const $pos = state.doc.resolve(figure.pos);
    const only = $pos.parent.childCount === 1;
    const end = figure.pos + node.nodeSize;
    const tr = only
      ? state.tr.replaceWith(figure.pos, end, paragraphNode.create())
      : state.tr.delete(figure.pos, end);
    const near = TextSelection.near(tr.doc.resolve(Math.min(figure.pos, tr.doc.content.size)));
    dispatch(tr.setSelection(near).scrollIntoView());
  }
  return true;
};
