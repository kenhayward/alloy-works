import type { ReferenceTarget } from '@alloy-works/domain';
import {
  createEditorState,
  mountEditor,
  NodeSelection,
  openFootnote,
  setReferenceContext,
  toEditor,
  type EditorView,
  type ReferenceContext,
} from '@alloy-works/editor';
import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { shimRangeMeasurement } from '../test/range.js';

shimRangeMeasurement();

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};
const text = (value: string) => ({ type: 'text', value, marks: [] });
const para = (id: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const reference = (id: string, block = 't1') => ({
  type: 'crossReference',
  id,
  target: { kind: 'block', block },
  display: 'number',
});
const readings = (label = 'Table 1.1'): ReferenceTarget => ({
  target: { kind: 'block', block: 't1' },
  kind: 'table',
  label,
  title: 'Readings',
  relative: null,
});

/**
 * A surface over a table captioned _Readings_ and a paragraph referring to it, once in its text and
 * once in a footnote's, mounted as the component editor mounts one.
 */
function mount(referenceContext: ReferenceContext | null): EditorView {
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
      para('b1', text('See '), reference('x1'), {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [para('fp1', text('As in '), reference('x2'))],
      }),
    ],
  } as never);
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  const newIdentifier = counter('x');
  const place = document.createElement('div');
  document.body.appendChild(place);
  return mountEditor(place, {
    state: createEditorState({ doc: opened.doc, newIdentifier, referenceContext }),
    label: 'Content',
    editable: () => true,
    dispatch: (tr, target) => target.updateState(target.state.apply(tr)),
    pasted: () => undefined,
    refused: () => undefined,
    newIdentifier,
  });
}

/** The first node of a type, and where it starts. */
function find(view: EditorView, type: string): { pos: number; size: number } {
  let found: { pos: number; size: number } | null = null;
  view.state.doc.descendants((node, pos) => {
    if (found === null && node.type.name === type) found = { pos, size: node.nodeSize };
    return found === null;
  });
  return found!;
}

const drawn = (root: HTMLElement) => root.querySelector<HTMLElement>('.aw-reference')!;

afterEach(() => {
  document.body.replaceChildren();
});

describe('a cross-reference on the surface (cross-references 1, ruling R10)', () => {
  it('shows what it will print, from the document it is edited in', () => {
    const view = mount({ targets: [readings()] });
    const shown = drawn(view.dom);
    expect(shown).toHaveTextContent(/^Table 1\.1$/);
    expect(shown).toHaveAttribute('data-reference');
    expect(shown).not.toHaveClass('aw-reference-broken');
  });

  it('shows its kind and caption on its own, and follows the context as the host changes it', () => {
    const view = mount(null);
    expect(drawn(view.dom)).toHaveTextContent(/^Table: Readings$/);

    setReferenceContext(view, { targets: [readings('Table 2.4')] });
    expect(drawn(view.dom)).toHaveTextContent(/^Table 2\.4$/);
    setReferenceContext(view, { targets: [readings('Table 3.1')] });
    expect(drawn(view.dom)).toHaveTextContent(/^Table 3\.1$/);
    setReferenceContext(view, null);
    expect(drawn(view.dom)).toHaveTextContent(/^Table: Readings$/);
  });

  it('turns broken when its table is deleted, says so, and is whole again when the delete is undone', () => {
    const view = mount({ targets: [readings()] });
    const table = find(view, 'tableFigure');
    view.dispatch(view.state.tr.delete(table.pos, table.pos + table.size));
    expect(drawn(view.dom)).toHaveTextContent(/^Broken reference$/);
    expect(drawn(view.dom)).toHaveClass('aw-reference', 'aw-reference-broken');

    fireEvent.keyDown(view.dom, { key: 'z', keyCode: 90, ctrlKey: true });
    expect(drawn(view.dom)).toHaveTextContent(/^Table 1\.1$/);
    expect(drawn(view.dom)).not.toHaveClass('aw-reference-broken');
  });

  it("is drawn in a footnote's open editor from the surface's context, and follows it", () => {
    const view = mount({ targets: [readings()] });
    const footnote = find(view, 'footnote');
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, footnote.pos)));
    const inner = openFootnote(view)!;
    expect(drawn(inner.dom)).toHaveTextContent(/^Table 1\.1$/);

    setReferenceContext(view, null);
    expect(drawn(openFootnote(view)!.dom)).toHaveTextContent(/^Table: Readings$/);

    const table = find(view, 'tableFigure');
    // The footnote stays selected, so its editor stays open, as the table before it goes.
    view.dispatch(view.state.tr.delete(table.pos, table.pos + table.size));
    const now = openFootnote(view)!;
    expect(drawn(now.dom)).toHaveTextContent(/^Broken reference$/);
    expect(drawn(now.dom)).toHaveClass('aw-reference-broken');
  });
});
