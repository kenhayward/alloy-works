import { chainCommands } from 'prosemirror-commands';
import { Fragment, Slice, type Node, type NodeType } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { Selection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform';

import { editorSchema } from './schema.js';

const listNode = editorSchema.nodes.list;
const listItemNode = editorSchema.nodes.listItem;
const definitionListNode = editorSchema.nodes.definitionList;
const definitionItemNode = editorSchema.nodes.definitionItem;
const termNode = editorSchema.nodes.term;

/** What the stored model's `format` may say, and nothing else (CNT-153, and the start rule below). */
const NUMBERINGS = new Set(['decimal', 'alphabetic', 'roman']);

/**
 * One editing action over a block, as the toolbar, the keymap and the list panel read it.
 *
 * `bulletedList` and `numberedList` toggle: in a list of that kind they take the paragraph back out,
 * which is what every editor an author has used does. `nestItem` and `liftItem` are not toggles -
 * they move an item a level in one direction - and `definitionList` is not one either, for the
 * reason `makeDefinitionList` gives.
 */
export type BlockAction =
  'bulletedList' | 'numberedList' | 'definitionList' | 'nestItem' | 'liftItem';

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
 * (ADR, "the editor schema is not the stored model one for one"). The panel therefore asks one
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
 * list itself is left alone.
 */
function countedList(kind: 'ordered' | 'unordered', newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const inside = innermostList(state);
    if (inside !== null && inside.node.type === listNode) {
      if (inside.node.attrs.kind === kind) return liftListItem(listItemNode)(state, dispatch);
      return setListAttributes({ kind })(state, dispatch);
    }
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
    if (!$from.sameParent($to) || !$from.parent.isTextblock) return false;
    // Already in one: see above. A term is not a block, so wrapping from inside one is meaningless
    // as well as lossy.
    if (innermostList(state)?.node.type === definitionListNode) return false;
    const start = $from.before($from.depth);
    const end = $from.after($from.depth);
    const index = $from.index($from.depth - 1);
    if (!$from.node($from.depth - 1).canReplaceWith(index, index + 1, definitionListNode)) {
      return false;
    }
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
          true,
        ),
      );
      dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 3)).scrollIntoView());
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
 */
function nestItem(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    const itemType = itemTypeAt(state);
    if (itemType === null) return false;
    const sink = sinkListItem(itemType);
    if (dispatch === undefined) return sink(state, undefined);

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
  }
}
