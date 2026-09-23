import type { Node } from 'prosemirror-model';
import { redo, undo } from 'prosemirror-history';
import { Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import {
  MOST_NESTED_LEVELS,
  blockCommand,
  listAt,
  listAwareEnter,
  preformattedAt,
  setListAttributes,
  setPreformattedLanguage,
} from './blocks.js';
import { fromEditor } from './mapping.js';
import { tableAt, tableCommand } from './tables.js';
import { editorSchema } from './schema.js';
import { createEditorState } from './state.js';

/**
 * A minute, as structure's randomised tests have (issue #140): the seeded gesture run below takes a
 * quarter of a second on a desktop and took six and a half on a CI runner busy with every other suite.
 */
const RANDOMISED_TEST_TIMEOUT_MS = 60_000;

const counter = () => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

const ids = counter;

/** A paragraph, a term, an item and a list, so a fixture reads as the shape it is. */
const paragraph = (id: string, text: string) =>
  editorSchema.node(
    'paragraph',
    { id, style: 'body' },
    text === '' ? [] : [editorSchema.text(text)],
  );

const item = (...blocks: Node[]) => editorSchema.node('listItem', null, blocks);

const list = (
  id: string,
  kind: 'ordered' | 'unordered',
  items: Node[],
  attrs: { start?: number; format?: string } = {},
) => editorSchema.node('list', { id, kind, start: null, format: null, ...attrs }, items);

const term = (text: string) =>
  text === ''
    ? editorSchema.node('term')
    : editorSchema.node('term', null, [editorSchema.text(text)]);

const definitionItem = (word: string, ...blocks: Node[]) =>
  editorSchema.node('definitionItem', null, [term(word), ...blocks]);

const definitionList = (id: string, ...items: Node[]) =>
  editorSchema.node('definitionList', { id }, items);

const documentOf = (...blocks: Node[]) =>
  editorSchema.node(
    'doc',
    { title: 'Install the printer', language: 'en-GB', direction: 'ltr' },
    blocks,
  );

/**
 * The shape of a document, as nested arrays: a node with children reads `[name, ...children]`, a
 * node with none reads its name, and a text node reads its text. It is what makes an assertion
 * about structure readable beside one about identifiers.
 */
const shapeOf = (node: Node): unknown => {
  const children: unknown[] = [];
  node.forEach((child) => children.push(child.isText ? child.text : shapeOf(child)));
  return children.length === 0 ? node.type.name : [node.type.name, ...children];
};

/** Every term in the document, in document order, so an empty one is visible as `''`. */
const termsIn = (doc: Node): string[] => {
  const found: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'term') found.push(node.textContent);
  });
  return found;
};

/** Every identifier the document carries, at any depth, in document order. */
const identifiers = (doc: Node): unknown[] => {
  const found: unknown[] = [];
  doc.descendants((node) => {
    if (node.type.spec.attrs?.id !== undefined) found.push(node.attrs.id);
  });
  return found;
};

/** The position just inside the block carrying that identifier, or of the first term. */
function inside(doc: Node, what: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (what === 'term' ? node.type.name === 'term' : node.attrs.id === what) found = pos + 1;
    return true;
  });
  if (found === -1) throw new Error(`no ${what} in this document`);
  return found;
}

function stateOf(doc: Node, at: string, newIdentifier = counter()): EditorState {
  const state = createEditorState({ doc, newIdentifier });
  return state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(inside(doc, at)))));
}

/** The same state with the cursor moved into the block carrying that identifier. */
const moveTo = (state: EditorState, at: string): EditorState =>
  state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(inside(state.doc, at)))));

/** Runs a command against a state and returns the state it leads to, and whether it took the key. */
function run(
  state: EditorState,
  command: (s: EditorState, d?: (tr: Transaction) => void) => boolean,
) {
  let next = state;
  const handled = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { handled, next };
}

const KEY_CODES: Record<string, number> = { Enter: 13, Tab: 9, Backspace: 8, Delete: 46 };

/**
 * What a real `EditorView` answers from the DOM, answered from the document instead: the caret is at
 * the start or the end of its textblock. `joinBackward` and `joinForward` ask it - a Backspace is
 * only a join when there is nothing before the caret in its own block - and they throw without it, so
 * a fake view that leaves it out cannot press either key at all.
 */
const endOfTextblock = (now: () => EditorState) => ({
  endOfTextblock: (dir: string) => {
    const { $head } = now().selection;
    return dir === 'backward' || dir === 'up'
      ? $head.parentOffset === 0
      : $head.parentOffset === $head.parent.content.size;
  },
});

/**
 * A key, driven through **the real keymap chain** - every `handleKeyDown` the state's own plugins
 * carry, in the order `createEditorState` put them in, which is the order `EditorView` consults.
 *
 * Reasoning about which binding wins is exactly what this cannot be: `enterWithoutEmpties` is bound
 * in the first keymap and returns true in an empty paragraph, so a list-aware Enter bound anywhere
 * after it would never run and the author would be trapped in the list with no key that leaves it.
 * The only way to know is to press the key.
 */
function press(
  state: EditorState,
  key: string,
  /**
   * Forces `endOfTextblock` to say yes wherever the caret stands, which is **not** a contrivance: it
   * is the view's answer from the DOM, and in bidirectional text it says yes at an offset the
   * document alone says no at. It is what makes passing the view into a probe load-bearing.
   */
  alwaysAtEdge = false,
): { handled: boolean; next: EditorState } {
  let next = state;
  const view = {
    get state() {
      return next;
    },
    dispatch: (tr: Transaction) => {
      next = next.apply(tr);
    },
    ...(alwaysAtEdge ? { endOfTextblock: () => true } : endOfTextblock(() => next)),
  };
  const event = {
    key,
    keyCode: KEY_CODES[key] ?? 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  };
  for (const plugin of state.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (handler === undefined) continue;
    if (handler.call(plugin, view as never, event as never)) return { handled: true, next };
  }
  return { handled: false, next };
}

/** Shift and Tab together, which is the only chord these tests press. */
function pressShiftTab(state: EditorState): { handled: boolean; next: EditorState } {
  let next = state;
  const view = {
    get state() {
      return next;
    },
    dispatch: (tr: Transaction) => {
      next = next.apply(tr);
    },
    ...endOfTextblock(() => next),
  };
  const event = {
    key: 'Tab',
    keyCode: KEY_CODES.Tab!,
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  };
  for (const plugin of state.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (handler === undefined) continue;
    if (handler.call(plugin, view as never, event as never)) return { handled: true, next };
  }
  return { handled: false, next };
}

/**
 * What the store makes of the document. `fromEditor` parses through `parseContentDocument` itself,
 * so this is the real door every save goes through and the only test that matters in the end: a
 * gesture that leaves the editor holding something the model refuses is a save the author meets as
 * `saveIteration`'s fixed message, which names nothing.
 */
const stored = (doc: Node) => fromEditor(doc);

/**
 * The transaction a command produced, **unapplied**. What a command hands its caller is what a
 * caller without the identity plugin would get, so a claim that the command names what it makes is
 * a claim about this document and not about the state that comes back from `state.apply`, where the
 * plugin has already repaired anything left unnamed.
 */
function transactionOf(
  state: EditorState,
  command: (s: EditorState, d?: (tr: Transaction) => void) => boolean,
): Transaction {
  let kept: Transaction | null = null;
  command(state, (tr) => {
    kept = tr;
  });
  if (kept === null) throw new Error('the command dispatched nothing');
  return kept;
}

describe('making a list of a paragraph, and taking one back out', () => {
  it('makes a bulleted list of the paragraph the cursor is in, and the paragraph keeps its identifier', () => {
    const state = stateOf(documentOf(paragraph('b1', 'Unbox the printer.')), 'b1');
    const { handled, next } = run(state, blockCommand('bulletedList', ids()));
    expect(handled).toBe(true);
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      ['list', ['listItem', ['paragraph', 'Unbox the printer.']]],
    ]);
    // Wrapping a paragraph is not making a new one: an identifier is what a comment or a condition
    // hangs on, and a toolbar press must not move it (CNT-002).
    expect(identifiers(next.doc)).toEqual([expect.any(String), 'b1']);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('makes a numbered list carrying no start and no numbering until the author sets one', () => {
    const state = stateOf(documentOf(paragraph('b1', 'Unbox the printer.')), 'b1');
    const { next } = run(state, blockCommand('numberedList', ids()));
    expect(listAt(next)).toEqual({ id: 'n1', kind: 'ordered', start: null, format: null });
    // Absent rather than 1: `start` says where an author chose to begin, and a list nobody has
    // chosen for carries no member at all in the store.
    expect(stored(next.doc).content[0]).toMatchObject({ type: 'list', kind: 'ordered' });
    expect(stored(next.doc).content[0]).not.toHaveProperty('start');
    expect(stored(next.doc).content[0]).not.toHaveProperty('format');
  });

  it('takes a paragraph back out of a list when the same command runs again', () => {
    const state = stateOf(
      documentOf(list('L1', 'unordered', [item(paragraph('b1', 'Unbox'))])),
      'b1',
    );
    const { handled, next } = run(state, blockCommand('bulletedList', ids()));
    expect(handled).toBe(true);
    expect(shapeOf(next.doc)).toEqual(['doc', ['paragraph', 'Unbox']]);
    expect(listAt(next)).toBeNull();
  });

  it('changes a numbered list to a bulleted one rather than nesting one inside it, and the numbering goes with it', () => {
    // The transition F19 names: `checkBlock` refuses a start or a numbering on a list whose kind is
    // not ordered, so a command that changed the kind and left either behind would store a document
    // `parseContentDocument` refuses - and the author would meet that as `saveIteration`'s fixed
    // message, which names nothing.
    const doc = documentOf(
      list('L1', 'ordered', [item(paragraph('b1', 'Unbox'))], { start: 7, format: 'roman' }),
    );
    const { handled, next } = run(stateOf(doc, 'b1'), blockCommand('bulletedList', ids()));
    expect(handled).toBe(true);
    expect(listAt(next)).toEqual({ id: 'L1', kind: 'unordered', start: null, format: null });
    expect(shapeOf(next.doc)).toEqual(['doc', ['list', ['listItem', ['paragraph', 'Unbox']]]]);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('makes a definition list with an empty term and the paragraph as its body', () => {
    const state = stateOf(documentOf(paragraph('b1', 'The greatest stress.')), 'b1');
    const { handled, next } = run(state, blockCommand('definitionList', ids()));
    expect(handled).toBe(true);
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      ['definitionList', ['definitionItem', 'term', ['paragraph', 'The greatest stress.']]],
    ]);
    // The term is what an author types first, so that is where the cursor goes.
    expect(next.selection.$from.parent.type.name).toBe('term');
    expect(identifiers(next.doc)).toEqual([expect.any(String), 'b1']);
    // Named in the command's own transaction, before the identity plugin has seen it.
    expect(identifiers(transactionOf(state, blockCommand('definitionList', ids())).doc)).toEqual([
      expect.any(String),
      'b1',
    ]);
    // A term nobody has typed into is no term at all, and the store takes the item without one.
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('leaves a definition list alone rather than discarding a term the author typed', () => {
    const doc = documentOf(
      definitionList('D1', definitionItem('Creep', paragraph('b1', 'Slow strain.'))),
    );
    const { handled, next } = run(stateOf(doc, 'b1'), blockCommand('definitionList', ids()));
    expect(handled).toBe(false);
    expect(termsIn(next.doc)).toEqual(['Creep']);
  });
});

describe('the Enter chain', () => {
  it('leaves the list when Enter is pressed in an empty item, rather than doing nothing', () => {
    const doc = documentOf(
      list('L1', 'unordered', [item(paragraph('b1', 'Unbox')), item(paragraph('b2', ''))]),
    );
    const { handled, next } = press(stateOf(doc, 'b2'), 'Enter');
    expect(handled).toBe(true);
    expect(next.doc.lastChild!.type.name).toBe('paragraph');
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      ['list', ['listItem', ['paragraph', 'Unbox']]],
      'paragraph',
    ]);
    expect(listAt(next)).toBeNull();
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('leaves a definition list when Enter is pressed in an item with no term and nothing written', () => {
    // `liftListItem(definitionItem)` returns false here, measured: an item is `term block+` and a
    // term has no home outside the list, so the generic lift cannot answer this one.
    const doc = documentOf(
      definitionList(
        'D1',
        definitionItem('Creep', paragraph('b1', 'Slow strain.')),
        definitionItem('', paragraph('b2', '')),
      ),
    );
    const { handled, next } = press(stateOf(doc, 'b2'), 'Enter');
    expect(handled).toBe(true);
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      ['definitionList', ['definitionItem', ['term', 'Creep'], ['paragraph', 'Slow strain.']]],
      'paragraph',
    ]);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('splits a definition list in two when the item left behind stood between others', () => {
    const doc = documentOf(
      definitionList(
        'D1',
        definitionItem('Creep', paragraph('b1', 'Slow strain.')),
        definitionItem('', paragraph('b2', '')),
        definitionItem('Yield', paragraph('b3', 'The greatest stress.')),
      ),
    );
    const { next } = press(stateOf(doc, 'b2'), 'Enter');
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      ['definitionList', ['definitionItem', ['term', 'Creep'], ['paragraph', 'Slow strain.']]],
      'paragraph',
      [
        'definitionList',
        ['definitionItem', ['term', 'Yield'], ['paragraph', 'The greatest stress.']],
      ],
    ]);
    // Two lists, and no two blocks in the component carrying one identifier (CNT-002).
    expect(new Set(identifiers(next.doc)).size).toBe(identifiers(next.doc).length);
    expect(next.selection.$from.parent.type.name).toBe('paragraph');
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('moves from a term into its body on Enter, rather than splitting the term', () => {
    const doc = documentOf(
      definitionList('D1', definitionItem('Creep', paragraph('b1', 'Slow strain.'))),
    );
    const state = stateOf(doc, 'term');
    const { handled, next } = press(state, 'Enter');
    expect(handled).toBe(true);
    expect(next.selection.$from.parent.type.name).toBe('paragraph');
    expect(termsIn(next.doc)).toEqual(['Creep']);
  });

  it('makes a new definition item on Enter in a body, with an empty term', () => {
    const doc = documentOf(
      definitionList('D1', definitionItem('Creep', paragraph('b1', 'Slow strain.'))),
    );
    const state = stateOf(doc, 'b1');
    const atEnd = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, state.selection.$from.end())),
    );
    const { handled, next } = press(atEnd, 'Enter');
    expect(handled).toBe(true);
    expect(termsIn(next.doc)).toEqual(['Creep', '']);
    expect(next.selection.$from.parent.type.name).toBe('term');
    // Two items, each with a body, and every block in them named: the split's second half takes a
    // new identifier rather than carrying the first's.
    expect(identifiers(next.doc)).toEqual(['D1', 'b1', expect.any(String)]);
    expect(new Set(identifiers(next.doc)).size).toBe(3);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('splits a definition item mid text and leaves both halves storable', () => {
    const doc = documentOf(
      definitionList('D1', definitionItem('Creep', paragraph('b1', 'Slow strain.'))),
    );
    const state = stateOf(doc, 'b1');
    // After "Slow", so the remainder goes to the new item's body.
    const cut = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, state.selection.$from.start() + 4)),
    );
    const { next } = press(cut, 'Enter');
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      [
        'definitionList',
        ['definitionItem', ['term', 'Creep'], ['paragraph', 'Slow']],
        ['definitionItem', 'term', ['paragraph', ' strain.']],
      ],
    ]);
    // The raw `splitListItem` duplicates an identifier here rather than leaving one absent, and the
    // store refuses both spellings; the identity plugin answers both.
    expect(new Set(identifiers(next.doc)).size).toBe(3);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('makes a second item on Enter at the end of one, and both halves are storable', () => {
    const doc = documentOf(list('L1', 'ordered', [item(paragraph('b1', 'Unbox'))], { start: 7 }));
    const state = stateOf(doc, 'b1');
    const atEnd = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, state.selection.$from.end())),
    );
    const { handled, next } = press(atEnd, 'Enter');
    expect(handled).toBe(true);
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      ['list', ['listItem', ['paragraph', 'Unbox']], ['listItem', 'paragraph']],
    ]);
    expect(new Set(identifiers(next.doc)).size).toBe(3);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('replaces a selection spanning two items rather than taking both out of the list', () => {
    // `splitListItem` needs one parent and declines here, so an unguarded lift below it would take
    // both items out of the list on a keystroke that meant "replace this and split". Measured: it
    // does exactly that, which is why the lift is guarded on the item being empty.
    const doc = documentOf(
      list('L1', 'unordered', [
        item(paragraph('b1', 'One')),
        item(paragraph('b2', 'Two')),
        item(paragraph('b3', 'Three')),
      ]),
    );
    const state = stateOf(doc, 'b1');
    const spanning = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, inside(state.doc, 'b1') + 1, inside(state.doc, 'b2') + 1),
      ),
    );
    const { handled, next } = press(spanning, 'Enter');
    expect(handled).toBe(true);
    // The selection goes and Enter is pressed at the caret it leaves, which in an item makes the
    // next item - what the same key does anywhere in a list (issue #166, `enterOverRange`).
    // Nothing is lifted, and the list is still a list.
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      [
        'list',
        ['listItem', ['paragraph', 'O']],
        ['listItem', ['paragraph', 'wo']],
        ['listItem', ['paragraph', 'Three']],
      ],
    ]);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('keeps what the author wrote in an item when Enter is pressed in the empty block after it', () => {
    // The whole reason `emptyItemAt` asks about the **item** and not about the cursor's own block.
    // `outOfDefinitionList` rebuilds the item's place from the cursor's block alone, so an item
    // holding a written paragraph and an empty one after it would have left the written one behind -
    // and `fromEditor` accepts the result, so the loss is what the next version records.
    // A selection spanning two definition items plus Enter makes exactly this shape - an item with
    // no term and two body blocks - so it is reachable by gesture alone.
    const doc = documentOf(
      definitionList(
        'D1',
        definitionItem('', paragraph('b1', 'Slow strain.'), paragraph('b2', '')),
      ),
    );
    const { next } = press(stateOf(doc, 'b2'), 'Enter');
    expect(next.doc.textContent).toContain('Slow strain.');
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      [
        'definitionList',
        ['definitionItem', 'term', ['paragraph', 'Slow strain.'], 'paragraph'],
        ['definitionItem', 'term', 'paragraph'],
      ],
    ]);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('keeps a paragraph in a counted item when Enter is pressed in the empty block after it', () => {
    // Milder than the definition half and wrong in the same way: an unguarded lift takes the
    // **whole** item out of the list, so a written paragraph leaves the list without being asked.
    // Declining is the conservative direction - it leaves the author where they were.
    const doc = documentOf(
      list('L1', 'unordered', [item(paragraph('b1', 'One'), paragraph('b2', ''))]),
    );
    const state = stateOf(doc, 'b2');
    const { next } = press(state, 'Enter');
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      ['list', ['listItem', ['paragraph', 'One'], 'paragraph']],
    ]);
    expect(listAt(next)).toEqual({ id: 'L1', kind: 'unordered', start: null, format: null });
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('makes the next item on Enter in an empty body under a term the author wrote', () => {
    // The term is what says whether this item is being typed or is finished with. With a term
    // written, an empty body is where the definition goes, so Enter makes the next item; with the
    // term empty as well, nothing in the item has been written and Enter leaves the list. Without
    // that distinction the term is silently discarded.
    const doc = documentOf(
      definitionList(
        'D1',
        definitionItem('Creep', paragraph('b1', 'Slow strain.')),
        definitionItem('Yield', paragraph('b2', '')),
      ),
    );
    const { handled, next } = press(stateOf(doc, 'b2'), 'Enter');
    expect(handled).toBe(true);
    expect(termsIn(next.doc)).toEqual(['Creep', 'Yield', '']);
    expect(next.doc.firstChild!.type.name).toBe('definitionList');
    expect(next.selection.$from.parent.type.name).toBe('term');
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('names every block it makes in its own transaction, before any plugin has run', () => {
    const doc = documentOf(
      definitionList('D1', definitionItem('Creep', paragraph('b1', 'Slow strain.'))),
    );
    const state = stateOf(doc, 'b1');
    const atEnd = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, state.selection.$from.end())),
    );
    // `tr.doc`, not the applied state: the identity plugin repairs an unnamed or duplicated
    // identifier on the way through, so a state that came back through `apply` cannot tell whether
    // the command named anything at all.
    const made = transactionOf(atEnd, listAwareEnter(ids())).doc;
    expect(identifiers(made)).toEqual(['D1', 'b1', expect.any(String)]);
    expect(new Set(identifiers(made)).size).toBe(3);

    // The list left behind when Enter takes an item out of the middle of one is a second list, and
    // two lists in a component may not carry one identifier (CNT-002).
    const between = documentOf(
      definitionList(
        'D1',
        definitionItem('Creep', paragraph('b1', 'Slow strain.')),
        definitionItem('', paragraph('b2', '')),
        definitionItem('Yield', paragraph('b3', 'The greatest stress.')),
      ),
    );
    const split = transactionOf(stateOf(between, 'b2'), listAwareEnter(ids())).doc;
    expect(identifiers(split)).toEqual(['D1', 'b1', 'b2', expect.any(String), 'b3']);
    expect(new Set(identifiers(split)).size).toBe(5);
  });

  it('still creates no second empty paragraph on Enter outside a list', () => {
    // Uncited on purpose. CNT-023 - "empty blocks used for vertical spacing must not be
    // representable" - is held by the content model and demonstrated where the rule lives; this
    // body is a regression guard that widening Enter into a chain did not lose the answer the last
    // link already gave.
    const state = stateOf(documentOf(paragraph('b1', 'Unbox'), paragraph('b2', '')), 'b2');
    const { handled, next } = press(state, 'Enter');
    expect(handled).toBe(true);
    expect(shapeOf(next.doc)).toEqual(['doc', ['paragraph', 'Unbox'], 'paragraph']);
  });
});

describe('nesting an item and lifting it back', () => {
  it('nests an item under the item above it, to six levels and past them', () => {
    const doc = documentOf(
      list('L1', 'unordered', [
        item(paragraph('b1', 'One')),
        item(paragraph('b2', 'Two')),
        item(paragraph('b3', 'Three')),
        item(paragraph('b4', 'Four')),
        item(paragraph('b5', 'Five')),
        item(paragraph('b6', 'Six')),
        item(paragraph('b7', 'Seven')),
      ]),
    );
    // Uncited on purpose. CNT-118 asks that a list nests to at least six levels in every kind and
    // in any mixture of kinds; this body is one kind. The mixture is beside it, and the citation
    // lives on the round trip in `mapping.test.ts`, whose body does both.
    //
    // A staircase, because that is the gesture: an item sinks under the item above it, so the
    // second item takes one Tab, the third takes two, and the seventh takes six. Tabbing the same
    // item twice does nothing - it is then the first item of its own sublist, with nothing above it
    // to sink under.
    let state = stateOf(doc, 'b2');
    for (let level = 1; level <= 6; level += 1) {
      state = moveTo(state, `b${level + 1}`);
      for (let again = 0; again < level; again += 1) {
        const pressed = press(state, 'Tab');
        expect(pressed.handled).toBe(true);
        state = pressed.next;
      }
    }
    const depthOfDeepestList = (node: Node, depth = 0): number => {
      let found = depth;
      node.forEach((child) => {
        const below = depthOfDeepestList(child, child.type.name === 'list' ? depth + 1 : depth);
        if (below > found) found = below;
      });
      return found;
    };
    expect(depthOfDeepestList(state.doc)).toBe(7);
    expect(() => stored(state.doc)).not.toThrow();
  });

  it('nests a definition item and lifts it back, in a mixture of kinds', () => {
    const doc = documentOf(
      list('L1', 'unordered', [
        item(paragraph('b1', 'One')),
        item(
          definitionList(
            'D1',
            definitionItem('Creep', paragraph('b2', 'Slow strain.')),
            definitionItem('Yield', paragraph('b3', 'The greatest stress.')),
          ),
        ),
      ]),
    );
    const state = stateOf(doc, 'b3');
    const nested = press(state, 'Tab');
    expect(nested.handled).toBe(true);
    expect(termsIn(nested.next.doc)).toEqual(['Creep', 'Yield']);
    expect(shapeOf(nested.next.doc)).toEqual([
      'doc',
      [
        'list',
        ['listItem', ['paragraph', 'One']],
        [
          'listItem',
          [
            'definitionList',
            [
              'definitionItem',
              ['term', 'Creep'],
              ['paragraph', 'Slow strain.'],
              [
                'definitionList',
                ['definitionItem', ['term', 'Yield'], ['paragraph', 'The greatest stress.']],
              ],
            ],
          ],
        ],
      ],
    ]);
    expect(() => stored(nested.next.doc)).not.toThrow();
    const lifted = pressShiftTab(nested.next);
    expect(lifted.handled).toBe(true);
    expect(shapeOf(lifted.next.doc)).toEqual(shapeOf(state.doc));
    expect(() => stored(lifted.next.doc)).not.toThrow();
  });

  it('keeps the kind and the numbering the author set when an item is nested under another', () => {
    // `sinkListItem` builds the new sublist with `parent.type.create(null, ...)`, so an item of a
    // roman list sinks into a bulleted one unless the command answers for it.
    const doc = documentOf(
      list('L1', 'ordered', [item(paragraph('b1', 'One')), item(paragraph('b2', 'Two'))], {
        start: 7,
        format: 'roman',
      }),
    );
    const { handled, next } = run(stateOf(doc, 'b2'), blockCommand('nestItem', ids()));
    expect(handled).toBe(true);
    expect(listAt(next)).toEqual({ id: 'n1', kind: 'ordered', start: null, format: 'roman' });
    expect(next.doc.firstChild!.attrs).toMatchObject({
      kind: 'ordered',
      start: 7,
      format: 'roman',
    });
    // The sublist is a list of its own and is named as one.
    expect(new Set(identifiers(next.doc)).size).toBe(4);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('joins the sublist that is already there rather than making a second one', () => {
    const doc = documentOf(
      list('L1', 'unordered', [
        item(
          paragraph('b1', 'One'),
          list('L2', 'ordered', [item(paragraph('b2', 'Two'))], { start: 4, format: 'alphabetic' }),
        ),
        item(paragraph('b3', 'Three')),
      ]),
    );
    const { handled, next } = run(stateOf(doc, 'b3'), blockCommand('nestItem', ids()));
    expect(handled).toBe(true);
    // The sublist the author already numbered keeps its own start, numbering and identifier.
    expect(listAt(next)).toEqual({ id: 'L2', kind: 'ordered', start: 4, format: 'alphabetic' });
    expect(identifiers(next.doc)).toEqual(['L1', 'b1', 'L2', 'b2', 'b3']);
  });

  it('leaves a sublist that was already there alone, even one carrying no identifier yet', () => {
    // Telling the new sublist from one that was already there by its identifier being null is sound
    // only while every list in a live document carries one, which nothing pins. The question the
    // command asks is about the document it was handed: does the item above this one already end
    // with a sublist?
    const doc = documentOf(
      list('L1', 'unordered', [
        item(
          paragraph('b1', 'One'),
          editorSchema.node('list', { id: null, kind: 'ordered', start: 4, format: 'alphabetic' }, [
            item(paragraph('b2', 'Two')),
          ]),
        ),
        item(paragraph('b3', 'Three')),
      ]),
    );
    const { handled, next } = run(stateOf(doc, 'b3'), blockCommand('nestItem', ids()));
    expect(handled).toBe(true);
    // The sublist that was already there, keeping its start and its numbering - and named `n1` by
    // the identity plugin in the same cycle, because it went in carrying no identifier. That is
    // what makes `listAt`'s `id` safe for a renderer to key on: what reaches one has been applied.
    expect(listAt(next)).toEqual({ id: 'n1', kind: 'ordered', start: 4, format: 'alphabetic' });
  });

  it('names the sublist it makes in its own transaction, before any plugin has run', () => {
    const doc = documentOf(
      list('L1', 'ordered', [item(paragraph('b1', 'One')), item(paragraph('b2', 'Two'))], {
        start: 7,
        format: 'roman',
      }),
    );
    const made = transactionOf(stateOf(doc, 'b2'), blockCommand('nestItem', ids())).doc;
    expect(identifiers(made)).toEqual(['L1', 'b1', expect.any(String), 'b2']);
    expect(new Set(identifiers(made)).size).toBe(4);
  });

  it('declines to lift a definition item that is already at the top level of its list', () => {
    // A counted item lifts out of its list because its blocks are blocks wherever they stand. An
    // item of a definition list opens with a term, which is inline content no block sequence holds,
    // so there is nowhere for the item to go and lifting it would discard the word the author
    // wrote. Enter in an item with nothing written in it still leaves the list, because there is
    // then nothing to discard.
    const doc = documentOf(
      definitionList('D1', definitionItem('Creep', paragraph('b1', 'Slow strain.'))),
    );
    expect(blockCommand('liftItem', ids())(stateOf(doc, 'b1'), undefined)).toBe(false);
  });

  it('lets Tab move focus on when the cursor is not in a list', () => {
    // A Tab that is always swallowed is a keyboard trap, so the command declines outside a list and
    // the key reaches the browser (CNT-077).
    const state = stateOf(documentOf(paragraph('b1', 'alpha')), 'b1');
    expect(blockCommand('nestItem', ids())(state, undefined)).toBe(false);
    expect(blockCommand('liftItem', ids())(state, undefined)).toBe(false);
    expect(press(state, 'Tab').handled).toBe(false);
    expect(pressShiftTab(state).handled).toBe(false);
  });

  it('declines to nest the first item of a list, which has nothing to nest under', () => {
    const doc = documentOf(list('L1', 'unordered', [item(paragraph('b1', 'One'))]));
    expect(blockCommand('nestItem', ids())(stateOf(doc, 'b1'), undefined)).toBe(false);
  });
});

describe('the depth the model admits, which Tab may not carry an item past (issue #159)', () => {
  /**
   * A list nested `levels` deep, whose innermost list has two items - so the cursor can stand in
   * the second and Tab has something to nest it under.
   */
  const nested = (levels: number): Node => {
    let built: Node = list(`L${levels}`, 'unordered', [
      item(paragraph('b1', 'One')),
      item(paragraph('b2', 'Two')),
    ]);
    for (let level = levels - 1; level >= 1; level -= 1) {
      built = list(`L${level}`, 'unordered', [item(built)]);
    }
    return built;
  };

  it('pins the depth against the model itself, rather than trusting a number somebody chose', () => {
    // MOST_NESTED_LEVELS is a measurement, not a preference: `fromEditor` parses through
    // `parseContentDocument`, whose nesting limit is counted in JSON depth, and a list level costs
    // four of those. This is the arithmetic, done by running it - so a change to either the limit or
    // the mapping's shape fails here rather than at an author's keyboard.
    expect(() => stored(documentOf(nested(MOST_NESTED_LEVELS)))).not.toThrow();
    expect(() => stored(documentOf(nested(MOST_NESTED_LEVELS + 1)))).toThrow(
      /nested more than 128 deep/,
    );
  });

  it('declines to nest an item when the list it would make is deeper than the model admits', () => {
    // The gesture that gets an author here is Tab, thirty times over, and until this rule the
    // thirty-first took the key, built the level, and left the editor holding a document
    // `fromEditor` throws on - so the save path threw instead of saving, for the rest of the
    // session, with everything typed after it lost. Refused when it is asked, in this family's own
    // doctrine: the command declines, the toolbar reads the decline and says **Nest item** is
    // unavailable, and Tab hands the key back to the browser rather than swallowing it.
    const state = stateOf(documentOf(nested(MOST_NESTED_LEVELS)), 'b2');
    expect(blockCommand('nestItem', ids())(state, undefined)).toBe(false);
    const { handled, next } = run(state, blockCommand('nestItem', ids()));
    expect(handled).toBe(false);
    expect(next).toBe(state);
    expect(press(state, 'Tab').handled).toBe(false);
    expect(() => stored(state.doc)).not.toThrow();
  });

  it('nests the item one level short of the limit, and what it makes is storable', () => {
    // The other side of the boundary, so the rule is a cliff at a measured place rather than a
    // refusal that has quietly swallowed a level of headroom.
    const state = stateOf(documentOf(nested(MOST_NESTED_LEVELS - 1)), 'b2');
    const { handled, next } = run(state, blockCommand('nestItem', ids()));
    expect(handled).toBe(true);
    expect(() => stored(next.doc)).not.toThrow();
    expect(() => stored(state.doc)).not.toThrow();
  });

  it('declines to make a definition list of a paragraph already at the deepest level admitted', () => {
    // Tab is not the only gesture that builds a level. **Definition list** over a paragraph inside
    // the innermost item wraps it in a list of its own, and at the limit that is the thirty-first -
    // measured, not reasoned: before this rule the command took the press and `fromEditor` threw on
    // what came back. The same answer as Tab's, because it is the same mistake.
    const state = stateOf(documentOf(nested(MOST_NESTED_LEVELS)), 'b2');
    expect(blockCommand('definitionList', ids())(state, undefined)).toBe(false);
    expect(run(state, blockCommand('definitionList', ids())).handled).toBe(false);

    // One level short it is taken, and what it makes is storable.
    const room = stateOf(documentOf(nested(MOST_NESTED_LEVELS - 1)), 'b2');
    const { handled, next } = run(room, blockCommand('definitionList', ids()));
    expect(handled).toBe(true);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('declines to make a counted list of a paragraph already at the deepest level admitted', () => {
    // **Bulleted list** and **Numbered list** toggle inside a counted list, so they build no level
    // there - but inside a **definition** item they wrap, which is a real thing to want and one
    // level more. The fixture is the shape that reaches it: counted lists down to the last level,
    // and a definition list as that level.
    const deepest = (levels: number) => {
      let built: Node = definitionList(
        `D${levels}`,
        definitionItem('Creep', paragraph('b2', 'Slow strain.')),
      );
      for (let level = levels - 1; level >= 1; level -= 1) {
        built = list(`L${level}`, 'unordered', [item(built)]);
      }
      return built;
    };
    expect(() => stored(documentOf(deepest(MOST_NESTED_LEVELS)))).not.toThrow();

    const state = stateOf(documentOf(deepest(MOST_NESTED_LEVELS)), 'b2');
    expect(blockCommand('bulletedList', ids())(state, undefined)).toBe(false);
    expect(run(state, blockCommand('bulletedList', ids())).handled).toBe(false);

    const room = stateOf(documentOf(deepest(MOST_NESTED_LEVELS - 1)), 'b2');
    const { handled, next } = run(room, blockCommand('numberedList', ids()));
    expect(handled).toBe(true);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('nests an item elsewhere in a document that already holds a list at the limit', () => {
    // The rule is about the document the gesture would make, so a deep list in one part of a
    // component must not freeze Tab in another: the deepest chain is unchanged by a nesting that
    // happens somewhere shallower.
    const doc = documentOf(
      nested(MOST_NESTED_LEVELS),
      list('S1', 'unordered', [item(paragraph('s1', 'One')), item(paragraph('s2', 'Two'))]),
    );
    const { handled, next } = run(stateOf(doc, 's2'), blockCommand('nestItem', ids()));
    expect(handled).toBe(true);
    expect(() => stored(next.doc)).not.toThrow();
  });
});

describe('what a list panel reads and changes', () => {
  it('reads the innermost list the cursor is in', () => {
    const doc = documentOf(
      list(
        'L1',
        'ordered',
        [item(paragraph('b1', 'One'), list('L2', 'unordered', [item(paragraph('b2', 'Two'))]))],
        { start: 7, format: 'roman' },
      ),
    );
    // The identifier is which list this is, so a renderer holding a value the author typed can
    // tell one list from another - two lists with neither a start nor a numbering are otherwise
    // the same answer twice.
    expect(listAt(stateOf(doc, 'b2'))).toEqual({
      id: 'L2',
      kind: 'unordered',
      start: null,
      format: null,
    });
    expect(listAt(stateOf(doc, 'b1'))).toEqual({
      id: 'L1',
      kind: 'ordered',
      start: 7,
      format: 'roman',
    });
    const definition = documentOf(
      definitionList('D1', definitionItem('Creep', paragraph('b1', 'Slow strain.'))),
    );
    expect(listAt(stateOf(definition, 'b1'))).toEqual({
      id: 'D1',
      kind: 'definition',
      start: null,
      format: null,
    });
    expect(listAt(stateOf(documentOf(paragraph('b1', 'alpha')), 'b1'))).toBeNull();
  });

  it('refuses a start of zero on a lettered or roman list, and allows it on a decimal one', () => {
    // A zeroth item is a convention decimal has and letters and roman numerals do not.
    const inAList = () =>
      stateOf(documentOf(list('L1', 'ordered', [item(paragraph('b1', 'One'))])), 'b1');
    expect(setListAttributes({ format: 'roman', start: 0 })(inAList(), undefined)).toBe(false);
    expect(setListAttributes({ format: 'alphabetic', start: 0 })(inAList(), undefined)).toBe(false);
    expect(setListAttributes({ format: 'decimal', start: 0 })(inAList(), undefined)).toBe(true);
  });

  it('refuses a numbering a list cannot take with the start it already has', () => {
    // The panel changes one field at a time, so a command that judged only what it was handed would
    // pass a roman numbering onto a list already starting at 0 and store what publishing refuses.
    const inAListStartingAtZero = () =>
      stateOf(
        documentOf(
          list('L1', 'ordered', [item(paragraph('b1', 'One'))], { start: 0, format: 'decimal' }),
        ),
        'b1',
      );
    expect(setListAttributes({ format: 'roman' })(inAListStartingAtZero(), undefined)).toBe(false);
    const { handled, next } = run(inAListStartingAtZero(), setListAttributes({ start: 3 }));
    expect(handled).toBe(true);
    expect(listAt(next)).toEqual({ id: 'L1', kind: 'ordered', start: 3, format: 'decimal' });
  });

  it('clears the start and the numbering when a list stops being a numbered one', () => {
    const doc = documentOf(
      list('L1', 'ordered', [item(paragraph('b1', 'One'))], { start: 0, format: 'decimal' }),
    );
    const { handled, next } = run(stateOf(doc, 'b1'), setListAttributes({ kind: 'unordered' }));
    expect(handled).toBe(true);
    expect(listAt(next)).toEqual({ id: 'L1', kind: 'unordered', start: null, format: null });
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('changes nothing, and leaves no undo step, when nothing in fact changes', () => {
    const state = stateOf(
      documentOf(list('L1', 'ordered', [item(paragraph('b1', 'One'))], { start: 3 })),
      'b1',
    );
    let dispatched = 0;
    const count = () => {
      dispatched += 1;
    };
    expect(setListAttributes({})(state, count)).toBe(true);
    expect(setListAttributes({ kind: 'ordered' })(state, count)).toBe(true);
    expect(setListAttributes({ start: 3 })(state, count)).toBe(true);
    // An undo step for a field the author set to what it already said is a press of Undo that
    // appears to do nothing.
    expect(dispatched).toBe(0);
    expect(setListAttributes({ start: 4 })(state, count)).toBe(true);
    expect(dispatched).toBe(1);
  });

  it('refuses a start that is not a whole number at all, and a numbering nobody has heard of', () => {
    const inAList = () =>
      stateOf(documentOf(list('L1', 'ordered', [item(paragraph('b1', 'One'))])), 'b1');
    expect(setListAttributes({ start: -1 })(inAList(), undefined)).toBe(false);
    expect(setListAttributes({ start: 2.5 })(inAList(), undefined)).toBe(false);
    expect(setListAttributes({ start: Number.NaN })(inAList(), undefined)).toBe(false);
    expect(setListAttributes({ format: 'bullets' })(inAList(), undefined)).toBe(false);
    expect(setListAttributes({ kind: 'definition' })(inAList(), undefined)).toBe(false);
  });

  it('refuses a start or a numbering on a list that is not a numbered one', () => {
    const doc = documentOf(list('L1', 'unordered', [item(paragraph('b1', 'One'))]));
    expect(setListAttributes({ start: 3 })(stateOf(doc, 'b1'), undefined)).toBe(false);
    const definition = documentOf(
      definitionList('D1', definitionItem('Creep', paragraph('b1', 'Slow strain.'))),
    );
    expect(setListAttributes({ start: 3 })(stateOf(definition, 'b1'), undefined)).toBe(false);
    expect(setListAttributes({ kind: 'ordered' })(stateOf(definition, 'b1'), undefined)).toBe(
      false,
    );
  });
});

describe('a delete key that would deepen a list past what the model admits (issue #160)', () => {
  /**
   * Counted lists down to the level below, and a **definition list of two items** as the last one -
   * which is the shape the route needs. Two `definitionItem`s cannot merge, because the content is
   * `term block+`, so `deleteBarrier` wraps the following item in a new definition list inside the
   * previous one rather than joining them: one more level, from a key nobody thinks of as one that
   * builds anything.
   */
  const definitionAt = (levels: number): Node => {
    let built: Node = definitionList(
      'D1',
      definitionItem('Creep', paragraph('b1', 'Slow strain.')),
      definitionItem('Fatigue', paragraph('b2', 'Failure under cycles.')),
    );
    for (let level = levels - 1; level >= 1; level -= 1) {
      built = list(`L${level}`, 'unordered', [item(built)]);
    }
    return built;
  };

  /** The position just inside the nth term, counting from one. */
  const termAt = (doc: Node, nth: number): number => {
    let seen = 0;
    let at = -1;
    doc.descendants((node, pos) => {
      if (at !== -1) return false;
      if (node.type.name === 'term') {
        seen += 1;
        if (seen === nth) at = pos + 1;
      }
      return true;
    });
    if (at === -1) throw new Error(`no term ${nth} in this document`);
    return at;
  };

  /** The position at the end of the textblock carrying that identifier. */
  const endOf = (doc: Node, id: string): number => {
    let at = -1;
    doc.descendants((node, pos) => {
      if (at !== -1) return false;
      if (node.attrs.id === id) at = pos + 1 + node.content.size;
      return true;
    });
    if (at === -1) throw new Error(`no ${id} in this document`);
    return at;
  };

  const caretAt = (doc: Node, pos: number): EditorState => {
    const state = createEditorState({ doc, newIdentifier: counter() });
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  };

  it('takes Backspace at the start of a term rather than wrapping the item a level deeper', () => {
    const doc = documentOf(definitionAt(MOST_NESTED_LEVELS));
    expect(() => stored(doc)).not.toThrow();
    const state = caretAt(doc, termAt(doc, 2));
    const { handled, next } = press(state, 'Backspace');
    // Since issue #160 the two items join, as paragraphs do, and a join makes nothing deeper - so
    // at the limit the key does what it does anywhere, and the store takes what it makes.
    expect(handled).toBe(true);
    expect(() => stored(next.doc)).not.toThrow();
    expect(next.doc.eq(state.doc)).toBe(false);
  });

  it('takes Delete at the end of the item before it, which is the same barrier from the other side', () => {
    const doc = documentOf(definitionAt(MOST_NESTED_LEVELS));
    const state = caretAt(doc, endOf(doc, 'b1'));
    const { handled, next } = press(state, 'Delete');
    expect(handled).toBe(true);
    expect(() => stored(next.doc)).not.toThrow();
    expect(next.doc.eq(state.doc)).toBe(false);
  });

  it('lets both keys through one level short of the limit, where what they make is storable', () => {
    // The other side of the boundary. What they do there is the defect #160 is about and not this
    // rule's business; what matters here is that the guard has not swallowed a level of headroom.
    const doc = documentOf(definitionAt(MOST_NESTED_LEVELS - 1));
    const back = press(caretAt(doc, termAt(doc, 2)), 'Backspace');
    expect(back.handled).toBe(true);
    expect(back.next.doc.eq(doc)).toBe(false);
    expect(() => stored(back.next.doc)).not.toThrow();

    const forward = press(caretAt(doc, endOf(doc, 'b1')), 'Delete');
    expect(forward.handled).toBe(true);
    expect(forward.next.doc.eq(doc)).toBe(false);
    expect(() => stored(forward.next.doc)).not.toThrow();
  });

  it('leaves an ordinary Backspace alone at the limit, so only the deepening press is taken', () => {
    // A Backspace that deletes a character is not handled by any keymap at all - every command in
    // the base chain declines and the browser does it, which ProseMirror reads back. A guard that
    // swallowed that would make the deepest list in a component unwritable.
    const doc = documentOf(definitionAt(MOST_NESTED_LEVELS));
    const state = caretAt(doc, termAt(doc, 2) + 1);
    const { handled, next } = press(state, 'Backspace');
    expect(handled).toBe(false);
    expect(next.doc.eq(state.doc)).toBe(true);
  });

  it('asks the view, so a caret the DOM calls the edge of its block is refused too', () => {
    // The probe passes the view through to the command, and this is the case that needs it: where
    // the view says the caret is at the start of its textblock and the document's own offset says
    // otherwise, a probe asking without the view answers a different question from the press - it
    // finds no join, declines to refuse, and `baseKeymap` then builds the level with the view in
    // hand. Deleting the view from the probe leaves every other test in this file green.
    const doc = documentOf(definitionAt(MOST_NESTED_LEVELS));
    const state = caretAt(doc, termAt(doc, 2) + 1);
    const { handled, next } = press(state, 'Backspace', true);
    expect(handled).toBe(true);
    expect(() => stored(next.doc)).not.toThrow();
    expect(next.doc.eq(state.doc)).toBe(true);
  });

  it('leaves both keys alone where no list is near the limit at all', () => {
    const doc = documentOf(
      definitionList(
        'D1',
        definitionItem('Creep', paragraph('b1', 'Slow strain.')),
        definitionItem('Fatigue', paragraph('b2', 'Failure under cycles.')),
      ),
    );
    const back = press(caretAt(doc, termAt(doc, 2)), 'Backspace');
    expect(back.handled).toBe(true);
    expect(back.next.doc.eq(doc)).toBe(false);
    expect(() => stored(back.next.doc)).not.toThrow();
  });
});

describe('quotations and preformatted text: the commands and the keys (editor 5)', () => {
  const pre = (id: string, text: string) =>
    editorSchema.node(
      'preformatted',
      { id, language: null },
      text === '' ? [] : [editorSchema.text(text)],
    );
  const attribution = (text = '') =>
    editorSchema.node('attribution', null, text === '' ? [] : [editorSchema.text(text)]);
  const quotation = (id: string, blocks: Node[], by = '') =>
    editorSchema.node('blockquote', { id }, [...blocks, attribution(by)]);

  /** A key with modifiers, through the real keymap chain, as `press` drives one without. */
  function chord(
    state: EditorState,
    key: string,
    modifiers: { ctrl?: boolean; shift?: boolean } = {},
  ): { handled: boolean; next: EditorState } {
    let next = state;
    const view = {
      get state() {
        return next;
      },
      dispatch: (tr: Transaction) => {
        next = next.apply(tr);
      },
      ...endOfTextblock(() => next),
    };
    const event = {
      key,
      keyCode: KEY_CODES[key] ?? 0,
      shiftKey: modifiers.shift ?? false,
      ctrlKey: modifiers.ctrl ?? false,
      altKey: false,
      metaKey: false,
    };
    for (const plugin of state.plugins) {
      const handler = plugin.props.handleKeyDown;
      if (handler === undefined) continue;
      if (handler.call(plugin, view as never, event as never)) return { handled: true, next };
    }
    return { handled: false, next };
  }

  /** The cursor at the end of the textblock carrying that identifier, or of the first of a type. */
  const atEndOf = (doc: Node, what: string) => {
    const state = createEditorState({ doc, newIdentifier: counter() });
    let end = -1;
    doc.descendants((node, pos) => {
      if (end === -1 && (node.attrs.id === what || node.type.name === what)) {
        end = pos + node.nodeSize - 1;
      }
    });
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
  };

  /** A selection from the start of the first block to the end of the last. */
  const across = (doc: Node, first: string, last: string) => {
    const state = createEditorState({ doc, newIdentifier: counter() });
    const end = atEndOf(doc, last).selection.from;
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(doc, first), end)),
    );
  };

  const inAList = (...blocks: Node[]) => list('L1', 'unordered', [item(...blocks)]);

  it('inserts a line break for Enter in preformatted text, in a list or out of one, and splits nothing', () => {
    const top = chord(atEndOf(documentOf(pre('p1', 'a')), 'p1'), 'Enter');
    expect(top.handled).toBe(true);
    expect(shapeOf(top.next.doc)).toEqual(['doc', ['preformatted', 'a\n']]);
    const nested = chord(atEndOf(documentOf(inAList(pre('p1', 'a'))), 'p1'), 'Enter');
    expect(shapeOf(nested.next.doc)).toEqual([
      'doc',
      ['list', ['listItem', ['preformatted', 'a\n']]],
    ]);
  });

  it('inserts a tab for Tab in preformatted text inside a list item, and nests nothing', () => {
    const doc = documentOf(
      list('L1', 'unordered', [item(paragraph('b1', 'x')), item(pre('p1', 'a'))]),
    );
    const pressed = chord(atEndOf(doc, 'p1'), 'Tab');
    expect(pressed.handled).toBe(true);
    expect(shapeOf(pressed.next.doc)).toEqual([
      'doc',
      ['list', ['listItem', ['paragraph', 'x']], ['listItem', ['preformatted', 'a\t']]],
    ]);
    // Outside a list and outside code Tab is still the browser's, so focus can move on (CNT-077).
    expect(chord(atEndOf(documentOf(paragraph('b1', 'x')), 'b1'), 'Tab').handled).toBe(false);
  });

  it('never takes Shift-Tab in preformatted text, so focus can always leave backwards, even in a nested item', () => {
    const doc = documentOf(
      list('L1', 'unordered', [
        item(paragraph('b1', 'x'), list('L2', 'unordered', [item(pre('p1', 'a'))])),
      ]),
    );
    const pressed = chord(atEndOf(doc, 'p1'), 'Tab', { shift: true });
    expect(pressed.handled).toBe(false);
    expect(pressed.next.doc.eq(doc)).toBe(true);
  });

  it('leaves preformatted text for a paragraph after it on Mod-Enter', () => {
    const pressed = chord(atEndOf(documentOf(pre('p1', 'a')), 'p1'), 'Enter', { ctrl: true });
    expect(pressed.handled).toBe(true);
    expect(shapeOf(pressed.next.doc)).toEqual(['doc', ['preformatted', 'a'], 'paragraph']);
    expect(pressed.next.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('leaves a quotation for a paragraph after it on Enter in its attribution', () => {
    const doc = documentOf(quotation('q1', [paragraph('b1', 'Words.')], 'Ada'));
    const pressed = chord(atEndOf(doc, 'attribution'), 'Enter');
    expect(pressed.handled).toBe(true);
    expect(shapeOf(pressed.next.doc)).toEqual([
      'doc',
      ['blockquote', ['paragraph', 'Words.'], ['attribution', 'Ada']],
      'paragraph',
    ]);
    expect(pressed.next.selection.$from.parent.type.name).toBe('paragraph');
    expect(pressed.next.selection.$from.depth).toBe(1);
  });

  it("leaves a figure for a paragraph after it on Enter in its caption, even as the component's last block", () => {
    const caption = editorSchema.node('figureCaption', null, [editorSchema.text('Shapes')]);
    const figure = editorSchema.node(
      'figure',
      {
        id: 'f1',
        asset: '00000000-0000-4000-8000-00000000a551',
        alternative: { kind: 'decorative' },
      },
      [caption],
    );
    const pressed = chord(
      atEndOf(documentOf(paragraph('p1', 'a'), figure), 'figureCaption'),
      'Enter',
    );
    expect(pressed.handled).toBe(true);
    expect(shapeOf(pressed.next.doc)).toEqual([
      'doc',
      ['paragraph', 'a'],
      ['figure', ['figureCaption', 'Shapes']],
      'paragraph',
    ]);
    expect(pressed.next.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('moves an empty last paragraph out of a quotation on Enter, and does nothing in its only one', () => {
    const doc = documentOf(quotation('q1', [paragraph('b1', 'Words.'), paragraph('b2', '')]));
    const pressed = chord(stateOf(doc, 'b2'), 'Enter');
    expect(pressed.handled).toBe(true);
    expect(shapeOf(pressed.next.doc)).toEqual([
      'doc',
      ['blockquote', ['paragraph', 'Words.'], 'attribution'],
      'paragraph',
    ]);
    const only = documentOf(quotation('q1', [paragraph('b1', '')]));
    const stays = chord(stateOf(only, 'b1'), 'Enter');
    expect(stays.next.doc.eq(only)).toBe(true);
  });

  it('makes one preformatted block of several paragraphs, a line each, and three paragraphs of three lines', () => {
    const doc = documentOf(paragraph('b1', 'a'), paragraph('b2', 'b'), paragraph('b3', 'c'));
    const made = run(across(doc, 'b1', 'b3'), blockCommand('preformatted', counter()));
    expect(made.handled).toBe(true);
    expect(shapeOf(made.next.doc)).toEqual(['doc', ['preformatted', 'a\nb\nc']]);
    const back = run(made.next, blockCommand('preformatted', counter()));
    expect(shapeOf(back.next.doc)).toEqual([
      'doc',
      ['paragraph', 'a'],
      ['paragraph', 'b'],
      ['paragraph', 'c'],
    ]);
    expect(() => stored(back.next.doc)).not.toThrow();
  });

  it('declines to make preformatted a paragraph holding an image, which is content and not formatting', () => {
    // Found by the final review of figures 4: preformatted text holds text alone, and the image was
    // dropped with nothing said.
    const image = editorSchema.nodes.image!.create({
      asset: '00000000-0000-4000-8000-00000000a551',
      alternative: { kind: 'decorative' },
    });
    const doc = documentOf(
      paragraph('b1', 'a'),
      editorSchema.node('paragraph', { id: 'b2', style: 'body' }, [
        editorSchema.text('ab'),
        image,
        editorSchema.text('cd'),
      ]),
    );
    expect(blockCommand('preformatted', counter())(across(doc, 'b1', 'b2'))).toBe(false);
    expect(blockCommand('preformatted', counter())(stateOf(doc, 'b2'))).toBe(false);
  });

  it('drops the marks of a paragraph it makes preformatted, and one undo brings them back', () => {
    const strong = editorSchema.marks.strong!.create({ id: 'm1' });
    const link = editorSchema.marks.hyperlink!.create({
      id: 'm2',
      href: 'https://example.com/',
      title: null,
    });
    const doc = documentOf(
      editorSchema.node('paragraph', { id: 'b1', style: 'body' }, [
        editorSchema.text('Bold', [strong]),
        editorSchema.text(' and a link', [link]),
      ]),
    );
    const state = stateOf(doc, 'b1');
    // Offered, not declined: the toolbar shows it over formatted text (Ken, at plan review).
    expect(blockCommand('preformatted', counter())(state)).toBe(true);
    const made = run(state, blockCommand('preformatted', counter()));
    expect(shapeOf(made.next.doc)).toEqual(['doc', ['preformatted', 'Bold and a link']]);
    const undone = run(made.next, undo);
    expect(undone.handled).toBe(true);
    // The text, both marks and the marks' identifiers come back exactly, and so does the paragraph's
    // own identifier: what an undo puts back keeps one no other node holds (cross-references 1, R7).
    const back = undone.next.doc.firstChild!;
    expect(back.type.name).toBe('paragraph');
    expect(back.attrs.id).toBe('b1');
    expect(back.content.eq(doc.firstChild!.content)).toBe(true);
    expect(() => stored(undone.next.doc)).not.toThrow();
  });

  it('wraps blocks in a quotation with an empty attribution, and unwraps one keeping its attribution', () => {
    const doc = documentOf(paragraph('b1', 'a'), paragraph('b2', 'b'));
    const wrapped = run(across(doc, 'b1', 'b2'), blockCommand('quotation', counter()));
    expect(shapeOf(wrapped.next.doc)).toEqual([
      'doc',
      ['blockquote', ['paragraph', 'a'], ['paragraph', 'b'], 'attribution'],
    ]);
    const attributed = documentOf(quotation('q1', [paragraph('b1', 'a')], 'Ada'));
    const unwrapped = run(stateOf(attributed, 'b1'), blockCommand('quotation', counter()));
    expect(shapeOf(unwrapped.next.doc)).toEqual(['doc', ['paragraph', 'a'], ['paragraph', 'Ada']]);
    expect(() => stored(unwrapped.next.doc)).not.toThrow();
  });

  it('declines a quotation that would stand deeper than the model admits', () => {
    // A paragraph at the bottom of a chain of lists: at the limit a quotation round it would be the
    // level past it, and one short of the limit it is the last level there is room for.
    const chain = (levels: number): Node => {
      let built: Node = list(`L${levels}`, 'unordered', [item(paragraph('b2', 'x'))]);
      for (let level = levels - 1; level >= 1; level -= 1) {
        built = list(`L${level}`, 'unordered', [item(built)]);
      }
      return built;
    };
    const at = (levels: number) => stateOf(documentOf(chain(levels)), 'b2');
    expect(blockCommand('quotation', counter())(at(MOST_NESTED_LEVELS))).toBe(false);
    // A quotation counts two levels, so it needs two of room (final review, finding 3).
    expect(blockCommand('quotation', counter())(at(MOST_NESTED_LEVELS - 1))).toBe(false);
    const room = run(at(MOST_NESTED_LEVELS - 2), blockCommand('quotation', counter()));
    expect(room.handled).toBe(true);
    expect(() => stored(room.next.doc)).not.toThrow();
  });

  it('names the quotation and the preformatted block the commands make, uniquely in the component', () => {
    const doc = documentOf(paragraph('b1', 'a'), paragraph('b2', 'b'));
    const quoted = transactionOf(stateOf(doc, 'b1'), blockCommand('quotation', counter()));
    const code = transactionOf(stateOf(doc, 'b2'), blockCommand('preformatted', counter()));
    for (const made of [quoted.doc, code.doc]) {
      const found = identifiers(made);
      expect(found).not.toContain(null);
      expect(new Set(found).size).toBe(found.length);
    }
  });

  it('stops a chain of quotations at fifteen, the most the engine sets inside one another', () => {
    // The one route that deepens a chain: a selection from a paragraph outside into the quotation
    // after it, which the command wraps together, one level deeper. Inside a quotation it unwraps.
    const chainOf = (levels: number) => {
      let chain: Node = paragraph('b2', 'deep');
      for (let level = levels; level >= 1; level -= 1) chain = quotation(`q${level}`, [chain]);
      return documentOf(paragraph('b1', 'before'), chain);
    };
    const wrapping = (levels: number) => {
      const doc = chainOf(levels);
      const state = createEditorState({ doc, newIdentifier: counter() });
      return state.apply(
        state.tr.setSelection(
          TextSelection.create(state.doc, inside(doc, 'b1'), inside(doc, 'b2')),
        ),
      );
    };
    const room = run(wrapping(14), blockCommand('quotation', counter()));
    expect(room.handled).toBe(true);
    expect(() => stored(room.next.doc)).not.toThrow();
    expect(blockCommand('quotation', counter())(wrapping(15))).toBe(false);
  });

  it('makes preformatted text of a paragraph holding a second spelling of a line break, and it saves', () => {
    const doc = documentOf(paragraph('b1', 'a\u{2028}b\u{D}\u{A}c\u{1B}d'));
    const made = run(stateOf(doc, 'b1'), blockCommand('preformatted', counter()));
    expect(shapeOf(made.next.doc)).toEqual(['doc', ['preformatted', 'a\nb\ncd']]);
    expect(() => stored(made.next.doc)).not.toThrow();
  });

  it('declines a definition list in an attribution or preformatted text, rather than throwing', () => {
    const quoted = documentOf(quotation('q1', [paragraph('b1', 'a')], 'Ada'));
    const inAttribution = atEndOf(quoted, 'attribution');
    expect(blockCommand('definitionList', counter())(inAttribution)).toBe(false);
    expect(() => run(inAttribution, blockCommand('definitionList', counter()))).not.toThrow();
    expect(
      blockCommand('definitionList', counter())(atEndOf(documentOf(pre('p1', 'x')), 'p1')),
    ).toBe(false);
  });

  it('splits a quotation paragraph into two paragraphs on Enter, at its end and at its start', () => {
    const doc = documentOf(quotation('q1', [paragraph('b1', 'Words.')], 'Ada'));
    const atEnd = chord(atEndOf(doc, 'b1'), 'Enter');
    expect(atEnd.handled).toBe(true);
    expect(shapeOf(atEnd.next.doc)).toEqual([
      'doc',
      ['blockquote', ['paragraph', 'Words.'], 'paragraph', ['attribution', 'Ada']],
    ]);
    const atStart = chord(stateOf(doc, 'b1'), 'Enter');
    expect(shapeOf(atStart.next.doc)).toEqual([
      'doc',
      ['blockquote', 'paragraph', ['paragraph', 'Words.'], ['attribution', 'Ada']],
    ]);
    expect(() => stored(atStart.next.doc)).not.toThrow();
  });

  it('keeps an attribution line when Backspace folds the attribution into the body', () => {
    const doc = documentOf(quotation('q1', [paragraph('b1', 'Words.')], 'Ada'));
    let start = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === 'attribution') start = pos + 1;
    });
    const state = createEditorState({ doc, newIdentifier: counter() });
    const at = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start)));
    const pressed = chord(at, 'Backspace');
    const quotedNow = pressed.next.doc.firstChild!;
    expect(quotedNow.lastChild!.type.name).toBe('attribution');
    expect(() => stored(pressed.next.doc)).not.toThrow();
  });

  it('draws no identifier when only asked whether it could run, as the toolbar asks on every render', () => {
    let drawn = 0;
    const counting = () => `q${(drawn += 1)}`;
    const state = stateOf(documentOf(paragraph('b1', 'a')), 'b1');
    expect(blockCommand('quotation', counting)(state)).toBe(true);
    expect(blockCommand('preformatted', counting)(state)).toBe(true);
    expect(drawn).toBe(0);
  });

  it('sets and clears a preformatted block label, and refuses one that is not a token', () => {
    const state = stateOf(documentOf(pre('p1', 'a')), 'p1');
    expect(preformattedAt(state)).toEqual({ language: null, pos: 0 });
    const labelled = run(state, setPreformattedLanguage('sql'));
    expect(preformattedAt(labelled.next)?.language).toBe('sql');
    expect(setPreformattedLanguage('a b')(labelled.next)).toBe(false);
    const cleared = run(labelled.next, setPreformattedLanguage(null));
    expect(preformattedAt(cleared.next)?.language).toBeNull();
    expect(preformattedAt(stateOf(documentOf(paragraph('b1', 'x')), 'b1'))).toBeNull();
  });
});

describe('undo, and gestures over a range, never leave the author stuck (issue #166)', () => {
  it('takes a definition list back off with one undo', () => {
    const state = stateOf(documentOf(paragraph('b1', 'The greatest stress.')), 'b1');
    const { next } = run(state, blockCommand('definitionList', ids()));
    let undone = next;
    undo(next, (tr) => (undone = next.apply(tr)));
    expect(shapeOf(undone.doc)).toEqual(['doc', ['paragraph', 'The greatest stress.']]);
  });

  it(
    'survives a thousand seeded runs of random gestures, undo and redo among them',
    () => {
      // The review that filed #166 found these by exactly this kind of run and kept no sequence, so the
      // run is the regression test: a seeded generator, so a failure names a seed that replays it.
      // Most of what it found was one cause - the identity plugin's renewals were recorded in the
      // history, and undoing one later mapped it onto whatever had come to stand there.
      const actions = [
        'bulletedList',
        'numberedList',
        'definitionList',
        'nestItem',
        'liftItem',
        'quotation',
        'preformatted',
        'table',
      ] as const;
      // And what the table panel does, which only means anything once a table is there.
      const tableActions = [
        'rowAbove',
        'rowBelow',
        'columnBefore',
        'columnAfter',
        'deleteRow',
        'deleteColumn',
        'merge',
        'split',
        'deleteTable',
      ] as const;
      for (let seed = 1; seed <= 1000; seed += 1) {
        let random = seed;
        const next = () => {
          random = (random * 1664525 + 1013904223) >>> 0;
          return random / 4294967296;
        };
        let state = createEditorState({
          doc: documentOf(
            paragraph('b1', 'Alpha'),
            // An inline image among the runs (figures 4), so every gesture meets one.
            editorSchema.node('paragraph', { id: 'b2', style: 'body' }, [
              editorSchema.text('Be'),
              editorSchema.nodes.image!.create({
                asset: '00000000-0000-4000-8000-00000000a551',
                alternative: { kind: 'decorative' },
              }),
              editorSchema.text('ta'),
            ]),
            paragraph('b3', 'Gamma'),
          ),
          newIdentifier: counter(),
        });
        const done: string[] = [];
        try {
          for (let step = 0; step < 16; step += 1) {
            const roll = next();
            const action = actions[Math.floor(next() * actions.length)]!;
            if (roll < 0.15) {
              const places: number[] = [];
              state.doc.descendants((node, pos) => {
                if (node.isTextblock) {
                  for (let at = 0; at <= node.content.size; at += 1) places.push(pos + 1 + at);
                }
              });
              const one = places[Math.floor(next() * places.length)]!;
              const two = next() < 0.3 ? places[Math.floor(next() * places.length)]! : one;
              state = state.apply(
                state.tr.setSelection(
                  TextSelection.create(state.doc, Math.min(one, two), Math.max(one, two)),
                ),
              );
              done.push(`select ${Math.min(one, two)}-${Math.max(one, two)}`);
            } else if (roll < 0.25) {
              state = state.apply(state.tr.insertText('z'));
              done.push('type');
            } else if (roll < 0.55) {
              const key = (['Enter', 'Tab', 'Backspace', 'Delete'] as const)[
                Math.floor(next() * 4)
              ]!;
              state = press(state, key).next;
              done.push(key);
            } else if (roll < 0.6) {
              state = pressShiftTab(state).next;
              done.push('Shift-Tab');
            } else if (roll < 0.8) {
              state = run(state, blockCommand(action, counter())).next;
              if (tableAt(state) !== null) {
                const extra = tableActions[Math.floor(next() * tableActions.length)]!;
                state = run(state, tableCommand(extra)).next;
                done.push(extra);
              }
              done.push(action);
            } else if (roll < 0.92) {
              undo(state, (tr) => (state = state.apply(tr)));
              done.push('undo');
            } else {
              redo(state, (tr) => (state = state.apply(tr)));
              done.push('redo');
            }
            stored(state.doc);
          }
        } catch (error) {
          throw new Error(`seed ${seed}, after ${done.join(', ')}: ${(error as Error).message}`, {
            cause: error,
          });
        }
      }
    },
    RANDOMISED_TEST_TIMEOUT_MS,
  );

  it('refuses a counted list over a range that begins in a definition inside a list, rather than throwing', () => {
    // Seed 3970 of the run above: `wrapInList` throws from inside `canSplit` over this range.
    const doc = documentOf(
      list('L1', 'unordered', [
        item(definitionList('D1', definitionItem('', paragraph('b1', 'Alpha')))),
        item(paragraph('b2', 'Beta')),
      ]),
    );
    const state = createEditorState({ doc, newIdentifier: counter() });
    const ranged = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, inside(doc, 'b1') + 3, inside(doc, 'b2') + 3),
      ),
    );
    for (const action of ['bulletedList', 'numberedList'] as const) {
      let outcome: ReturnType<typeof run> | undefined;
      expect(() => (outcome = run(ranged, blockCommand(action, ids())))).not.toThrow();
      expect(() => stored(outcome!.next.doc)).not.toThrow();
    }
  });

  it('presses Enter over a range from a quotation to the paragraph after it as a deletion and a split', () => {
    // Seed 9013: `splitBlock` throws over this range, from the start of the quotation's second
    // paragraph to the middle of the paragraph after the quotation.
    const doc = documentOf(
      editorSchema.node('blockquote', { id: 'q1' }, [
        paragraph('b1', 'Alph'),
        paragraph('b2', 'za'),
        editorSchema.node('attribution'),
      ]),
      paragraph('b3', 'Beta'),
    );
    const state = createEditorState({ doc, newIdentifier: counter() });
    const ranged = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, inside(doc, 'b2'), inside(doc, 'b3') + 2),
      ),
    );
    let outcome: ReturnType<typeof press> | undefined;
    expect(() => (outcome = press(ranged, 'Enter'))).not.toThrow();
    expect(outcome!.handled).toBe(true);
    expect(outcome!.next.doc.textContent).toBe('Alphta');
    expect(() => stored(outcome!.next.doc)).not.toThrow();
  });
});

describe('Backspace and Delete between two definition items (issue #160)', () => {
  const twoItems = (secondTerm: string) =>
    documentOf(
      definitionList(
        'D1',
        definitionItem('Creep', paragraph('b1', 'Slow strain.')),
        definitionItem(secondTerm, paragraph('b2', 'Under load.'), paragraph('b3', 'Over time.')),
      ),
    );

  const termStart = (doc: Node, index: number) => {
    let found = -1;
    let seen = 0;
    doc.descendants((node, pos) => {
      if (node.type.name === 'term') {
        if (seen === index) found = pos + 1;
        seen += 1;
      }
      return true;
    });
    return found;
  };

  const at = (doc: Node, pos: number) => {
    const state = createEditorState({ doc, newIdentifier: counter() });
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  };

  it('joins the second term onto the end of the first definition, and brings its body with it', () => {
    const doc = twoItems('Yield');
    const { handled, next } = press(at(doc, termStart(doc, 1)), 'Backspace');
    expect(handled).toBe(true);
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      [
        'definitionList',
        [
          'definitionItem',
          ['term', 'Creep'],
          ['paragraph', 'Slow strain.Yield'],
          ['paragraph', 'Under load.'],
          ['paragraph', 'Over time.'],
        ],
      ],
    ]);
    // Every block kept where it was: positions before the join map forward untouched.
    expect(identifiers(next.doc)).toEqual(expect.arrayContaining(['D1', 'b1', 'b2', 'b3']));
    expect(next.selection.from).toBe(inside(next.doc, 'b1') + 'Slow strain.'.length);
  });

  it('undoes an Enter in a definition: an empty term goes, and the text after it joins back', () => {
    const doc = twoItems('');
    const { next } = press(at(doc, termStart(doc, 1)), 'Backspace');
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      [
        'definitionList',
        [
          'definitionItem',
          ['term', 'Creep'],
          ['paragraph', 'Slow strain.Under load.'],
          ['paragraph', 'Over time.'],
        ],
      ],
    ]);
  });

  it('does the same from the end of the first definition with Delete', () => {
    const doc = twoItems('Yield');
    const end = inside(doc, 'b1') + 'Slow strain.'.length;
    const { handled, next } = press(at(doc, end), 'Delete');
    expect(handled).toBe(true);
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      [
        'definitionList',
        [
          'definitionItem',
          ['term', 'Creep'],
          ['paragraph', 'Slow strain.Yield'],
          ['paragraph', 'Under load.'],
          ['paragraph', 'Over time.'],
        ],
      ],
    ]);
  });

  it('never nests one item inside the other', () => {
    const nested = (doc: Node) => {
      let found = false;
      doc.descendants((node) => {
        if (node.type.name === 'definitionItem') {
          node.descendants((inner) => {
            if (inner.type.name === 'definitionList') found = true;
          });
        }
      });
      return found;
    };
    const doc = twoItems('Yield');
    expect(nested(press(at(doc, termStart(doc, 1)), 'Backspace').next.doc)).toBe(false);
    const end = inside(doc, 'b1') + 'Slow strain.'.length;
    expect(nested(press(at(doc, end), 'Delete').next.doc)).toBe(false);
  });
});

describe('Tab in a table (tables 1, ruling R5)', () => {
  const cellParagraph = (id: string) => paragraph(id, id);
  const twoByTwo = () =>
    documentOf(
      editorSchema.node('tableFigure', { id: 't1', headerRows: 0, headerColumns: 0 }, [
        editorSchema.node('tableCaption'),
        editorSchema.node('table', null, [
          editorSchema.node('table_row', null, [
            editorSchema.node('table_cell', null, [cellParagraph('a')]),
            editorSchema.node('table_cell', null, [cellParagraph('b')]),
          ]),
          editorSchema.node('table_row', null, [
            editorSchema.node('table_cell', null, [cellParagraph('c')]),
            editorSchema.node('table_cell', null, [
              list('L1', 'unordered', [item(paragraph('d', 'd'))]),
            ]),
          ]),
        ]),
      ]),
    );

  it('moves to the next cell, even from a list inside one, and lets the focus leave from the last', () => {
    const doc = twoByTwo();
    const first = press(stateOf(doc, 'a'), 'Tab');
    expect(first.handled).toBe(true);
    expect(first.next.selection.$from.parent.attrs.id).toBe('b');

    const fromList = press(stateOf(doc, 'c'), 'Tab');
    expect(fromList.next.selection.$from.parent.attrs.id).toBe('d');
    // The last cell: nothing takes the key, so the browser moves the focus on and Tab is no trap -
    // not even the list's nesting, since an item that is its list's first cannot nest.
    expect(press(stateOf(doc, 'd'), 'Tab').handled).toBe(false);
  });

  it('moves back with Shift-Tab, and lets the focus leave from the first cell', () => {
    const doc = twoByTwo();
    const back = pressShiftTab(stateOf(doc, 'b'));
    expect(back.handled).toBe(true);
    expect(back.next.selection.$from.parent.attrs.id).toBe('a');
    expect(pressShiftTab(stateOf(doc, 'a')).handled).toBe(false);
  });
});
