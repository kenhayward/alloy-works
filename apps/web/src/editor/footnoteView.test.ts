import {
  createEditorState,
  fromEditor,
  mountEditor,
  NodeSelection,
  openFootnote,
  Selection,
  toEditor,
  type EditorView,
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

/** A surface over one paragraph holding a footnote, as the component editor mounts one. */
function mount(): { view: EditorView; setEditable: (editable: boolean) => void } {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Site visits',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      para(
        'b1',
        text('Visited'),
        {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [para('fp1', text('Once.'))],
        },
        text(' twice.'),
      ),
    ],
  } as never);
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  let editable = true;
  const newIdentifier = counter('x');
  const place = document.createElement('div');
  document.body.appendChild(place);
  const view = mountEditor(place, {
    state: createEditorState({ doc: opened.doc, newIdentifier }),
    label: 'Content',
    editable: () => editable,
    dispatch: (tr, target) => target.updateState(target.state.apply(tr)),
    pasted: () => undefined,
    refused: () => undefined,
    newIdentifier,
  });
  return {
    view,
    setEditable: (value) => {
      editable = value;
      view.setProps({});
    },
  };
}

/** The footnote, selected whole, which opens its editor. */
function openIt(view: EditorView): EditorView {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at === -1 && node.type.name === 'footnote') at = pos;
    return at === -1;
  });
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
  return openFootnote(view)!;
}

const words = (view: EditorView) => view.state.doc.textContent;

function pasteEvent(plain: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: ['text/plain'],
      getData: (type: string) => (type === 'text/plain' ? plain : ''),
    },
  });
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("a footnote's own editor (footnotes 1, final review)", () => {
  it('takes nothing once the component is read-only, and says so: no undo, no redo, no paste (finding 2)', () => {
    const { view, setEditable } = mount();
    const inner = openIt(view);
    inner.dispatch(inner.state.tr.insertText('Twice. '));
    const before = words(view);
    setEditable(false);

    const now = openFootnote(view)!;
    expect(now.dom).toHaveAttribute('contenteditable', 'false');
    fireEvent.keyDown(now.dom, { key: 'z', keyCode: 90, ctrlKey: true });
    fireEvent.keyDown(now.dom, { key: 'y', keyCode: 89, ctrlKey: true });
    now.dom.dispatchEvent(pasteEvent('Pasted.'));
    expect(words(view)).toBe(before);
  });

  it('gives the focus back to the surface when an undo from it closes the footnote (finding 5)', () => {
    const { view } = mount();
    view.dispatch(view.state.tr.insertText('!', 1));
    const inner = openIt(view);
    inner.focus();
    fireEvent.keyDown(inner.dom, { key: 'z', keyCode: 90, ctrlKey: true });
    expect(openFootnote(view)).toBeNull();
    expect(view.hasFocus()).toBe(true);
  });

  it('pastes over the whole of its text, selected all, without a warning (finding 6)', () => {
    const { view } = mount();
    const inner = openIt(view);
    inner.dispatch(
      inner.state.tr.setSelection(Selection.fromJSON(inner.state.doc, { type: 'all' })),
    );
    inner.dom.dispatchEvent(pasteEvent('Twice.'));
    const [paragraph] = fromEditor(view.state.doc).content as { content: unknown[] }[];
    expect(paragraph!.content[1]).toMatchObject({
      type: 'footnote',
      content: [{ content: [text('Twice.')] }],
    });
  });
});
