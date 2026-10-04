import { bindingDigestInput, type Binding, type ContentDocument } from '@alloy-works/domain';
import { undo, undoDepth } from 'prosemirror-history';
import type { Node } from 'prosemirror-model';
import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { DecorationSet, type Decoration } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';

import {
  BINDING_FAILURE_WORDS,
  bindingSelected,
  bindingsShown,
  NEVER_RESOLVED,
  CHANGED_SINCE_RESOLVED,
  type BindingContext,
  type BindingHeld,
} from './bindings.js';
import { bindingContextOf, setBindingContext } from './bindingView.js';
import { toEditor } from './mapping.js';
import { somewhereToPutMark, toggleMarkCommand } from './marks.js';
import { ownTargets, referencesShown } from './referenceText.js';
import { createEditorState } from './state.js';

/**
 * What a binding shows (the B1 plan, B1-D, B1-J, B1-K): one pure function, `bindingsShown`, which the
 * surface, a footnote's own editor, the read text and the copy all draw from.
 */

const QUERY = '00000000-0000-4000-8000-00000000d001';

const stored = (id: string, take: Binding['take'] = { column: 'depth' }): Binding => ({
  type: 'binding',
  id,
  query: QUERY,
  parameters: { site: { literal: 'north' } },
  mode: 'checked',
  take,
});

const KEYED: Binding['take'] = { key: { site: 'north', open: true }, column: 'depth' };

/** A paragraph holding k1 and k2, and a keyed k3. */
function docOf(): Node {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Site visits',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'The mean was ', marks: [] },
          stored('k1'),
          { type: 'text', value: ' m, and ', marks: [] },
          stored('k2'),
          { type: 'text', value: ' at ', marks: [] },
          stored('k3', KEYED),
        ],
      },
    ],
  } as unknown as ContentDocument);
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  return opened.doc;
}

const held = (binding: Binding, shown: BindingHeld['shown']): BindingHeld => ({
  binding: bindingDigestInput(binding),
  shown,
});

const inDocument = (entries: [string, BindingHeld][]): BindingContext => ({
  kind: 'document',
  held: new Map(entries),
});

const words = (doc: Node, context: BindingContext | null) =>
  bindingsShown(doc, context).map(({ text, hidden, marker, failed }) => ({
    text,
    hidden,
    marker,
    failed,
  }));

describe('bindingsShown, in a document (B1-J)', () => {
  it('shows the value the document holds, and a marker always shown where a revision waits', () => {
    const context = inDocument([
      ['k1', held(stored('k1'), { value: '1,234.5', waiting: false })],
      ['k2', held(stored('k2'), { value: 'Yes', waiting: true })],
      ['k3', held(stored('k3', KEYED), { value: '7', waiting: false })],
    ]);
    expect(words(docOf(), context)).toEqual([
      { text: '1,234.5', hidden: ', bound value', marker: null, failed: false },
      { text: 'Yes', hidden: ', bound value,', marker: 'revision waiting', failed: false },
      { text: '7', hidden: ', bound value', marker: null, failed: false },
    ]);
  });

  it('says in place why a binding has none, in words by the failure, naming the count, the key and the column', () => {
    const failing = (failure: BindingHeld['shown']) =>
      words(docOf(), inDocument([['k3', held(stored('k3', KEYED), failure)]]))[2]!;
    const failed = (text: string) => ({
      text,
      hidden: ', bound value, failed',
      marker: null,
      failed: true,
    });
    expect(failing({ failure: 'value_none' })).toEqual(
      failed('No value - the query returned no rows'),
    );
    expect(failing({ failure: 'value_many', count: 3 })).toEqual(
      failed('No value - the query returned 3 rows'),
    );
    expect(failing({ failure: 'row_missing' })).toEqual(
      failed('No value - no row where site is north and open is true'),
    );
    expect(failing({ failure: 'value_null' })).toEqual(failed('No value - empty'));
    expect(failing({ failure: 'value_empty' })).toEqual(failed('No value - empty'));
    expect(failing({ failure: 'take_invalid' })).toEqual(
      failed('No value - the definition has no column depth'),
    );
    expect(failing({ failure: 'unavailable' })).toEqual(
      failed('No value - the result cannot be read'),
    );
  });

  it('says a binding the document holds nothing for was never resolved', () => {
    expect(words(docOf(), inDocument([]))[0]).toEqual({
      text: NEVER_RESOLVED,
      hidden: ', bound value, failed',
      marker: null,
      failed: true,
    });
    expect(NEVER_RESOLVED).toBe('No value - never resolved');
  });

  it('says a binding the author has changed since it was resolved holds no value, though the view holds one', () => {
    // The view answered for k1 taking another column: the binding as the editor holds it is not the
    // binding the document holds a value for.
    const context = inDocument([
      ['k1', held(stored('k1', { column: 'width' }), { value: '1,234.5', waiting: false })],
    ]);
    expect(words(docOf(), context)[0]).toEqual({
      text: CHANGED_SINCE_RESOLVED,
      hidden: ', bound value, failed',
      marker: null,
      failed: true,
    });
    expect(CHANGED_SINCE_RESOLVED).toBe('No value - the binding changed since it was resolved');
  });

  it('words each failure the view answers, keyed by hand', () => {
    expect(Object.keys(BINDING_FAILURE_WORDS).sort()).toEqual(
      [
        'take_invalid',
        'value_none',
        'value_many',
        'row_missing',
        'value_null',
        'value_empty',
        'unavailable',
      ].sort(),
    );
  });
});

describe('bindingsShown, on its own (B1-K)', () => {
  it('shows what it asks for - its column and its definition title - and never a value', () => {
    const alone: BindingContext = { kind: 'alone', titles: new Map([[QUERY, 'Readings']]) };
    const hidden = ', bound value, a value in each document';
    expect(words(docOf(), alone)).toEqual([
      { text: 'depth, Readings', hidden, marker: null, failed: false },
      { text: 'depth, Readings', hidden, marker: null, failed: false },
      {
        text: 'depth where site is north and open is true, Readings',
        hidden,
        marker: null,
        failed: false,
      },
    ]);
  });

  it('says a bound value where the reader may not read the definition, or its title is not known yet', () => {
    const hidden = ', bound value, a value in each document';
    for (const titles of [new Map([[QUERY, null]]), new Map<string, string | null>()]) {
      expect(words(docOf(), { kind: 'alone', titles })[0]).toEqual({
        text: 'a bound value',
        hidden,
        marker: null,
        failed: false,
      });
    }
  });

  it('says what the node alone says where there is no context', () => {
    expect(words(docOf(), null)[0]).toEqual({
      text: 'Bound value',
      hidden: '',
      marker: null,
      failed: false,
    });
  });
});

describe('the words a binding shows', () => {
  it('hold no em or en dash', () => {
    const dashes = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
    const failures: BindingHeld['shown'][] = [
      { failure: 'value_none' },
      { failure: 'value_many', count: 2 },
      { failure: 'row_missing' },
      { failure: 'value_null' },
      { failure: 'take_invalid' },
      { failure: 'unavailable' },
      { value: 'x', waiting: true },
    ];
    const all = [
      ...failures.flatMap((shown) =>
        bindingsShown(docOf(), inDocument([['k3', held(stored('k3', KEYED), shown)]])),
      ),
      ...bindingsShown(docOf(), inDocument([])),
      ...bindingsShown(docOf(), { kind: 'alone', titles: new Map() }),
      ...bindingsShown(docOf(), null),
    ];
    for (const shown of all) {
      expect(`${shown.text}${shown.hidden}${shown.marker ?? ''}`).not.toMatch(dashes);
    }
  });
});

describe('bindingSelected', () => {
  it('answers the binding selected whole, as stored, and nothing else', () => {
    const doc = docOf();
    let k1 = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === 'binding' && node.attrs.id === 'k1') k1 = pos;
    });
    const state = createEditorState({ doc, newIdentifier: () => 'x' });
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, k1)));
    expect(bindingSelected(selected)).toEqual({ pos: k1, binding: stored('k1') });
    const caret = state.apply(state.tr.setSelection(TextSelection.create(state.doc, k1)));
    expect(bindingSelected(caret)).toBeNull();
  });
});

describe('a binding among the marks and the references (BI-A, B1-C)', () => {
  const positionOf = (doc: Node, id: string) => {
    let at = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === 'binding' && node.attrs.id === id) at = pos;
    });
    return at;
  };

  it('carries no mark: one put over words and a binding rests on the words alone', () => {
    const state = createEditorState({ doc: docOf(), newIdentifier: counter() });
    const all = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
    );
    let next = all;
    toggleMarkCommand('strong', counter())(all, (tr) => (next = all.apply(tr)));
    next.doc.descendants((node) => {
      if (node.type.name === 'binding') expect(node.marks).toEqual([]);
    });
    const selected = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, positionOf(state.doc, 'k1'))),
    );
    expect(somewhereToPutMark(selected, 'strong')).toBe(false);
  });

  it("is never a reference's target: one naming a binding's identifier is broken", () => {
    const opened = toEditor({
      schemaVersion: 1,
      title: 'Site visits',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            stored('k1'),
            {
              type: 'crossReference',
              id: 'x1',
              target: { kind: 'block', block: 'k1' },
              display: 'number',
            },
          ],
        },
      ],
    } as unknown as ContentDocument);
    if (!opened.editable) throw new Error(opened.unsupported.join(', '));
    expect(referencesShown(opened.doc, null)).toEqual([
      { pos: 2, text: 'Broken reference', broken: true },
    ]);
    expect(ownTargets(opened.doc)).toEqual([]);
  });
});

function counter() {
  let next = 0;
  return () => `n${(next += 1)}`;
}

/** A hand-written view: all `setBindingContext` asks of one is its state and its dispatch. */
function fakeView(state: EditorState) {
  const view = {
    state,
    dispatched: [] as Transaction[],
    dispatch(tr: Transaction) {
      view.dispatched.push(tr);
      view.state = view.state.apply(tr);
    },
  };
  return view;
}

/** The decorations a surface's state gives its bindings, as the view would ask for them. */
function decorationsOf(state: EditorState): Decoration[] {
  const sets = state.plugins
    .map((plugin) => plugin.props.decorations?.call(plugin, state))
    .filter((set): set is DecorationSet => set instanceof DecorationSet);
  return sets.flatMap((set) => set.find()).filter((each) => 'bindingText' in each.spec);
}

describe("a surface's binding context (B1-D)", () => {
  it('is null unless the state is made with one, and set by a transaction no undo takes back', () => {
    const doc = docOf();
    const view = fakeView(createEditorState({ doc, newIdentifier: counter() }));
    expect(bindingContextOf(view.state)).toBeNull();
    view.dispatch(view.state.tr.insertText('Now ', 1));
    const depth = undoDepth(view.state);

    const context = inDocument([]);
    setBindingContext(view, context);
    expect(view.dispatched.at(-1)!.docChanged).toBe(false);
    expect(bindingContextOf(view.state)).toBe(context);
    expect(undoDepth(view.state)).toBe(depth);
    undo(view.state, (each) => view.dispatch(each));
    expect(view.state.doc.eq(doc)).toBe(true);
    expect(bindingContextOf(view.state)).toBe(context);
  });

  it('decorates each binding with what it shows, flat, redrawn when the context changes and only then', () => {
    const doc = docOf();
    const first = inDocument([['k1', held(stored('k1'), { value: '1,234.5', waiting: false })]]);
    const view = fakeView(
      createEditorState({ doc, newIdentifier: counter(), bindingContext: first }),
    );
    const before = decorationsOf(view.state).map((each) => each.spec as Record<string, unknown>);
    expect(before[0]).toEqual({
      bindingText: '1,234.5',
      bindingHidden: ', bound value',
      bindingMarker: null,
      bindingFailed: false,
    });
    for (const spec of before) {
      for (const member of Object.values(spec)) {
        expect(member === null || typeof member !== 'object').toBe(true);
      }
    }

    // Typing elsewhere changes nothing a binding shows: each spec is member for member the same.
    view.dispatch(view.state.tr.insertText('Now ', 1));
    expect(decorationsOf(view.state).map((each) => each.spec)).toEqual(before);

    setBindingContext(
      view,
      inDocument([['k1', held(stored('k1'), { value: '2,000', waiting: true })]]),
    );
    const after = decorationsOf(view.state).map((each) => each.spec as Record<string, unknown>);
    expect(after[0]).toMatchObject({ bindingText: '2,000', bindingMarker: 'revision waiting' });
  });
});
