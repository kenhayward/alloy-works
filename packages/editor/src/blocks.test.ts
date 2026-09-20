import type { Node } from 'prosemirror-model';
import { Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import {
  MOST_NESTED_LIST_LEVELS,
  blockCommand,
  listAt,
  listAwareEnter,
  setListAttributes,
} from './blocks.js';
import { fromEditor } from './mapping.js';
import { editorSchema } from './schema.js';
import { createEditorState } from './state.js';

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

/**
 * A key, driven through **the real keymap chain** - every `handleKeyDown` the state's own plugins
 * carry, in the order `createEditorState` put them in, which is the order `EditorView` consults.
 *
 * Reasoning about which binding wins is exactly what this cannot be: `enterWithoutEmpties` is bound
 * in the first keymap and returns true in an empty paragraph, so a list-aware Enter bound anywhere
 * after it would never run and the author would be trapped in the list with no key that leaves it.
 * The only way to know is to press the key.
 */
function press(state: EditorState, key: string): { handled: boolean; next: EditorState } {
  let next = state;
  const view = {
    get state() {
      return next;
    },
    dispatch: (tr: Transaction) => {
      next = next.apply(tr);
    },
  };
  const event = {
    key,
    keyCode: key === 'Enter' ? 13 : 9,
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
  };
  const event = {
    key: 'Tab',
    keyCode: 9,
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
    // The last link answers it, as it did before this chain existed: the selection goes and the
    // block splits, inside the item. Nothing is lifted, and the list is still a list.
    expect(shapeOf(next.doc)).toEqual([
      'doc',
      [
        'list',
        ['listItem', ['paragraph', 'O'], ['paragraph', 'wo']],
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
    // MOST_NESTED_LIST_LEVELS is a measurement, not a preference: `fromEditor` parses through
    // `parseContentDocument`, whose nesting limit is counted in JSON depth, and a list level costs
    // four of those. This is the arithmetic, done by running it - so a change to either the limit or
    // the mapping's shape fails here rather than at an author's keyboard.
    expect(() => stored(documentOf(nested(MOST_NESTED_LIST_LEVELS)))).not.toThrow();
    expect(() => stored(documentOf(nested(MOST_NESTED_LIST_LEVELS + 1)))).toThrow(
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
    const state = stateOf(documentOf(nested(MOST_NESTED_LIST_LEVELS)), 'b2');
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
    const state = stateOf(documentOf(nested(MOST_NESTED_LIST_LEVELS - 1)), 'b2');
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
    const state = stateOf(documentOf(nested(MOST_NESTED_LIST_LEVELS)), 'b2');
    expect(blockCommand('definitionList', ids())(state, undefined)).toBe(false);
    expect(run(state, blockCommand('definitionList', ids())).handled).toBe(false);

    // One level short it is taken, and what it makes is storable.
    const room = stateOf(documentOf(nested(MOST_NESTED_LIST_LEVELS - 1)), 'b2');
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
    expect(() => stored(documentOf(deepest(MOST_NESTED_LIST_LEVELS)))).not.toThrow();

    const state = stateOf(documentOf(deepest(MOST_NESTED_LIST_LEVELS)), 'b2');
    expect(blockCommand('bulletedList', ids())(state, undefined)).toBe(false);
    expect(run(state, blockCommand('bulletedList', ids())).handled).toBe(false);

    const room = stateOf(documentOf(deepest(MOST_NESTED_LIST_LEVELS - 1)), 'b2');
    const { handled, next } = run(room, blockCommand('numberedList', ids()));
    expect(handled).toBe(true);
    expect(() => stored(next.doc)).not.toThrow();
  });

  it('nests an item elsewhere in a document that already holds a list at the limit', () => {
    // The rule is about the document the gesture would make, so a deep list in one part of a
    // component must not freeze Tab in another: the deepest chain is unchanged by a nesting that
    // happens somewhere shallower.
    const doc = documentOf(
      nested(MOST_NESTED_LIST_LEVELS),
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
