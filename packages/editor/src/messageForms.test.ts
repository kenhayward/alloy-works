import { bindingDigestInput, type Binding, type ContentDocument } from '@alloy-works/domain';
import { undo } from 'prosemirror-history';
import type { Node } from 'prosemirror-model';
import { NodeSelection, TextSelection, type EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { NEVER_RESOLVED, type BindingContext, type BindingHeld } from './bindings.js';
import { blockCommand } from './blocks.js';
import { setBindingContext } from './bindingView.js';
import { armFromEditor, armToEditor, fromEditor, toEditor } from './mapping.js';
import {
  addExactArm,
  armsListed,
  messageFormsShown,
  removeArm,
  setArm,
  wrapInMessageForm,
} from './messageForms.js';
import { createEditorState } from './state.js';

/** The editor's message form (the MF plan, MF-G): what it shows, how it is made, and its arms. */

const QUERY = '00000000-0000-4000-8000-00000000d001';

const binding = (id: string): Binding => ({
  type: 'binding',
  id,
  query: QUERY,
  parameters: { site: { literal: 'north' } },
  mode: 'checked',
  take: { column: 'visits' },
});

const word = (value: string) => ({ type: 'text' as const, value, marks: [] });

const form = {
  type: 'messageForm',
  id: 'f1',
  kind: 'plural',
  binding: binding('k1'),
  arms: {
    '=0': [word('no visits')],
    one: [{ type: 'messageValue' }, word(' visit')],
    other: [
      { type: 'messageValue' },
      { type: 'text', value: ' visits', marks: [{ type: 'emphasis', id: 'm-e' }] },
    ],
  },
};

function docOf(content: unknown[], language = 'en-GB'): Node {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Site visits',
    language,
    direction: 'ltr',
    content: [{ type: 'paragraph', id: 'b1', style: 'body', content }],
  } as unknown as ContentDocument);
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  return opened.doc;
}

const valued = (value: string, number?: { value: string; scale: number }): BindingHeld => ({
  binding: bindingDigestInput(binding('k1')),
  shown: { value, waiting: false, ...(number === undefined ? {} : { number }) },
});

const inDocument = (held?: BindingHeld): BindingContext => ({
  kind: 'document',
  held: new Map(held === undefined ? [] : [['k1', held]]),
});

const shown = (doc: Node, context: BindingContext | null) =>
  messageFormsShown(doc, context).map(({ text, failed, arm }) => ({ text, failed, arm }));

const counter = () => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

/** A state over `doc`, its first inline node selected whole, with `context` set. */
function selectedAtom(doc: Node, context: BindingContext | null): EditorState {
  const state = createEditorState({ doc, newIdentifier: counter() });
  let at = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 1)));
  const view = {
    get state() {
      return at;
    },
    dispatch: (tr: Parameters<EditorState['apply']>[0]) => {
      at = at.apply(tr);
    },
  };
  setBindingContext(view, context);
  return at;
}

const run = (state: EditorState, command: ReturnType<typeof blockCommand>) => {
  let next: EditorState | null = null;
  const done = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { done, next: next as EditorState | null };
};

describe('a message form on the surface (the MF plan, MF-G)', () => {
  it('LOC-045 shows the arm its held value selects, by the same rule as the publish, with the value formatted', () => {
    const doc = docOf([form]);
    expect(shown(doc, inDocument(valued('3', { value: '3', scale: 0 })))).toEqual([
      { text: '3 visits', failed: false, arm: 'other' },
    ]);
    expect(shown(doc, inDocument(valued('1', { value: '1', scale: 0 })))[0]!.text).toBe('1 visit');
    // An exact arm before any category, 0.00 meeting =0 numerically.
    expect(shown(doc, inDocument(valued('0.00', { value: '0.00', scale: 2 })))[0]).toEqual({
      text: 'no visits',
      failed: false,
      arm: '=0',
    });
    // 1.50 is other in English, as it prints.
    expect(shown(doc, inDocument(valued('1.50', { value: '1.50', scale: 2 })))[0]!.arm).toBe(
      'other',
    );
  });

  it('LOC-045 says by name the arm a value calls for that the form lacks, in the language of its component', () => {
    const doc = docOf([form], 'ar');
    expect(shown(doc, inDocument(valued('3', { value: '3', scale: 0 })))).toEqual([
      { text: 'No words - the form has no arm for few', failed: true, arm: null },
    ]);
  });

  it('shows why there is no value, a value that is no number, and with no context what the node says', () => {
    const doc = docOf([form]);
    expect(shown(doc, inDocument())).toEqual([{ text: NEVER_RESOLVED(), failed: true, arm: null }]);
    expect(shown(doc, inDocument(valued('north')))).toEqual([
      {
        text: 'No number - a message form varies by a number, and this column holds none',
        failed: true,
        arm: null,
      },
    ]);
    expect(shown(doc, null)).toEqual([
      { text: 'Words varying by a number', failed: false, arm: null },
    ]);
  });

  it('on its own shows its other arm, the value as what it asks for', () => {
    const doc = docOf([form]);
    const alone: BindingContext = { kind: 'alone', titles: new Map([[QUERY, 'Readings']]) };
    expect(shown(doc, alone)).toEqual([
      { text: 'visits, Readings visits', failed: false, arm: 'other' },
    ]);
  });

  it('is told to a screen reader as words that vary by a number', () => {
    const doc = docOf([form]);
    expect(messageFormsShown(doc, null)[0]!.hidden).toBe(', words varying by a number');
  });
});

describe('making a message form (the MF plan, MF-G)', () => {
  it('wraps a selected binding that takes a number, an arm for each category of the language, each printing the value', () => {
    const doc = docOf([word('We made '), binding('k1')]);
    const before = createEditorState({ doc, newIdentifier: counter() });
    const state = selectedAtom(
      docOf([binding('k1'), word(' visits')], 'cy'),
      inDocument(valued('3', { value: '3', scale: 0 })),
    );
    const { done, next } = run(
      state,
      wrapInMessageForm(() => 'f9'),
    );
    expect(done).toBe(true);
    const stored = fromEditor(next!.doc).content[0] as { content: unknown[] };
    expect(stored.content[0]).toEqual({
      type: 'messageForm',
      id: expect.any(String),
      kind: 'plural',
      binding: binding('k1'),
      arms: Object.fromEntries(
        ['zero', 'one', 'two', 'few', 'many', 'other'].map((key) => [
          key,
          [{ type: 'messageValue' }],
        ]),
      ),
    });
    // Selected, so its arms open.
    expect((next!.selection as NodeSelection).node.type.name).toBe('messageForm');
    // Nothing to wrap where no binding is selected.
    expect(
      run(
        before,
        wrapInMessageForm(() => 'f9'),
      ).done,
    ).toBe(false);
  });

  it('is the registry action Message form, refused for a binding whose held value is no number', () => {
    const state = selectedAtom(docOf([binding('k1')]), inDocument(valued('north')));
    expect(
      run(
        state,
        blockCommand('messageForm', () => 'f9'),
      ).done,
    ).toBe(false);
    const unknown = selectedAtom(docOf([binding('k1')]), null);
    expect(
      run(
        unknown,
        blockCommand('messageForm', () => 'f9'),
      ).done,
    ).toBe(true);
  });
});

describe('the arms of a message form (the MF plan, MF-G)', () => {
  it('lists a category of its language for each, then its exact arms, then each arm for a category it lacks', () => {
    const arms = { other: [], few: [], '=1': [], one: [] };
    expect(armsListed('en-GB', arms)).toEqual([
      { key: 'one', lacking: false, held: true },
      { key: 'other', lacking: false, held: true },
      { key: '=1', lacking: false, held: true },
      { key: 'few', lacking: true, held: true },
    ]);
    expect(armsListed('ar', { other: [] }).map(({ key, held }) => [key, held])).toEqual([
      ['zero', false],
      ['one', false],
      ['two', false],
      ['few', false],
      ['many', false],
      ['other', true],
    ]);
  });

  it('opens read-only, by name, a component whose arm carries a mark this editor has no type for', () => {
    const commented = {
      ...form,
      arms: {
        other: [
          { type: 'text', value: 'visits', marks: [{ type: 'comment', id: 'c1', threadId: 't1' }] },
        ],
      },
    };
    const opened = toEditor({
      schemaVersion: 1,
      title: 'Site visits',
      language: 'en-GB',
      direction: 'ltr',
      content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [commented] }],
    } as unknown as ContentDocument);
    expect(opened).toEqual({ editable: false, unsupported: ['mark:comment'] });
  });

  it('maps an arm to its own editor node and back, keeping its marks and its value', () => {
    const arm = form.arms.other;
    const node = armToEditor(arm as never);
    expect(node.type.name).toBe('messageArm');
    expect(armFromEditor(node)).toEqual(arm);
  });

  it('sets, removes and adds arms as steps of the one history', () => {
    const state = selectedAtom(docOf([form]), null);
    const set = run(state, setArm(1, 'one', [{ type: 'messageValue' }, word(' site')]))
      .next as EditorState;
    const armsOf = (at: EditorState) => at.doc.nodeAt(1)!.attrs.arms as Record<string, unknown>;
    expect(armsOf(set).one).toEqual([{ type: 'messageValue' }, word(' site')]);
    // Still selected, so its arms stay open.
    expect((set.selection as NodeSelection).node.type.name).toBe('messageForm');
    const removed = run(set, removeArm(1, '=0')).next as EditorState;
    expect(Object.keys(armsOf(removed))).toEqual(['one', 'other']);
    const added = run(removed, addExactArm(1, '=2')).next as EditorState;
    expect(armsOf(added)['=2']).toEqual([{ type: 'messageValue' }]);
    // `other` stays: a form has one.
    expect(run(added, removeArm(1, 'other')).done).toBe(false);
    let back = added;
    while (undo(back, (tr) => (back = back.apply(tr))));
    expect(armsOf(back)).toEqual(form.arms);
  });

  it('keeps no arm for a category emptied, but keeps other empty', () => {
    const state = selectedAtom(docOf([form]), null);
    const emptied = run(state, setArm(1, 'one', [])).next as EditorState;
    expect(Object.keys(emptied.doc.nodeAt(1)!.attrs.arms as object)).toEqual(['=0', 'other']);
    const other = run(state, setArm(1, 'other', [])).next as EditorState;
    expect((other.doc.nodeAt(1)!.attrs.arms as Record<string, unknown>).other).toEqual([]);
    // Off the form, nothing.
    const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
    expect(run(moved, setArm(2, 'one', [])).done).toBe(false);
  });
});
