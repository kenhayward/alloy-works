import { forbiddenInPreformatted, isLanguageLabel } from '@alloy-works/domain';
import { chainCommands, newlineInCode, splitBlockAs } from 'prosemirror-commands';
import { Fragment, Slice, type Node, type NodeType } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { Selection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform';

import { editorSchema } from './schema.js';
import { insertTable } from './tables.js';

const listNode = editorSchema.nodes.list;
const listItemNode = editorSchema.nodes.listItem;
const definitionListNode = editorSchema.nodes.definitionList;
const definitionItemNode = editorSchema.nodes.definitionItem;
const termNode = editorSchema.nodes.term;
const paragraphNode = editorSchema.nodes.paragraph;
const preformattedNode = editorSchema.nodes.preformatted;
const blockquoteNode = editorSchema.nodes.blockquote;
const attributionNode = editorSchema.nodes.attribution;
const figureCaptionNode = editorSchema.nodes.figureCaption;

/** What the stored model's `format` may say, and nothing else (CNT-153, and the start rule below). */
const NUMBERINGS = new Set(['decimal', 'alphabetic', 'roman']);

/**
 * How many lists and quotations may stand inside one another before the stored model refuses the
 * document, counted in `levelsOf`'s units: a list one, a quotation two, which is the engine's cost
 * rather than the store's - a quotation costs the store half what a list does, and the engine about
 * twice (final review, finding 3).
 *
 * **Measured, not chosen.** `parseContentDocument` refuses content nested past a JSON depth of 128
 * (issue #125), and one list level costs four of those - the list, its items, an item, its content -
 * so a list at the thirty-first level is a document `fromEditor` throws on. `blocks.test.ts` pins
 * both sides of this number against the real mapping, so a change to either the limit or the stored
 * shape fails there rather than at an author's keyboard.
 *
 * **It is the model's limit and not the engine's**, deliberately. Typst's `json()` gives up one
 * level earlier, so a list of exactly this many levels stores and can never publish; choosing a
 * single stated ceiling that sits below both cliffs, and saying it in levels an author recognises,
 * is issue #159, which carries the measurement. Refusing here at the engine's number would refuse
 * content the store holds, which is a different and worse kind of wrong.
 *
 * **Five routes answer to it, because five can build a level.** Three are commands: `nestItem`,
 * `makeDefinitionList` over any paragraph, and `countedList` over a paragraph inside a definition
 * item, where it wraps rather than toggling. Two are keys nobody would guess at - `Backspace` at the
 * start of a definition item's term and `Delete` at the end of the one before it, which cannot join
 * two items and nest one inside the other instead (`refusePastTheLimit`, and issue #160). The
 * toggle, the kind change and both lifts cannot make a document deeper than the one they were
 * handed, so they do not ask.
 */
export const MOST_NESTED_LEVELS = 30;

/**
 * How many levels a node counts as: a list of either type one, a quotation **two**. Measured against
 * the pinned engine (final review, finding 3): fifteen quotations inside one another compile and
 * sixteen do not, and lists and quotations alternating compile to twenty levels and not twenty-one -
 * both exactly thirty at these weights. Thirty plain lists fail too, which predates quotations and is
 * issue #159's, where the ceiling itself is decided.
 */
const levelsOf = (type: NodeType): number =>
  type === blockquoteNode ? 2 : type === listNode || type === definitionListNode ? 1 : 0;

/** The longest chain of lists and quotations inside one another anywhere here, in levels. */
function deepestNesting(node: Node, within = 0): number {
  let deepest = within;
  node.forEach((child) => {
    const inside = within + levelsOf(child.type);
    const below = deepestNesting(child, inside);
    if (below > deepest) deepest = below;
  });
  return deepest;
}

/**
 * Whether a document nests lists deeper than the store will take.
 *
 * It asks of the **whole** document, so a chain already past the limit would refuse a nesting
 * anywhere else in the component too. Nothing can be in that state: every command and every key
 * that could build a level asks this first, and what the editor opened came through
 * `parseContentDocument`.
 */
const tooDeep = (doc: Node | undefined): boolean =>
  doc === undefined || deepestNesting(doc) > MOST_NESTED_LEVELS;

/**
 * A key that would make the document deeper than the model admits, **taken and not passed on**.
 *
 * `Backspace` and `Delete` build a list level, which nothing about either key suggests. Two
 * `definitionItem`s cannot merge - the content is `term block+` - so `deleteBarrier`, which the base
 * chain reaches through `joinBackward` and `joinForward`, wraps the following item in a new
 * definition list inside the previous one instead of joining them. At the limit that is a document
 * `fromEditor` throws on, reached by one press of a key an author thinks of as destructive.
 *
 * **It returns true to refuse and false to allow**, which is the opposite of every other command
 * here and is the whole point. This stands **ahead of** the binding that does the work: returning
 * false hands the key on to `baseKeymap`, which stays the only implementation of either key, and
 * returning true consumes the press so that nothing runs and the author is left where they were -
 * the same answer Tab gives at the limit, and the same conservative direction.
 *
 * It probes the document the command would make, exactly as `nestItem` does, and it passes the view
 * through: `joinBackward` asks `view.endOfTextblock`, and without it the probe would answer a
 * different question from the press.
 *
 * What these keys should do between two definition items at **ordinary** depth is a real defect -
 * a destructive key that nests - and it is issue #160. It is not answered here.
 */
export function refusePastTheLimit(command: Command): Command {
  return (state, _dispatch, view) => {
    const would: Node[] = [];
    if (!command(state, (tr) => would.push(tr.doc), view)) return false;
    return tooDeep(would[0]);
  };
}

/** How many levels - lists and quotations - the cursor stands inside. */
function listsAbove(state: EditorState): number {
  const { $from } = state.selection;
  let count = 0;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    count += levelsOf($from.node(depth).type);
  }
  return count;
}

/**
 * One editing action over a block, as the toolbar, the keymap and the list panel read it.
 *
 * `bulletedList` and `numberedList` toggle: in a list of that kind they take the paragraph back out,
 * which is what every editor an author has used does. `nestItem` and `liftItem` are not toggles -
 * they move an item a level in one direction - and `definitionList` is not one either, for the
 * reason `makeDefinitionList` gives.
 */
export type BlockAction =
  | 'bulletedList'
  | 'numberedList'
  | 'definitionList'
  | 'nestItem'
  | 'liftItem'
  | 'quotation'
  | 'preformatted'
  | 'table';

/** The innermost list the cursor stands in, with the position it stands at, or null. */
function innermostList(state: EditorState): { node: Node; pos: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === listNode || node.type === definitionListNode) {
      return { node, pos: $from.before(depth) };
    }
  }
  return null;
}

/**
 * The list the cursor is inside, innermost first, or null: what the list panel reads.
 *
 * A definition list reads `kind: 'definition'` with neither a start nor a numbering, because the
 * editor holds it as its own node type and the stored model holds it as a third kind of one list
 * (ADR-0025, "the editor schema is not the stored model one for one"). The panel therefore asks one
 * question - which kind is this - rather than two.
 *
 * **`id` is which list this is, and it is here so a renderer can tell one list from another.** A
 * panel holding a value the author typed has to know when it is looking at a different list, and
 * the three attributes cannot tell it: two lists with no start and no numbering are the same answer
 * twice, so a refused value typed on one would follow the cursor to the next and the complaint
 * under it would then be about a list that never had the problem. Null only for a list nothing has
 * named yet, which the identity plugin repairs in the same cycle - so anything reading this after
 * `state.apply` sees a real one.
 */
export function listAt(
  state: EditorState,
): { id: string | null; kind: string; start: number | null; format: string | null } | null {
  const inside = innermostList(state);
  if (inside === null) return null;
  const id = inside.node.attrs.id as string | null;
  if (inside.node.type === definitionListNode) {
    return { id, kind: 'definition', start: null, format: null };
  }
  return {
    id,
    kind: inside.node.attrs.kind as string,
    start: inside.node.attrs.start as number | null,
    format: inside.node.attrs.format as string | null,
  };
}

/** The item type the cursor stands in - counted or definition - or null outside a list. */
function itemTypeAt(state: EditorState): NodeType | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const type = $from.node(depth).type;
    if (type === listItemNode || type === definitionItemNode) return type;
  }
  return null;
}

/**
 * The item the cursor stands in, where **the cursor's own block is the only thing in it** - which is
 * what Enter means by "an empty item" and the only place Enter leaves a list.
 *
 * **It asks about the item, not about the block.** `outOfDefinitionList` rebuilds the item's place
 * from the cursor's block alone, and `liftListItem` takes the whole item out of the list; a rule
 * that only asked whether the cursor's block was empty would answer yes for an item holding a
 * written paragraph and an empty one after it, and Enter would then destroy a paragraph the author
 * wrote - which `fromEditor` accepts, so the loss would be what the next version records. Declining
 * is the conservative direction: the block falls through to `splitListItem` and then to
 * `enterWithoutEmpties`, which is what it did before this chain existed, and a command that declines
 * leaves the author where they were.
 *
 * So the item holds the cursor's block and nothing else, except that a definition item also holds
 * its term and **the term must be empty too**: an item whose word is written and whose definition is
 * not is an item being typed, and Enter there makes the next item rather than leaving the list - and
 * leaving it would discard the word, because a term has no home outside a definition list.
 *
 * The index check is what keeps a cursor in an empty **term** out: a term is a textblock too, and
 * the item's last child is its body. **Deleting it fails no test, and that is the claim rather than
 * a hole**: the count above already forces the index for every shape this schema can make, and the
 * only way to reach it from a term is a chain that answers the term later than this one -
 * `splitDefinitionItem` answers it first. It is here so that such a chain fails loudly rather than
 * lifting an item out from under a written body.
 */
function emptyItemAt(state: EditorState): Node | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth < 2) return null;
  if (!$from.parent.isTextblock || $from.parent.content.size !== 0) return null;
  const item = $from.node(-1);
  if (item.type !== listItemNode && item.type !== definitionItemNode) return null;
  const definition = item.type === definitionItemNode;
  if (item.childCount !== (definition ? 2 : 1)) return null;
  if ($from.index(-1) !== item.childCount - 1) return null;
  if (definition && item.firstChild!.content.size !== 0) return null;
  return item;
}

/**
 * Changes a list's kind, start or numbering, refusing a start a numbering cannot carry.
 *
 * **It merges onto what the list already carries and judges the merged three together**, because
 * the panel changes one field at a time. An author who sets **Start at 0** on a decimal list (which
 * is allowed) and then sets **Numbering** to `i, ii, iii` would otherwise leave the list at
 * `start: 0, format: 'roman'` - which `checkBlock` refuses, on a list of **any** kind, and which the
 * author meets weeks later as `saveIteration`'s fixed message, "The content is not a document this
 * product can store.", naming nothing. A command that judged only the member it was handed would be
 * the only defence and would not be one.
 *
 * **Changing the kind away from ordered clears both**, rather than refusing: `checkBlock` refuses a
 * start or a numbering on a list that is not ordered, and an author pressing **Bulleted list** has
 * said plainly what they want. Asking for a start or a numbering on a list that is not ordered is a
 * different thing and is refused, because the panel does not offer it and nothing else should.
 *
 * A definition list is refused outright: it is its own node type here and carries none of the three.
 */
export function setListAttributes(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const inside = innermostList(state);
    if (inside === null || inside.node.type !== listNode) return false;
    for (const name of Object.keys(attrs)) {
      if (name !== 'kind' && name !== 'start' && name !== 'format') return false;
    }

    const asked = attrs as { kind?: unknown; start?: unknown; format?: unknown };
    const kind = 'kind' in attrs ? asked.kind : (inside.node.attrs.kind as string);
    if (kind !== 'ordered' && kind !== 'unordered') return false;

    // Numbering belongs to an ordered list and to nothing else, so leaving one is what clears it.
    const leaving = kind !== 'ordered';
    if (leaving && ('start' in attrs || 'format' in attrs)) return false;
    const start = leaving
      ? null
      : ((('start' in attrs ? asked.start : inside.node.attrs.start) ?? null) as number | null);
    const format = leaving
      ? null
      : ((('format' in attrs ? asked.format : inside.node.attrs.format) ?? null) as string | null);

    if (start !== null && (!Number.isInteger(start) || start < 0)) return false;
    if (format !== null && !NUMBERINGS.has(format)) return false;
    // CNT-153: a zeroth item is a convention decimal has and letters and roman
    // numerals do not. `checkBlock` holds the same rule, so this is defence in depth rather than
    // the only defence - but it is the one an author meets at the moment they ask for it.
    if (start === 0 && (format === 'alphabetic' || format === 'roman')) return false;

    // Asking for what the list already says is a thing the panel does - a select left alone, a
    // field re-committed - and it is not a change. A transaction for it would put a step on the
    // history that an author's next press of Undo would appear to spend on nothing.
    const same =
      kind === inside.node.attrs.kind &&
      start === (inside.node.attrs.start ?? null) &&
      format === (inside.node.attrs.format ?? null);
    if (dispatch && !same) {
      dispatch(
        state.tr
          .setNodeMarkup(inside.pos, undefined, { ...inside.node.attrs, kind, start, format })
          .scrollIntoView(),
      );
    }
    return true;
  };
}

/**
 * A counted list of that kind out of the block the cursor is in, or back out of one.
 *
 * Three answers rather than two, because an author in a list of the **other** counted kind has
 * pressed a button meaning "number this instead of bulleting it", not "nest a bulleted list inside
 * my numbered one". Changing the kind goes through `setListAttributes`, so the start and the
 * numbering are cleared with it and the list cannot be stranded in a shape the store refuses.
 *
 * In a **definition** list the command wraps as usual, which nests a counted list in the definition
 * being written. That is a real thing to want and it is what the author asked for; the definition
 * list itself is left alone. **That is also the one branch here that builds a level**, so it is the
 * one that has to answer `MOST_NESTED_LEVELS`: the toggle lifts and the kind change rewrites
 * an attribute, and neither can make a document deeper than the one it was handed.
 */
function countedList(kind: 'ordered' | 'unordered', newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const inside = innermostList(state);
    if (inside !== null && inside.node.type === listNode) {
      if (inside.node.attrs.kind === kind) return liftListItem(listItemNode)(state, dispatch);
      return setListAttributes({ kind })(state, dispatch);
    }
    // Asked of the document the wrap would make, as `nestItem` asks it, because a selection can
    // span more than the paragraph the cursor is in - and a list caught inside the range goes down
    // a level with it. The probe carries a null identifier so that a query, which is what the
    // toolbar asks to decide whether a button is available, still draws none.
    const would: Node[] = [];
    try {
      wrapInList(listNode, { id: null, kind })(state, (tr) => would.push(tr.doc));
    } catch {
      // `prosemirror-schema-list` throws from inside `canSplit` over a range that begins in a
      // definition standing in a counted list and ends in the item after it (issue #166). Declining
      // is the answer: the press does nothing, and the button says it would do nothing.
      return false;
    }
    if (would.length === 0) return false;
    if (tooDeep(would[0])) return false;
    // The identifier is drawn only where the list is actually made: a query - which is what the
    // toolbar asks to decide whether a button is available - must cost nothing and change nothing.
    const id = dispatch === undefined ? null : newIdentifier();
    return wrapInList(listNode, { id, kind })(state, dispatch);
  };
}

/**
 * `wrapInList(definitionList)` returns false, measured: it cannot make an item that needs a term out
 * of a paragraph, because a definition item is `term block+` and a wrapping never inserts a sibling.
 * This wraps the paragraph as the item's body and opens an empty term above it, with the selection
 * in the term, because the term is what an author types first.
 *
 * **A `ReplaceAroundStep` rather than a replacement**, for the reason `wrapInList` uses one: the
 * paragraph is left where it is and only wrapped, so its position maps forward and it keeps its
 * identifier. Replacing it with a rebuilt copy would collapse every position inside it, the identity
 * plugin would find no heir, and a toolbar press would silently rename a block that comments,
 * conditions and cross-references hang on (CNT-002).
 *
 * There is no way back. A definition item's term is text with no home outside the list, so
 * unmaking one either discards what the author typed or invents a block to put it in; neither is a
 * thing a button press may do without being asked, so the command declines inside a definition list
 * and says so by returning false.
 */
function makeDefinitionList(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    // A paragraph, and no other textblock: a term, an attribution or preformatted text cannot be
    // made into a definition, and the wrap below throws over one (final review, finding 5).
    if (!$from.sameParent($to) || $from.parent.type !== paragraphNode) return false;
    // Already in one: see above. A term is not a block, so wrapping from inside one is meaningless
    // as well as lossy.
    if (innermostList(state)?.node.type === definitionListNode) return false;
    const start = $from.before($from.depth);
    const end = $from.after($from.depth);
    const index = $from.index($from.depth - 1);
    if (!$from.node($from.depth - 1).canReplaceWith(index, index + 1, definitionListNode)) {
      return false;
    }
    // One more level than the cursor already stands in, and `MOST_NESTED_LEVELS` is the most
    // the store will take. Counting the ancestry is exact here where `nestItem` has to probe:
    // the guards above admit one textblock and nothing else, and a textblock holds no lists, so
    // the new list's own level is the deepest thing this can make.
    if (listsAbove(state) + 1 > MOST_NESTED_LEVELS) return false;
    if (dispatch) {
      const term = termNode.create();
      const wrapper = definitionListNode.create(
        { id: newIdentifier() },
        Fragment.from(definitionItemNode.create(null, Fragment.from(term))),
      );
      // The gap - the paragraph being wrapped - opens after the term: one position into the list,
      // one into the item, and the term's own size past it.
      const insert = 1 + 1 + term.nodeSize;
      const tr = state.tr.step(
        new ReplaceAroundStep(
          start,
          end,
          start,
          end,
          new Slice(Fragment.from(wrapper), 0, 0),
          insert,
          // **Not a structure step.** One checks that the range outside its gap holds no content,
          // and the inverse's does - the empty term - so undoing a Definition list would fail that
          // check, and the history drops a failing step without a word: the list stayed and only
          // its identifier moved (issue #166). The forward step has nothing to overwrite anyway.
          false,
        ),
      );
      dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 3)).scrollIntoView());
    }
    return true;
  };
}

/**
 * `Backspace` at the start of a definition item's term, or `Delete` at the end of the item before it:
 * **the two items become one** (issue #160). Without this, `deleteBarrier` could not merge them - a
 * definition item is `term block+`, so a join puts a paragraph where the term must be - and wrapped
 * the second item in a new definition list inside the first instead, one level deeper, from a key an
 * author thinks of as destructive.
 *
 * The join is the one a paragraph gets: the second term's text runs on at the end of the first
 * item's last paragraph, and the second item's body follows it. **An empty term is taken away and
 * the body's first paragraph joins instead**, which is exactly the inverse of `Enter` in a
 * definition: that splits the paragraph and opens an empty term between the halves.
 *
 * One deletion over the boundary, so everything before it maps forward untouched and every block
 * keeps its identifier. Where the text before the boundary is not a paragraph - the item ends in a
 * quotation, a list or preformatted text - there is nothing a term's words can join, and the key is
 * **taken and does nothing**, rather than handed on to the join that nests.
 */
export function joinDefinitionItems(direction: 'backward' | 'forward'): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!selection.empty) return false;
    const $at = selection.$from;
    let itemStart: number | null = null;
    if (direction === 'backward') {
      if ($at.parent.type !== termNode || $at.parentOffset !== 0) return false;
      const itemDepth = $at.depth - 1;
      // The first item's term has no item before it to join.
      if ($at.index(itemDepth - 1) === 0) return false;
      itemStart = $at.before(itemDepth);
    } else {
      if (!$at.parent.isTextblock || $at.parentOffset !== $at.parent.content.size) return false;
      for (let depth = $at.depth - 1; depth > 0; depth -= 1) {
        const node = $at.node(depth);
        // Only from the very end of an item: the caret's block is the last thing in each level.
        if ($at.index(depth) !== node.childCount - 1) return false;
        if (node.type === definitionItemNode) {
          if ($at.index(depth - 1) + 1 >= $at.node(depth - 1).childCount) return false;
          itemStart = $at.after(depth);
          break;
        }
      }
      if (itemStart === null) return false;
    }

    const item = state.doc.resolve(itemStart).nodeAfter!;
    const term = item.firstChild!;
    const before = Selection.findFrom(state.doc.resolve(itemStart), -1, true);
    if (before === null || before.$from.parent.type !== paragraphNode) return true;
    const joinFrom = before.from;
    const firstBody = item.child(1);
    const joinTo =
      term.content.size === 0 && firstBody.type === paragraphNode
        ? itemStart + 1 + term.nodeSize + 1
        : itemStart + 2;
    if (dispatch) {
      const tr = state.tr.delete(joinFrom, joinTo);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, joinFrom)).scrollIntoView());
    }
    return true;
  };
}

/**
 * `splitListItem(definitionItem)` returns false from the term and from the body alike, measured: a
 * split's remainder is a paragraph, which cannot be an item's first child where that must be a term,
 * and `Transform.split` can change a type but never add a sibling.
 *
 * From the **term**, Enter does not split at all - it moves the cursor into the body, which is what
 * every definition list an author has used does and what they mean by pressing it.
 * From the **body**, Enter makes a new item whose term is empty and whose body holds the remainder,
 * and puts the selection in the new term - except in an item where nothing has been written at all,
 * which it declines so that Enter leaves the list instead (see `leaveTheList`).
 *
 * The step is the one `Transform.split` builds, with the term added to the second item: an open
 * slice of two items inserted at the cursor, so everything after the cursor flows into the second
 * and **every position before it maps forward untouched**. That is what keeps the blocks already in
 * the item carrying the identifiers they had.
 */
function splitDefinitionItem(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    if ($from.depth < 2 || !$from.sameParent($to)) return false;
    if ($from.node(-1).type !== definitionItemNode) return false;

    if ($from.parent.type === termNode) {
      if (dispatch) {
        // `term block+`, so there is always a body to move into, and it opens one past the term.
        const body = Selection.near(state.doc.resolve($from.after($from.depth) + 1), 1);
        dispatch(state.tr.setSelection(body).scrollIntoView());
      }
      return true;
    }
    if (!$from.parent.isTextblock) return false;
    if (emptyItemAt(state) !== null) return false;

    if (dispatch) {
      const tr = state.tr.delete($from.pos, $to.pos);
      const head = definitionItemNode.create(null, Fragment.from($from.parent.copy()));
      const tail = definitionItemNode.create(
        null,
        Fragment.from([
          termNode.create(),
          // A fresh identifier rather than the copied one: the raw split leaves two blocks carrying
          // one identifier, which the store refuses as used more than once. The identity plugin
          // answers that too, and answering it here as well is what makes the command's own output
          // storable.
          $from.parent.type.create({ ...$from.parent.attrs, id: newIdentifier() }),
        ]),
      );
      tr.step(
        new ReplaceStep($from.pos, $from.pos, new Slice(Fragment.from([head, tail]), 2, 2), true),
      );
      // The first empty term after the cut is the one just made; `splitListItem` finds its own
      // selection the same way, and for the same reason: the step's own positions are not the
      // document's.
      let at = -1;
      tr.doc.nodesBetween($from.pos, tr.doc.content.size, (node, pos) => {
        if (at > -1) return false;
        if (node.type === termNode && node.content.size === 0) at = pos + 1;
        return true;
      });
      if (at > -1) tr.setSelection(Selection.near(tr.doc.resolve(at)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * The last item of a definition list, emptied, taken out of the list - which `liftListItem` cannot
 * do. Measured: `liftListItem(definitionItem)` returns **false** at the top level of a definition
 * list, because lifting an item hands its whole content to the list's parent and an item opens with
 * a term, which is inline content no block sequence will hold. So an author who pressed Enter in a
 * fresh definition item would have no key that leaves the list at all.
 *
 * The list is replaced by what is left of it with the empty paragraph standing where the item was:
 * the items before it as one list, the paragraph, the items after it as another. The second list is
 * given a fresh identifier because two lists may not carry one (CNT-002).
 */
function outOfDefinitionList(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const item = emptyItemAt(state);
    if (item === null || item.type !== definitionItemNode) return false;
    if ($from.node(-2).type !== definitionListNode) return false;
    const list = $from.node(-2);
    const at = $from.index(-2);
    if (dispatch) {
      const items = (from: number, to: number): Node[] => {
        const taken: Node[] = [];
        for (let index = from; index < to; index += 1) taken.push(list.child(index));
        return taken;
      };
      const left: Node[] = [];
      if (at > 0) left.push(list.copy(Fragment.from(items(0, at))));
      left.push($from.parent);
      if (at < list.childCount - 1) {
        left.push(
          list.type.create(
            { ...list.attrs, id: newIdentifier() },
            Fragment.from(items(at + 1, list.childCount)),
          ),
        );
      }
      const from = $from.before(-2);
      const tr = state.tr.replaceWith(from, from + list.nodeSize, left);
      const paragraphAt = at > 0 ? from + left[0]!.nodeSize : from;
      dispatch(tr.setSelection(Selection.near(tr.doc.resolve(paragraphAt + 1))).scrollIntoView());
    }
    return true;
  };
}

/**
 * Enter in an empty item leaves the list: a nested item comes up one level, a top-level one comes
 * out of the list altogether.
 *
 * **Guarded on the item being empty**, which the two `liftListItem`s are not. A selection spanning
 * two items makes `splitListItem` decline - it needs one parent - and an unguarded lift would then
 * take both items out of the list on a keystroke that meant "replace this and split". Measured: it
 * does exactly that. The guard is also the design's own sentence, which is about an empty block
 * (component-editor.md, "Invariants the editor holds").
 */
function leaveTheList(newIdentifier: () => string): Command {
  const lift = chainCommands(
    liftListItem(listItemNode),
    liftListItem(definitionItemNode),
    outOfDefinitionList(newIdentifier),
  );
  return (state, dispatch) => (emptyItemAt(state) === null ? false : lift(state, dispatch));
}

/**
 * Every Enter a list answers, in the order that makes the answers reachable.
 *
 * `enterWithoutEmpties` is **not** in it, and its absence is the point: it returns true and does
 * nothing in an empty paragraph, so wherever it stands ahead of a lift, an author who presses Enter
 * in an empty list item is trapped in the list with no key that leaves it. `state.ts` chains this
 * ahead of it, and `blocks.test.ts` proves the order by pressing the key through the real keymap
 * rather than by reasoning about precedence.
 *
 * Every command here returns false outside a list, so the order is safe in both directions.
 */
export function listAwareEnter(newIdentifier: () => string): Command {
  return chainCommands(
    // The term and the body cases, both ours: `prosemirror-schema-list` declines at both.
    splitDefinitionItem(newIdentifier),
    // Declines in an empty item, which is what makes the next link reachable.
    splitListItem(listItemNode),
    leaveTheList(newIdentifier),
  );
}

/**
 * An item, a level down, under the item above it.
 *
 * **The new sublist inherits the kind and the numbering of the list it came out of, and not its
 * start.** `sinkListItem` builds it with `parent.type.create(null, ...)`, so left alone an item of a
 * list numbered `vii, viii, ix` sinks into a **bulleted** one - the first place this slice would
 * lose something the author set. The kind because Tab indents and does not turn a numbered list into
 * a bulleted one; the numbering because reverting to decimal one level down is the same loss one
 * level down. The **start** is not inherited: a start says where *this* list begins counting and the
 * author set it for the outer one, so a sublist beginning at seven is a number nobody asked for.
 *
 * A definition list carries none of the three, so the question does not arise there - the sublist is
 * a definition list because the item is a definition item, and there is nothing else to carry.
 *
 * **A sublist that was already there is left alone**, and the question that tells the two apart is
 * asked of the document the command was handed: does the item above this one already end with a
 * sublist? That is `sinkListItem`'s own precondition, read from the same place it reads it, and it
 * is the one discriminator that cannot go wrong. Telling them apart by the new list's identifier
 * being null would hold only while every list in a live document carries one, which nothing pins -
 * and a document carrying a list with none would have its kind, start and numbering silently reset
 * by a press of Tab.
 *
 * **It declines when the level it would build is deeper than the stored model admits**
 * (`MOST_NESTED_LEVELS`). Until it did, the thirty-first Tab took the key and built the level,
 * and `fromEditor` then threw on every save for the rest of the session - so the author kept typing
 * into a page that said it was saving and lost all of it. Asked and answered here instead, in the
 * doctrine this family holds everywhere else: the command declines, the toolbar reads the decline
 * and shows **Nest item** unavailable, and Tab hands the key back to the browser.
 *
 * **The question is asked of the document the sink would make, not of the cursor's ancestry.** A
 * throwaway transaction costs what `liftItem`'s does, and it is the only measure that cannot be
 * wrong about how much depth a nesting adds - or about a deep list somewhere else in the component,
 * which must not freeze Tab in a shallow one.
 */
function nestItem(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const itemType = itemTypeAt(state);
    if (itemType === null) return false;
    const sink = sinkListItem(itemType);
    const would: Node[] = [];
    if (!sink(state, (tr) => would.push(tr.doc))) return false;
    if (tooDeep(would[0])) return false;
    if (dispatch === undefined) return true;

    const { $from } = state.selection;
    let itemDepth = $from.depth;
    while (itemDepth > 0 && $from.node(itemDepth).type !== itemType) itemDepth -= 1;
    const outer = itemDepth > 0 ? $from.node(itemDepth - 1) : null;
    const index = itemDepth > 0 ? $from.index(itemDepth - 1) : 0;
    const joins =
      outer !== null && index > 0 && outer.child(index - 1).lastChild?.type === outer.type;
    if (joins) return sink(state, dispatch);

    return sink(state, (tr) => {
      const $at = tr.doc.resolve(tr.mapping.map(state.selection.from));
      for (let depth = $at.depth; depth > 0; depth -= 1) {
        const made = $at.node(depth);
        if (made.type !== listNode && made.type !== definitionListNode) continue;
        tr.setNodeMarkup($at.before(depth), undefined, {
          ...made.attrs,
          id: newIdentifier(),
          ...(made.type === listNode && outer?.type === listNode
            ? { kind: outer.attrs.kind, format: outer.attrs.format, start: null }
            : {}),
        });
        break;
      }
      dispatch(tr);
    });
  };
}

/**
 * One editing action over a block, as a command.
 *
 * `newIdentifier` is where a node this makes takes its identifier from - the same source a block's
 * and a mark's come from, because all three are allocated by the editor and all three have to be
 * unique within the component (ADR-0023, CNT-002). The identity plugin judges what comes out by the
 * descent rule as it judges everything else; naming it here is what makes the command's own output
 * storable rather than storable-once-a-plugin-has-run.
 */
export function blockCommand(action: BlockAction, newIdentifier: () => string): Command {
  switch (action) {
    case 'bulletedList':
      return countedList('unordered', newIdentifier);
    case 'numberedList':
      return countedList('ordered', newIdentifier);
    case 'definitionList':
      return makeDefinitionList(newIdentifier);
    case 'nestItem':
      return nestItem(newIdentifier);
    /**
     * **A definition item at the top level of its list does not lift, and that is a limit rather
     * than an oversight.** Lifting an item hands its whole content to the list's parent, and an item
     * opens with a term, which is inline content no block sequence will hold - so there is nowhere
     * for the item to go and taking it out would mean discarding the word the author wrote. Enter in
     * an item with nothing written in it still leaves the list, because there is then nothing to
     * discard (`outOfDefinitionList`). A nested definition item lifts a level like any other.
     *
     * **The query runs the lift rather than asking whether one is possible.** `liftListItem` returns
     * true for any item as soon as it is asked without a dispatch, before it knows whether the lift
     * can be made, so a toolbar reading it that way would offer **Lift item** where pressing it does
     * nothing. A dispatch that throws the transaction away costs one unapplied transaction and makes
     * the answer the same one the press gives.
     */
    case 'liftItem':
      return (state, dispatch) => {
        const itemType = itemTypeAt(state);
        if (itemType === null) return false;
        return liftListItem(itemType)(state, dispatch ?? (() => undefined));
      };
    case 'quotation':
      return quotation(newIdentifier);
    case 'preformatted':
      return preformatted(newIdentifier);
    case 'table':
      return insertTable(newIdentifier);
  }
}

/**
 * Whether the selection stands anywhere in a table's cell, at any depth. A cell holds paragraphs and
 * lists alone, and so does a list inside one (tables 1, decision T-D) - which a content expression
 * cannot say, since a list item holds any block wherever it stands - so the commands that make a
 * quotation or preformatted text ask this as well as the parent.
 */
const inTableCell = (state: EditorState): boolean => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (
      $from.node(depth).type.spec.tableRole === 'cell' ||
      $from.node(depth).type.spec.tableRole === 'header_cell'
    ) {
      return true;
    }
  }
  return false;
};

/** Whether the cursor stands in a node whose text is code, as `newlineInCode` asks it. */
const inCode = (state: EditorState): boolean =>
  state.selection.$head.parent.type.spec.code === true;

/** A command that declines wherever the cursor stands in code, and runs anywhere else. */
export function outsideCode(command: Command): Command {
  return (state, dispatch, view) => (inCode(state) ? false : command(state, dispatch, view));
}

/**
 * `Tab` in preformatted text types a tab, which is the character CNT-018 exists to keep; anywhere
 * else it declines, so the list's Tab and the browser's still answer (decision I). `Shift-Tab` is
 * never taken in code, which is what keeps this from being a trap (CNT-077).
 */
export const insertTabInCode: Command = (state, dispatch) => {
  if (!inCode(state)) return false;
  dispatch?.(state.tr.insertText('\t').scrollIntoView());
  return true;
};

/** The innermost quotation the cursor stands in, with where it stands, or null. */
function innermostQuotation(state: EditorState): { node: Node; pos: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === blockquoteNode) {
      return { node: $from.node(depth), pos: $from.before(depth) };
    }
  }
  return null;
}

/**
 * `Enter` in an attribution leaves the quotation for a paragraph after it: an attribution is one
 * line, and there is nothing it could split into. A figure's caption is left the same way, which is
 * also the way past a figure that is the component's last block (figures 2, final review).
 */
function exitAttribution(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const parent = $from.parent.type;
    if (parent !== attributionNode && parent !== figureCaptionNode) return false;
    if (dispatch) {
      const after = $from.after(-1);
      const tr = state.tr.insert(after, paragraphNode.create({ id: newIdentifier() }));
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * `Enter` in an empty last body paragraph of a quotation that holds another block moves that
 * paragraph out, after the quotation - the way out of a quotation by keyboard, as an empty item is
 * the way out of a list. In the only body paragraph it declines, and `enterWithoutEmpties` then
 * does nothing: a quotation cannot be emptied from inside.
 */
const leaveQuotation: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth < 2) return false;
  if ($from.parent.type !== paragraphNode || $from.parent.content.size !== 0) return false;
  const quoted = $from.node(-1);
  if (quoted.type !== blockquoteNode) return false;
  const body =
    quoted.lastChild!.type === attributionNode ? quoted.childCount - 1 : quoted.childCount;
  if (body < 2 || $from.index(-1) !== body - 1) return false;
  if (dispatch) {
    const paragraph = $from.parent;
    const tr = state.tr.delete($from.before(), $from.after());
    const after = tr.mapping.map($from.after(-1));
    tr.insert(after, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Every `Enter` preformatted text and a quotation answer, chained **ahead of** the list's. In code
 * `newlineInCode` types a line break; without it first, `splitListItem` would split the item around
 * a preformatted block inside one and `splitBlock` would split the block. Each declines where it
 * does not apply, so the order is safe in both directions.
 */
export function codeAwareEnter(newIdentifier: () => string): Command {
  return chainCommands(
    newlineInCode,
    exitAttribution(newIdentifier),
    leaveQuotation,
    splitInQuotation,
  );
}

/**
 * `Enter` in a quotation's own paragraph splits it into two **paragraphs**. Left to `splitBlock`,
 * the default type after a body paragraph is the `attribution` the content expression allows next,
 * so Enter at the end of the last paragraph did nothing and Enter at its start threw (final review,
 * finding 4). An empty paragraph is left to the rest of the chain, which does nothing there.
 */
const splitInQuotation: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if ($from.depth < 2 || $from.parent.type !== paragraphNode) return false;
  if ($from.node(-1).type !== blockquoteNode) return false;
  if (empty && $from.parent.content.size === 0) return false;
  return splitBlockAs(() => ({ type: paragraphNode, attrs: { id: null, style: 'body' } }))(
    state,
    dispatch,
  );
};

/** The block range the selection covers, when every block in it is in the `block` group. */
function blockRangeOf(state: EditorState) {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  if (range === null) return null;
  for (let index = range.startIndex; index < range.endIndex; index += 1) {
    if (!range.parent.child(index).type.isInGroup('block')) return null;
  }
  return range;
}

/**
 * **Quotation** wraps the selected blocks in a quotation with an empty attribution to type into; in
 * a quotation it unwraps the innermost one, and an attribution with text becomes a paragraph after
 * the unwrapped blocks rather than being discarded (decision K). It declines where the quotation
 * would stand deeper than the model admits, asked of the document the wrap would make (decision L).
 */
function quotation(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const inside = innermostQuotation(state);
    if (inside !== null) {
      if (dispatch) {
        const blocks: Node[] = [];
        inside.node.forEach((child) => {
          if (child.type !== attributionNode) blocks.push(child);
          else if (child.content.size > 0) {
            blocks.push(paragraphNode.create({ id: newIdentifier() }, child.content));
          }
        });
        const end = inside.pos + inside.node.nodeSize;
        dispatch(state.tr.replaceWith(inside.pos, end, blocks).scrollIntoView());
      }
      return true;
    }
    const range = blockRangeOf(state);
    if (range === null) return false;
    // Asked of the parent before anything is built: a table's cell holds paragraphs and lists alone
    // (tables 1, decision T-D), and a wrap there would throw from inside the transform.
    if (inTableCell(state)) return false;
    if (!range.parent.canReplaceWith(range.startIndex, range.endIndex, blockquoteNode))
      return false;
    // An identifier only when the wrap is really made: the toolbar asks every command on every
    // render whether it is available, and a query that drew one would spend them on nothing.
    const id = dispatch === undefined ? null : newIdentifier();
    const tr = state.tr.wrap(range, [{ type: blockquoteNode, attrs: { id } }]);
    const wrapped = tr.doc.nodeAt(range.start);
    if (wrapped === null) return false;
    tr.insert(range.start + wrapped.nodeSize - 1, attributionNode.create());
    if (tooDeep(tr.doc)) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * **Preformatted text** over paragraphs of one parent joins them into one block, a line each; in a
 * preformatted block it turns it back into paragraphs, one per line. The paragraphs' marks are
 * **dropped**: the loss is visible, it answers the author's own command, and one undo restores them
 * exactly, the marks' identifiers included (Ken, at plan review; decision K) - the paragraph takes a
 * new block identifier, as every block an undo reinserts does under ADR-0023's descent rule. It
 * **declines over a paragraph holding anything but text** - an inline image, since figures 4 - because
 * that is content, not formatting, and preformatted text holds text alone (final review of figures 4).
 */
function preformatted(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.parent.type === preformattedNode) {
      if (dispatch) {
        const paragraphs = $from.parent.textContent
          .split('\n')
          .map((line) =>
            paragraphNode.create(
              { id: newIdentifier() },
              line === '' ? [] : [editorSchema.text(line)],
            ),
          );
        dispatch(state.tr.replaceWith($from.before(), $from.after(), paragraphs).scrollIntoView());
      }
      return true;
    }
    const range = blockRangeOf(state);
    if (range === null) return false;
    // As Quotation asks: a table's cell holds no preformatted text (tables 1, decision T-D).
    if (inTableCell(state)) return false;
    if (!range.parent.canReplaceWith(range.startIndex, range.endIndex, preformattedNode)) {
      return false;
    }
    const lines: string[] = [];
    for (let index = range.startIndex; index < range.endIndex; index += 1) {
      const block = range.parent.child(index);
      if (block.type !== paragraphNode) return false;
      let textAlone = true;
      block.forEach((child) => {
        if (!child.isText) textAlone = false;
      });
      if (!textAlone) return false;
      lines.push(asPreformatted(block.textContent));
    }
    if (dispatch) {
      const text = lines.join('\n');
      const made = preformattedNode.create(
        { id: newIdentifier(), language: null },
        text === '' ? [] : [editorSchema.text(text)],
      );
      const tr = state.tr.replaceWith(range.start, range.end, made);
      tr.setSelection(TextSelection.create(tr.doc, range.start + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * A paragraph's text as preformatted text may hold it. A paragraph may carry characters preformatted
 * text may not (`checkBlock`), and a block made holding one could never be saved (final review,
 * finding 2). The second spellings of a line break become the line break they are - the engine
 * breaks a line on each - and the other controls, which print as nothing, are left out. Like the
 * marks, visible in what the command did and put back by one undo.
 */
function asPreformatted(text: string): string {
  let kept = '';
  for (const character of text.replace(/\r\n/g, '\n')) {
    const codePoint = character.codePointAt(0)!;
    if ([0xb, 0xc, 0xd, 0x85, 0x2028, 0x2029].includes(codePoint)) kept += '\n';
    else if (!forbiddenInPreformatted(codePoint)) kept += character;
  }
  return kept;
}

/** The preformatted block the cursor stands in, with its label and where it stands, or null. */
export function preformattedAt(
  state: EditorState,
): { language: string | null; pos: number } | null {
  const { $from } = state.selection;
  if ($from.parent.type !== preformattedNode) return null;
  return { language: ($from.parent.attrs.language as string | null) ?? null, pos: $from.before() };
}

/**
 * Sets or clears the label of the preformatted block the cursor stands in. It declines a label that
 * is not a token, which the walk would refuse on save with a message that names nothing.
 */
export function setPreformattedLanguage(language: string | null): Command {
  return (state, dispatch) => {
    const at = preformattedAt(state);
    if (at === null) return false;
    if (language !== null && !isLanguageLabel(language)) return false;
    if (dispatch) {
      const node = state.doc.nodeAt(at.pos)!;
      dispatch(state.tr.setNodeMarkup(at.pos, undefined, { ...node.attrs, language }));
    }
    return true;
  };
}
