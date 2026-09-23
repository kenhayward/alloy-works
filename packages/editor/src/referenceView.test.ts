import { readFileSync } from 'node:fs';

import type { BlockNode, ContentDocument, InlineNode, ReferenceTarget } from '@alloy-works/domain';
import { undo, undoDepth } from 'prosemirror-history';
import type { Node } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { DecorationSet, type Decoration } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';

import { toEditor } from './mapping.js';
import type { ReferenceContext } from './referenceText.js';
import { referenceContextOf, setReferenceContext } from './referenceView.js';
import { createEditorState } from './state.js';

const text = (value: string): InlineNode => ({ type: 'text', value, marks: [] });
const para = (id: string, ...content: InlineNode[]): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});

/** A table captioned _Readings_, and a paragraph referring to it and to a block that has gone. */
function docOf(): Node {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Site visits',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [text('Readings')],
        headerRows: 0,
        headerColumns: 0,
        rows: [{ cells: [{ content: [para('c1', text('York'))], colspan: 1, rowspan: 1 }] }],
      },
      para(
        'b1',
        text('See '),
        {
          type: 'crossReference',
          id: 'x1',
          target: { kind: 'block', block: 't1' },
          display: 'number',
        },
        text(' and '),
        {
          type: 'crossReference',
          id: 'x2',
          target: { kind: 'block', block: 'gone' },
          display: 'number',
        },
      ),
    ],
  } as unknown as ContentDocument);
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  return opened.doc;
}

const readings: ReferenceTarget = {
  target: { kind: 'block', block: 't1' },
  kind: 'table',
  label: 'Table 1.1',
  title: 'Readings',
  relative: null,
};

const counter = () => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

/** A hand-written view: all `setReferenceContext` asks of one is its state and its dispatch. */
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

/** The decorations a surface's state gives its references, as the view would ask for them. */
function decorationsOf(state: EditorState): Decoration[] {
  const sets = state.plugins
    .map((plugin) => plugin.props.decorations?.call(plugin, state))
    .filter((set): set is DecorationSet => set instanceof DecorationSet);
  return sets.flatMap((set) => set.find()).filter((each) => 'referenceText' in each.spec);
}

describe("a surface's reference context (cross-references 1, ruling R10)", () => {
  it('is null unless the state is made with one, and then it is that one', () => {
    const doc = docOf();
    expect(referenceContextOf(createEditorState({ doc, newIdentifier: counter() }))).toBeNull();
    const context: ReferenceContext = { targets: [readings] };
    const state = createEditorState({ doc, newIdentifier: counter(), referenceContext: context });
    expect(referenceContextOf(state)).toBe(context);
  });

  it('is changed by a transaction that changes nothing else, and that no undo takes back', () => {
    const doc = docOf();
    const view = fakeView(createEditorState({ doc, newIdentifier: counter() }));
    view.dispatch(view.state.tr.insertText('Now ', 1 + doc.firstChild!.nodeSize + 1));
    const depth = undoDepth(view.state);
    const edited = view.state.doc;

    const context: ReferenceContext = { targets: [readings] };
    setReferenceContext(view, context);
    const [tr] = view.dispatched.slice(-1);
    expect(tr!.docChanged).toBe(false);
    expect(view.state.doc).toBe(edited);
    expect(referenceContextOf(view.state)).toBe(context);
    expect(undoDepth(view.state)).toBe(depth);
    // The undo takes back the words typed, and leaves the context the host set.
    undo(view.state, (each) => view.dispatch(each));
    expect(view.state.doc.eq(doc)).toBe(true);
    expect(referenceContextOf(view.state)).toBe(context);

    setReferenceContext(view, null);
    expect(referenceContextOf(view.state)).toBeNull();
  });

  it('decorates every reference with what it shows, and whether it is broken, as the context changes', () => {
    const doc = docOf();
    const state = createEditorState({ doc, newIdentifier: counter() });
    const onItsOwn = decorationsOf(state).map((each) => ({
      node: state.doc.nodeAt(each.from)!.type.name,
      size: each.to - each.from,
      spec: each.spec as unknown,
    }));
    expect(onItsOwn).toEqual([
      {
        node: 'crossReference',
        size: 1,
        spec: { referenceText: 'Table: Readings', referenceBroken: false },
      },
      {
        node: 'crossReference',
        size: 1,
        spec: { referenceText: 'Broken reference', referenceBroken: true },
      },
    ]);

    const view = fakeView(state);
    setReferenceContext(view, { targets: [readings] });
    expect(decorationsOf(view.state).map((each) => each.spec as unknown)).toEqual([
      { referenceText: 'Table 1.1', referenceBroken: false },
      { referenceText: 'Broken reference', referenceBroken: true },
    ]);
  });
});

describe('the editor stylesheet, for a cross-reference (cross-references 1)', () => {
  it('sets a reference apart from its text, and a broken one apart again by more than colour', () => {
    // Pinned in the stylesheet itself, as preformatted text's is: jsdom applies no stylesheet a
    // package ships. A broken reference is told by the shape of its underline and its border, so a
    // reader who cannot see the colour can still tell it.
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf-8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(css).toMatch(/\.aw-reference\s*\{[^}]*text-decoration:[^;}]*dotted/);
    const broken = /\.aw-reference\.aw-reference-broken\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(broken).toMatch(/text-decoration:[^;]*wavy/);
    expect(broken).toMatch(/border:[^;]*dashed/);
  });
});
