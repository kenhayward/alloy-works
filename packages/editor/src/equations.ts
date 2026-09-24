import { inlineNodeSchema } from '@alloy-works/domain';
import { NodeSelection, type Command, type EditorState } from 'prosemirror-state';

import { editorSchema } from './schema.js';

const equationNode = editorSchema.nodes.equation!;
const equationBlockNode = editorSchema.nodes.equationBlock!;
const paragraphNode = editorSchema.nodes.paragraph!;

/**
 * What an author answers the Equation dialog with (equations 1, ruling R6): the MathML - Temml's
 * output already made into the one form the reader keeps (`admitTemmlMathml`), its alternative in
 * its `alttext` - the LaTeX it was typed as, null where there is none, and whether it stands in the
 * text or as a block of its own. Only a block is numbered or not (CNT-047), so only a block says.
 */
export type EquationChoice =
  | { readonly display: 'inline'; readonly mathml: string; readonly latex: string | null }
  | {
      readonly display: 'block';
      readonly mathml: string;
      readonly latex: string | null;
      readonly numbered: boolean;
    };

/** An equation selected whole, as the dialog reads it to change one. */
export type EquationAt =
  | {
      readonly display: 'inline';
      /** Where the `equation` node starts. */
      readonly pos: number;
      readonly mathml: string;
      readonly latex: string | null;
    }
  | {
      readonly display: 'block';
      /** Where the `equationBlock` node starts. */
      readonly pos: number;
      /** The block's own, which a reference to it names; null only until the identity plugin runs. */
      readonly id: string | null;
      readonly mathml: string;
      readonly latex: string | null;
      readonly numbered: boolean;
    };

/**
 * The equation the selection holds whole, inline or block, or null: both are atoms, only ever
 * selected so.
 */
export function equationAt(state: EditorState): EquationAt | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  const { node } = selection;
  const mathml = node.attrs.mathml as string;
  const latex = (node.attrs.latex as string | null) ?? null;
  if (node.type === equationNode) return { display: 'inline', pos: selection.from, mathml, latex };
  if (node.type !== equationBlockNode) return null;
  return {
    display: 'block',
    pos: selection.from,
    id: (node.attrs.id as string | null) ?? null,
    mathml,
    latex,
    numbered: node.attrs.numbered as boolean,
  };
}

/**
 * The attributes an equation would carry, once the stored model has accepted them, or null where it
 * would not - MathML not in the one form the reader writes, above all, which a save would otherwise
 * refuse with a message written for a programmer. Checked by the model's own schema, as a mark's
 * attributes are (`accepted` in `marks.ts`), never by a rule restated here. LaTeX that says nothing
 * is no LaTeX: the stored model has one spelling of none, which is absence.
 */
function accepted(choice: EquationChoice): { mathml: string; latex: string | null } | null {
  const latex = choice.latex === null || choice.latex.trim() === '' ? null : choice.latex;
  const candidate = {
    type: 'equation',
    mathml: choice.mathml,
    ...(latex === null ? {} : { latex }),
  };
  return inlineNodeSchema.safeParse(candidate).success ? { mathml: choice.mathml, latex } : null;
}

/**
 * Where a block equation may not go, which is where a figure may not (`nowhereForAFigure`): anywhere
 * but a paragraph - so not from a term, an attribution, a caption, a table's note or preformatted text,
 * each of which still takes an inline one - and nowhere inside a table's cell, at any depth, since a
 * cell holds paragraphs and lists alone (tables 1, decision T-D) and a list inside one does too. A
 * footnote's own editor holds footnote paragraphs, so no block is placed there either (CNT-129).
 */
function nowhereForABlock(state: EditorState): boolean {
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
 * Whether a block equation could be placed at the selection, and if so whether it takes the place of
 * the empty paragraph the caret is in or goes after the one it is in; null where it could not.
 */
function blockPlace(state: EditorState): { readonly empty: boolean } | null {
  if (nowhereForABlock(state)) return null;
  const { $from } = state.selection;
  const depth = $from.depth;
  const index = $from.index(depth - 1);
  const parent = $from.node(depth - 1);
  const empty = $from.parent.content.size === 0;
  const at = empty ? index : index + 1;
  return parent.canReplaceWith(at, empty ? index + 1 : at, equationBlockNode) ? { empty } : null;
}

/**
 * Whether an equation could be placed at the selection, inline or as a block - so the dialog offers
 * a block only where one may stand (ruling R8). **Inline**: in a node whose content expression admits
 * one at the selection's end - a paragraph, a footnote's paragraph, a term, an attribution, a caption
 * or a table's note - answered by the content expressions rather than a list of homes, as a
 * reference's placement is, so a footnote's own editor admits one without a rule of its own; never in
 * preformatted text. **Block**: after the paragraph the selection is in, where a figure could go.
 */
export function equationPlaceable(state: EditorState, display: 'inline' | 'block'): boolean {
  if (display === 'block') return blockPlace(state) !== null;
  const { $to } = state.selection;
  const index = $to.index();
  return $to.parent.inlineContent && $to.parent.canReplaceWith(index, index, equationNode);
}

/**
 * Places an equation and selects it whole (ruling R6), so the dialog that placed it can be opened on
 * it again. False, and nothing done, where it cannot stand or the stored model would refuse it.
 *
 * - **Inline**, at the end of the selection, in an inline home: what is selected stays where it is,
 *   as it does for a reference - an equation is placed after the words it follows, never in their
 *   stead.
 * - **Block**, after the paragraph the selection is in, or in its place where that paragraph is empty,
 *   since an empty paragraph is where an author stands to put something new - as a figure and a table
 *   are placed. **Where no block would follow it in what holds it, an empty paragraph follows it**
 *   - nothing at all, or a quotation's attribution: an equation is an atom with nothing inside it to
 *   type into, unlike a figure's caption or a table's note. **The gap cursor does not make this
 *   redundant**: it stands only where both sides are closed all the way up, so past an equation ending
 *   the component, but not past one ending a list's item with another item after it, or a list with a
 *   paragraph after it - there the arrow moves on to the next text and nothing would reach the end of
 *   the item - and never between a block and an attribution, where `Enter` would leave the quotation.
 *
 * Neither carries an identifier from here: the identity plugin names the block as it names any
 * block, and the paragraph after it, and an inline equation has none to name.
 */
export function insertEquation(choice: EquationChoice): Command {
  return (state, dispatch) => {
    const given = accepted(choice);
    if (given === null) return false;
    if (choice.display === 'inline') {
      if (!equationPlaceable(state, 'inline')) return false;
      if (dispatch) {
        const { $to } = state.selection;
        const tr = state.tr.insert($to.pos, equationNode.create(given));
        dispatch(tr.setSelection(NodeSelection.create(tr.doc, $to.pos)).scrollIntoView());
      }
      return true;
    }
    const place = blockPlace(state);
    if (place === null) return false;
    if (dispatch) {
      const { $from } = state.selection;
      const depth = $from.depth;
      const equation = equationBlockNode.create({ ...given, numbered: choice.numbered });
      const start = place.empty ? $from.before(depth) : $from.after(depth);
      const tr = place.empty
        ? state.tr.replaceWith(start, $from.after(depth), equation)
        : state.tr.insert(start, equation);
      const after = start + equation.nodeSize;
      // Nothing after it, or nothing a caret can reach from it: a quotation's attribution follows
      // its blocks, and no caret stands between a block and it (equations 1's final review, L1).
      const next = tr.doc.resolve(after).nodeAfter;
      if (next === null || !next.type.isInGroup('block')) tr.insert(after, paragraphNode.create());
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, start)).scrollIntoView());
    }
    return true;
  };
}

/**
 * Changes the equation at `pos` to what the dialog answered, in place - its MathML, its LaTeX and, for
 * a block, its numbering - **keeping a block's identifier**, since it is the same equation changed and
 * a reference to it must still find it, and keeping it selected whole. False, and nothing done, where
 * no equation stands at `pos`, where the answer is of the other kind - an inline equation becoming a
 * block moves it, which is a placing and not a change - or where the stored model would refuse it.
 */
export function changeEquation(pos: number, choice: EquationChoice): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    const type = choice.display === 'inline' ? equationNode : equationBlockNode;
    if (node?.type !== type) return false;
    const given = accepted(choice);
    if (given === null) return false;
    if (dispatch) {
      const attrs =
        choice.display === 'block'
          ? { ...node.attrs, ...given, numbered: choice.numbered }
          : { ...node.attrs, ...given };
      const tr = state.tr.setNodeMarkup(pos, undefined, attrs);
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    }
    return true;
  };
}

/**
 * **Equation** as a registry command (ruling R6): whether an equation could be placed - inline, which
 * is wherever any equation can - or is selected whole to be changed, a block equation among them, whose
 * selection's end stands between blocks where nothing inline can go (ruling R8: the button and the
 * shortcut open the dialog on the equation selected); and nothing more. Its LaTeX is a value only the author can give, in a
 * dialog the renderer owns, so the keymap hands its shortcut to the renderer (`commandKeymap`) and the
 * renderer runs `insertEquation` or `changeEquation` with the answer. Run with a dispatch, it places
 * nothing; a toolbar asks it without one, as it asks every block command, whether to offer the button.
 */
export const canPlaceEquation: Command = (state) =>
  equationPlaceable(state, 'inline') || equationAt(state) !== null;

/**
 * `Enter` over an equation selected whole, inline or a block (ruling R5): it opens the equation, by
 * asking the renderer for its dialog exactly as **Equation**'s shortcut does (`commandKeymap`), so the
 * one `onPrompt('equation')` the renderer answers serves both keys. **Taken whether or not anything
 * answers**: the Enter it stands in front of would split the paragraph over an inline equation -
 * deleting it, since a selection is replaced by what is typed - and put a paragraph beside a block
 * one, neither of which an author who pressed Enter on an equation asked for.
 */
export function enterEquation(onPrompt?: (name: string) => boolean): Command {
  return (state) => {
    if (equationAt(state) === null) return false;
    onPrompt?.('equation');
    return true;
  };
}
