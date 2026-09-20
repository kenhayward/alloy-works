import { baseKeymap, splitBlock } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node } from 'prosemirror-model';
import { EditorState, Plugin, type Command, type Selection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { identityPlugin } from './identity.js';

const isEmptyParagraph = (node: Node | null | undefined) =>
  node?.type.name === 'paragraph' && node.content.size === 0;

/**
 * CNT-023's invariant, held on every transaction: the second of two adjacent empty paragraphs is
 * removed, however the pair arose - a join, a deletion, an undo (component-editor.md, "Invariants the
 * editor holds"). The document keeps at least one paragraph because its content is `paragraph+`.
 */
export function noAdjacentEmptyParagraphs(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const removals: [number, number][] = [];
      let previous: Node | null = null;
      newState.doc.forEach((node, offset) => {
        if (isEmptyParagraph(previous) && isEmptyParagraph(node)) {
          removals.push([offset, offset + node.nodeSize]);
        }
        previous = node;
      });
      if (removals.length === 0) return null;
      const tr = newState.tr;
      for (const [from, to] of removals.reverse()) tr.delete(from, to);
      return tr;
    },
  });
}

/**
 * CNT-147: the surface checks spelling (CNT-098), except over a run whose language mark names a
 * language that **differs** from the component's base language, so a passage in another language is
 * never flagged as misspelt and one in the base language is still checked.
 *
 * It is a decoration rather than an attribute of the mark for two reasons, and both are requirements
 * rather than taste. A mark's `toDOM` is handed the mark and never the document, so it cannot see the
 * base language to compare with; and the base language is editable in the component header, at which
 * point every run's answer changes at once (component-editor.md, "Title, base language and base
 * direction"). A decoration is recomputed from the document, so it follows that change; an attribute
 * rendered into the mark could not.
 *
 * The comparison is exact. `fr` and `fr-CA` are different languages here, which is what CNT-140's
 * "carrying a region wherever the region changes the content" asks for.
 */
export function spellcheckDecorations(doc: Node): DecorationSet {
  const base: unknown = doc.attrs.language;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const language = node.marks.find((mark) => mark.type.name === 'language');
    if (language !== undefined && language.attrs.tag !== base)
      decorations.push(Decoration.inline(pos, pos + node.nodeSize, { spellcheck: 'false' }));
  });
  return DecorationSet.create(doc, decorations);
}

/** `Enter`: nothing in an empty paragraph, which would otherwise make a second; a split elsewhere. */
export const enterWithoutEmpties: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (empty && isEmptyParagraph($from.parent)) return true;
  return splitBlock(state, dispatch);
};

export interface EditorStateOptions {
  readonly doc: Node;
  /** Where new block identifiers come from; `newBlockIdentifier` outside tests. */
  readonly newIdentifier: () => string;
  /**
   * Carried into the fresh state when given, for the same `doc` (fix round 1, minor): a fresh history
   * still needs a fresh selection, but not necessarily one back at the start - cutting a version, for
   * one, changes nothing about the document itself, so jumping the cursor to the beginning would be a
   * side effect the cut never asked for. Defaults to the document's own default selection.
   */
  readonly selection?: Selection;
}

/**
 * The state one component's view holds: its own history (CNT-069 scopes undo to the component, which
 * is why ADR-0023 gives each component its own view), the keymap, and the two plugins that keep what the
 * editor holds storable.
 */
export function createEditorState(options: EditorStateOptions): EditorState {
  return EditorState.create({
    doc: options.doc,
    ...(options.selection ? { selection: options.selection } : {}),
    plugins: [
      history(),
      keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo, Enter: enterWithoutEmpties }),
      keymap(baseKeymap),
      identityPlugin(options.newIdentifier),
      noAdjacentEmptyParagraphs(),
      new Plugin({ props: { decorations: (state) => spellcheckDecorations(state.doc) } }),
    ],
  });
}
