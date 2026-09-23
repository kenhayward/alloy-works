import { baseKeymap, chainCommands, splitBlock } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { goToNextCell, tableEditing } from 'prosemirror-tables';
import type { MarkType, Node } from 'prosemirror-model';
import { EditorState, Plugin, Selection, TextSelection, type Command } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import {
  blockCommand,
  codeAwareEnter,
  insertTabInCode,
  joinDefinitionItems,
  listAwareEnter,
  outsideCode,
  refusePastTheLimit,
} from './blocks.js';
import { identityPlugin } from './identity.js';
import { tableHeadersAgree } from './tables.js';
import { imagesUnmarked } from './images.js';
import { commandKeymap, spansOf } from './marks.js';

const isEmptyParagraph = (node: Node | null | undefined) =>
  node?.type.name === 'paragraph' && node.content.size === 0;

/**
 * Every second of two adjacent empty paragraphs in the document, as a range to delete, in ascending
 * document order.
 *
 * **A sequence is the children that are in the `block` group, and that is read off the schema rather
 * than from a list of type names** - the same rule `identified` follows in `identity.ts`, and for a
 * sharper reason here. A `definitionItem` is `term block+`, so a walk over a node's children meets a
 * `term` standing where the stored model has no sequence member at all: an item's term belongs to
 * the item and its blocks are a sequence of their own (`checkBlock` in `packages/domain`). Asking
 * the schema which children are blocks is what makes the editor's sequence the same sequence the
 * stored model's rule runs over, rather than the same one by the coincidence that a term is not
 * called `paragraph`. It also means a blockquote, a table cell and a footnote are walked the day
 * they are declared, without being remembered here.
 *
 * Two things hold that, because **no shape this schema can make reaches the filter today**: a
 * `definitionItem` is `term block+`, so its one non-block child can only stand first, and the
 * emptiness test below never pairs with a term anyway. `schema.test.ts` pins that `term` is outside
 * the group, which is what keeps the emptiness test's answer the stored model's answer; and
 * `state.test.ts` reaches the filter itself through a schema of its own, which is where the rule it
 * applies - a child outside the group is no member of the sequence, so it neither pairs nor
 * separates - is written down.
 *
 * **Emptiness is still the paragraph's own type and size**, because that is what CNT-023 is about
 * and what `refuseAdjacentEmpties` compares: a list is in the `block` group and is no empty
 * paragraph, and an empty `term` is no paragraph either. A text node cannot be empty in
 * ProseMirror, so `content.size === 0` is exactly the stored model's `content.length === 0` after
 * `mergeRuns` has dropped a run with no text.
 *
 * **The walk pushes a node's removal and then descends into that node**, which is what keeps the
 * collected positions ascending: finishing a sequence before descending into its members would
 * collect a later sibling's position before a deeper one, and reversing that list would then delete
 * the shallow range first, move everything after it, and address the deeper one at a position that
 * no longer exists - a `RangeError` out of `appendTransaction`, which is an uncaught exception on a
 * keystroke. `state.test.ts` drives the shape that proves it: a pair inside a list, and a second
 * pair after that list. Every range collected is one empty paragraph, which holds nothing, so no two
 * overlap and deleting them back to front is enough.
 */
function adjacentEmpties(parent: Node, start: number, removals: [number, number][]): void {
  let previous: Node | null = null;
  parent.forEach((child, offset) => {
    const at = start + offset;
    if (child.type.isInGroup('block')) {
      if (isEmptyParagraph(previous) && isEmptyParagraph(child)) {
        removals.push([at, at + child.nodeSize]);
      }
      previous = child;
    }
    // A node's own content begins one position inside it; a leaf has none and this does nothing.
    adjacentEmpties(child, at + 1, removals);
  });
}

/**
 * CNT-023's invariant, held on every transaction: the second of two adjacent empty paragraphs is
 * removed, however the pair arose - a join, a deletion, an undo (component-editor.md, "Invariants the
 * editor holds"). The document keeps at least one block because its content is `block+`, and an
 * empty one is filled with a paragraph because `paragraph` is declared first in that group.
 *
 * **It walks every sequence of blocks, not the top level**, because `refuseAdjacentEmpties` in
 * `packages/domain` does - it runs over the top level, a list item, a blockquote, a table cell and a
 * footnote - and a rule the two write paths disagree on is a rule one of them breaks. A list item
 * holds block content, so the pair arises at depth from the ordinary gestures, and a document
 * carrying one is refused by `parseContentDocument` out of the save path, where `saveIteration`
 * answers with a fixed message that tells the author nothing.
 *
 * **Judged on what the document became, never on what arrived.** The walk reads `newState.doc`, the
 * state the transactions left, and ProseMirror re-runs `appendTransaction` over what this returns,
 * so a pair that only a removal made adjacent is met on the next pass rather than stored. That is
 * the same side of the transforming step the model's own rule is judged on, which is what makes the
 * two answer alike: `refuseAdjacentEmpties` runs over `mergeRuns`' output, because a paragraph
 * holding one empty run is an empty paragraph only once the walk has dropped that run.
 *
 * Only ever the **second** of a pair is removed, so the block before it stays in the same sequence
 * and an item never empties - which matters because `listItem` is `block+` and a sequence emptied by
 * a repair would be a document ProseMirror itself refuses.
 */
export function noAdjacentEmptyParagraphs(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const removals: [number, number][] = [];
      adjacentEmpties(newState.doc, 0, removals);
      if (removals.length === 0) return null;
      const tr = newState.tr;
      // Back to front, so a removal never invalidates a position collected before it.
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
/**
 * An empty attribution, marked so the stylesheet can show a placeholder in it. A class on the node
 * rather than `:empty` in the stylesheet, because ProseMirror puts a trailing break into an empty
 * textblock and `:empty` never matches one.
 */
export function placeholderDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    // An attribution and a table's or a figure's caption: each is where an author types something optional-looking
    // that a reader needs, and an empty one says what it is for.
    if (
      (node.type.name === 'attribution' ||
        node.type.name === 'tableCaption' ||
        node.type.name === 'figureCaption') &&
      node.content.size === 0
    ) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'aw-empty' }));
    }
  });
  return DecorationSet.create(doc, decorations);
}

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

/**
 * Every quotation ends with an attribution line, empty where nobody has typed one, so an author always
 * has somewhere to type it. `toEditor` and the Quotation command make one, but Backspace at its start
 * or Delete at the end of the body fold its text into the paragraph before and take the node with it
 * (final review, finding 6); this puts an empty one back after any transaction that left a quotation
 * without. The text the key folded stays where the key put it.
 */
export const attributionAlwaysThere = new Plugin({
  appendTransaction(transactions, _old, state) {
    if (!transactions.some((transaction) => transaction.docChanged)) return null;
    const missing: number[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'blockquote' && node.lastChild?.type.name !== 'attribution') {
        missing.push(pos + node.nodeSize - 1);
      }
    });
    if (missing.length === 0) return null;
    const tr = state.tr;
    // From the last to the first, so an insertion never moves a position still to be used.
    for (const at of missing.reverse()) tr.insert(at, state.schema.nodes.attribution!.create());
    return tr;
  },
});

/** `Enter`: nothing in an empty paragraph, which would otherwise make a second; a split elsewhere. */
export const enterWithoutEmpties: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (empty && isEmptyParagraph($from.parent)) return true;
  return splitBlock(state, dispatch);
};

/**
 * `Enter` over a range: the range deleted, then `enter` pressed at the caret the deletion leaves, in
 * one transaction. It is what an author expects, and it is what the chain did anyway - `splitBlock`
 * and `splitListItem` each delete the selection first - but they then split with positions read
 * before the deletion, and over a range that ends outside the quotation it began in, `splitBlock`
 * threw rather than split (issue #166). Pressing Enter at a caret is the case every command in the
 * chain was written for.
 *
 * **The chain runs against the state the deletion leads to, plugins and all.** A deletion across the
 * end of a quotation takes its attribution with it, which the schema does not allow and
 * `attributionAlwaysThere` puts back - but only once the transaction is applied, and splitting the
 * unrepaired document is what threw. So the deletion is applied, what the plugins appended is carried
 * into the one transaction, and the chain presses Enter in the document they left. No view is handed
 * on: its answers are about the document it shows, which is not this one yet.
 */
export function enterOverRange(enter: Command): Command {
  return (state, dispatch) => {
    if (state.selection.empty || !(state.selection instanceof TextSelection)) return false;
    if (!dispatch) return true;
    const tr = state.tr.deleteSelection();
    const { state: deleted, transactions } = state.applyTransaction(tr);
    for (const appended of transactions.slice(1)) {
      for (const step of appended.steps) tr.step(step);
    }
    tr.setSelection(Selection.fromJSON(tr.doc, deleted.selection.toJSON()));
    enter(deleted, (inner) => {
      for (const step of inner.steps) tr.step(step);
      tr.setSelection(Selection.fromJSON(tr.doc, inner.selection.toJSON()));
    });
    dispatch(tr.scrollIntoView());
    return true;
  };
}

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
  const enterAtCaret = chainCommands(
    codeAwareEnter(options.newIdentifier),
    listAwareEnter(options.newIdentifier),
    enterWithoutEmpties,
  );
  return EditorState.create({
    doc: options.doc,
    ...(options.selection ? { selection: options.selection } : {}),
    plugins: [
      history(),
      keymap({
        'Mod-z': undo,
        'Mod-y': redo,
        'Shift-Mod-z': redo,
        // **The order is the whole of it, and `enterWithoutEmpties` is last.** It returns true and
        // does nothing in an empty paragraph, so ahead of the list-aware links it would shadow every
        // one of them and an author who pressed Enter in an empty list item would be trapped in the
        // list with no key that leaves it. Every command in `listAwareEnter` returns false outside a
        // list, so the order is safe in both directions. `blocks.test.ts` presses the key through
        // this keymap rather than reasoning about which binding wins.
        //
        // **And the code-aware links come first of all** (editor 5): in preformatted text Enter
        // types a line break, which `splitListItem` and `splitBlock` would otherwise answer by
        // splitting the item or the block around it; in an attribution it leaves the quotation.
        Enter: chainCommands(enterOverRange(enterAtCaret), enterAtCaret),
        // **Bound literally, and only these two.** Tab and Shift-Tab have no row in
        // `EDITOR_COMMANDS` by design - they are a second route to nesting and lifting rather than
        // the named shortcut, and a shortcut written in two places is the drift the registry exists
        // to prevent. Both return false outside a list, so Tab still moves focus everywhere else,
        // which CNT-077 needs: a Tab that is always swallowed is a keyboard trap.
        //
        // In preformatted text Tab types a tab, the character CNT-018 keeps, and Shift-Tab is **never
        // taken** - not even to lift the item a preformatted block stands in - so focus can always
        // leave backwards by keyboard and the tab is not a trap (decision I).
        // **In a table, Tab moves between cells first** (tables 1, ruling R5), even in a list inside
        // a cell, as Word's does; it answers false from the last cell and Shift-Tab from the first,
        // so the focus can leave the table and neither is a trap.
        Tab: chainCommands(
          goToNextCell(1),
          insertTabInCode,
          blockCommand('nestItem', options.newIdentifier),
        ),
        'Shift-Tab': chainCommands(
          goToNextCell(-1),
          outsideCode(blockCommand('liftItem', options.newIdentifier)),
        ),
      }),
      // Every command the toolbar offers - nine marks and seven block actions - from the one
      // registry, so the two cannot drift (CNT-077). A mark's identifier is drawn from the same
      // source a block's is: both are allocated by the editor, and both have to be unique within
      // the component (ADR-0023, CNT-004).
      keymap(commandKeymap(options.newIdentifier, options.onPrompt)),
      // **Every deleting binding answers the depth rule, ahead of the one that does the work.**
      // Backspace and Delete build a list level, which nothing about either key suggests: two
      // `definitionItem`s cannot merge, because the content is `term block+`, so `deleteBarrier`
      // wraps the following item in a new definition list inside the previous one rather than
      // joining them. At the limit that is a document the store refuses, from one press.
      //
      // The bindings are found by **identity** against `baseKeymap`'s own commands rather than
      // typed out, because the same command is bound under several names and they differ by
      // platform - `Mod-Backspace` and `Shift-Backspace` everywhere, `Ctrl-h`, `Alt-Backspace`,
      // `Ctrl-d`, `Alt-Delete` and `Alt-d` on macOS - and a list typed here would be a list that
      // goes stale on the platform nobody ran. Where the press would not deepen anything, the guard
      // returns false and `baseKeymap` below does the work, so there is one implementation of each
      // key and not two. What these keys should do between two definition items at ordinary depth
      // is issue #160.
      keymap(
        Object.fromEntries(
          Object.entries(baseKeymap)
            .filter(
              ([, command]) => command === baseKeymap.Backspace || command === baseKeymap.Delete,
            )
            // Two definition items join as paragraphs do (issue #160), ahead of the guard and of
            // `baseKeymap`, whose own join would nest one inside the other.
            .map(([key, command]) => [
              key,
              chainCommands(
                joinDefinitionItems(command === baseKeymap.Backspace ? 'backward' : 'forward'),
                refusePastTheLimit(command),
              ),
            ]),
        ),
      ),
      keymap(baseKeymap),
      // **Identity before adjacency, and it is a preference rather than a rule.** ProseMirror
      // re-runs every `appendTransaction` over whatever any of them appends, so each of these two
      // sees the document the other left however they are ordered, and swapping them changes no
      // outcome. What this order buys is that a paragraph about to be removed is named and then
      // removed - one wasted identifier - rather than the document being cut about between the pass
      // identity reads its positions in and the one it writes them back in. Both descend now, so
      // both are walking the same nested positions, and keeping a deletion out of that round is
      // worth the line it takes to say so.
      // Cell selection, and the repair of a table's shape after any transaction; column resizing is
      // off, since its plugin owns the table's DOM (component-editor.md, "Tables and footnotes").
      tableEditing(),
      tableHeadersAgree,
      identityPlugin(options.newIdentifier),
      noAdjacentEmptyParagraphs(),
      attributionAlwaysThere,
      // An image carries no marks (figures 4), taken off before annotations are made whole, so the
      // two pieces of one either side of it are still read as one.
      imagesUnmarked,
      // A mark's identifier comes from the same source a block's does, here as in the keymap above.
      annotationsInOnePiece(options.newIdentifier),
      // One decorations plugin, holding both the spellcheck rule and the empty attribution's
      // placeholder: the view merges every plugin's set anyway, and one set is one thing to test.
      new Plugin({
        props: {
          decorations: (state) =>
            DecorationSet.create(state.doc, [
              ...spellcheckDecorations(state.doc).find(),
              ...placeholderDecorations(state.doc).find(),
            ]),
        },
      }),
    ],
  });
}
