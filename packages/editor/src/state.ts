import { baseKeymap, splitBlock } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { MarkType, Node } from 'prosemirror-model';
import { EditorState, Plugin, type Command, type Selection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { identityPlugin } from './identity.js';
import { markKeymap, spansOf } from './marks.js';

const isEmptyParagraph = (node: Node | null | undefined) =>
  node?.type.name === 'paragraph' && node.content.size === 0;

/**
 * CNT-023's invariant, held on every transaction: the second of two adjacent empty paragraphs is
 * removed, however the pair arose - a join, a deletion, an undo (component-editor.md, "Invariants the
 * editor holds"). The document keeps at least one block because its content is `block+`, and an
 * empty one is filled with a paragraph because `paragraph` is declared first in that group.
 *
 * This walks the top level only. A list item holds blocks too, so the pair can arise at depth, and
 * descending is the next task's.
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
 * CNT-004's invariant, held on every transaction: one mark identifier covers **one contiguous
 * range**, so an annotation left in two pieces has its later pieces renamed, whatever split it.
 *
 * The content model refuses a document where one identifier appears, stops and appears again
 * (`claimRange`), because CNT-005 makes accepting or rejecting an annotation one operation over
 * every fragment of that identifier - two separated regions would resolve together although the
 * author sees two of them. A component that reaches that refusal through `fromEditor` is a failure
 * out of the snapshot path rather than something an author can read, so the editor must be unable to
 * produce one **within a mark type**, which is the scope of the repair below.
 *
 * Two things that scope leaves out, both deliberate, and neither reachable from a gesture:
 *
 * - **One identifier worn by two kinds of mark** - an `emphasis` here and a `strong` there - is two
 *   spans this plugin never compares, because it tracks what it has named per type. No command can
 *   make one: each mints a fresh identifier per call. The model refuses it by a different rule,
 *   `claimMark`, under which one identifier cannot carry two different values. Comparing across
 *   types would mean tracking by identifier over the whole document, and then which span kept the
 *   identifier would follow the order the mark types happened to be walked in rather than the
 *   document's own order - a worse answer to a case nothing produces.
 * - **The document a state is created from.** This runs on transactions, not at
 *   `EditorState.create`, so a `doc` handed to `createEditorState` already in two pieces stays that
 *   way until the first edit. Nothing produces one: the stored model refuses such a document on
 *   parse, and `toEditor` is the only thing that opens one.
 *
 * **After every transaction rather than inside each command**, for the reason
 * `noAdjacentEmptyParagraphs` is: the gestures that split an annotation are not all commands, and
 * the ones that are cannot always see the damage. Typing one character at the end of a `language`
 * run is not a command at all - the mark is not inclusive, so the typed run carries no mark and
 * stands between two pieces of one annotation. `removeMarkCommand` takes the mark off the block the
 * cursor is in, and a piece two paragraphs away is one it never looked at. A transaction from
 * anywhere else - a future paste, an undo of something exotic - has no command to hang a repair on.
 * A rule held per command is a rule that holds until the next gesture nobody thought of.
 *
 * **The first span keeps the identifier**, and every later one takes a fresh one. The first is the
 * one an author is most likely to think of as the annotation they made - it is where it started -
 * and more to the point the choice must be *stable*: renaming the earlier piece would give a new
 * name to text nothing touched every time a later piece was split off, and an identifier is what a
 * comment, a condition or an acceptance is attached to.
 *
 * What counts as one span is `spansOf` in `marks.ts`, which is the predicate the content model's
 * rule is written to match: a block boundary, an empty paragraph and an inline node that is not text
 * are all transparent, and only readable text between two runs makes them two annotations.
 *
 * `addMark` is enough to rename a piece: a mark type excludes its own kind, so the new mark replaces
 * the old one over that range and leaves every other mark on the run alone. Mark steps move no
 * positions, so the spans read before the first of them stay right for all of them. A fresh
 * identifier that the document already carries is drawn again, as `identityPlugin` draws again for a
 * block: two annotations under one name is the shape this plugin exists to prevent.
 */
export function annotationsInOnePiece(newIdentifier: () => string): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      // One walk to find which of the ten mark types are in the document at all, so that the usual
      // transaction - a keystroke in unmarked text - costs one walk rather than one per type.
      const carried = new Set<MarkType>();
      const taken = new Set<string>();
      newState.doc.descendants((node) => {
        for (const mark of node.marks) {
          carried.add(mark.type);
          taken.add(mark.attrs.id as string);
        }
      });
      const tr = newState.tr;
      let repaired = false;
      for (const type of carried) {
        // Named per mark type, which is the scope of the rule this holds - see above for what that
        // leaves out and why.
        const named = new Set<string>();
        for (const span of spansOf(newState.doc, type)) {
          const id = span.mark.attrs.id as string;
          if (!named.has(id)) {
            named.add(id);
            continue;
          }
          let fresh = newIdentifier();
          while (taken.has(fresh)) fresh = newIdentifier();
          taken.add(fresh);
          tr.addMark(span.from, span.to, type.create({ ...span.mark.attrs, id: fresh }));
          repaired = true;
        }
      }
      return repaired ? tr : null;
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
  /**
   * Called when a shortcut for a mark whose value the author has to supply is pressed - a link, a
   * language - and answering whether the renderer took it. A value can only be typed into something
   * this package does not own, so the editor's part is to carry the key out to whatever is asking
   * for it; with nothing listening the key does nothing, rather than being swallowed (CNT-077).
   */
  readonly onPrompt?: (mark: string) => boolean;
}

/**
 * The state one component's view holds: its own history (CNT-069 scopes undo to the component, which
 * is why ADR-0023 gives each component its own view), the keymap, and the three plugins that keep
 * what the editor holds storable.
 */
export function createEditorState(options: EditorStateOptions): EditorState {
  return EditorState.create({
    doc: options.doc,
    ...(options.selection ? { selection: options.selection } : {}),
    plugins: [
      history(),
      keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo, Enter: enterWithoutEmpties }),
      // Every mark the toolbar offers, from the one registry, so the two cannot drift (CNT-077).
      // A mark's identifier is drawn from the same source a block's is: both are allocated by the
      // editor, and both have to be unique within the component (ADR-0023, CNT-004).
      keymap(markKeymap(options.newIdentifier, options.onPrompt)),
      keymap(baseKeymap),
      identityPlugin(options.newIdentifier),
      noAdjacentEmptyParagraphs(),
      // A mark's identifier comes from the same source a block's does, here as in the keymap above.
      annotationsInOnePiece(options.newIdentifier),
      new Plugin({ props: { decorations: (state) => spellcheckDecorations(state.doc) } }),
    ],
  });
}
