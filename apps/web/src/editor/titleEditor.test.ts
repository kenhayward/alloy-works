import type { InlineNode } from '@alloy-works/domain';
import { mountTitleEditor, NodeSelection, type TitleEditor } from '@alloy-works/editor';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { shimRangeMeasurement } from '../test/range.js';

shimRangeMeasurement();

const NS = 'http://www.w3.org/1998/Math/MathML';
/** An equation in the one form the MathML reader writes, spoken as _x squared_. */
const SQUARED = `<math xmlns="${NS}" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>`;

const text = (value: string): InlineNode => ({ type: 'text', value, marks: [] });
const equation = (mathml = SQUARED): InlineNode => ({ type: 'equation', mathml, latex: 'x^2' });

// Built rather than typed, so no tool on the way here turns them into something else.
const LINE_FEED = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);

/** A title's field, mounted as the outline panel mounts one; what it reported, in order. */
function mount(title: readonly InlineNode[]) {
  const place = document.createElement('div');
  document.body.appendChild(place);
  const heard: string[] = [];
  const changes: InlineNode[][] = [];
  const editor: TitleEditor = mountTitleEditor(place, {
    title,
    label: 'Title',
    language: 'en-GB',
    direction: 'ltr',
    onChange: (now) => {
      changes.push([...now]);
      heard.push('change');
    },
    onCommit: () => heard.push('commit'),
    onPromptEquation: () => heard.push('equation'),
  });
  return { editor, heard, changes, field: editor.view.dom };
}

/** The caret at the end of the field, where a click at its end would put it. */
function caretAtEnd(field: HTMLElement) {
  field.focus();
  const selection = document.getSelection()!;
  selection.selectAllChildren(field);
  selection.collapseToEnd();
  document.dispatchEvent(new Event('selectionchange'));
}

/** Keys typed at the end of the field, as an author types them. */
async function typeAtEnd(field: HTMLElement, keys: string) {
  caretAtEnd(field);
  await userEvent.keyboard(keys);
}

function pasteEvent(plain: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: ['text/plain', 'text/html'],
      getData: (type: string) =>
        type === 'text/plain' ? plain : type === 'text/html' ? '<p><b>Not these words</b></p>' : '',
    },
  });
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("a section title's field (equations 3, ruling R1)", () => {
  it('is one line, named by its label, in the language of its document, with its equation drawn as MathML', () => {
    const { field } = mount([text('Growth as '), equation()]);
    expect(field).toHaveAttribute('role', 'textbox');
    expect(field).toHaveAttribute('aria-label', 'Title');
    expect(field).not.toHaveAttribute('aria-multiline', 'true');
    expect(field).toHaveAttribute('lang', 'en-GB');
    expect(field).toHaveAttribute('dir', 'ltr');
    expect(field).toHaveAttribute('spellcheck', 'true');
    // Drawn by equations 1's own drawing: MathML elements, named by the alternative.
    const math = field.querySelector('.aw-equation math')!;
    expect(math.namespaceURI).toBe(NS);
    expect(math.getAttribute('aria-label')).toBe('x squared');
  });

  it('reports each change with the title as it now stands, and reads it back', async () => {
    const { editor, changes, field } = mount([text('Method')]);
    await typeAtEnd(field, 's');
    expect(changes.at(-1)).toEqual([text('Methods')]);
    expect(editor.read()).toEqual([text('Methods')]);
  });

  it('commits on Enter and never splits the line, whichever Enter it is', async () => {
    const { editor, heard, field } = mount([text('Method')]);
    await typeAtEnd(field, 's{Enter}');
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 13, shiftKey: true });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 13, ctrlKey: true });
    expect(heard).toEqual(['change', 'commit', 'commit', 'commit']);
    expect(editor.read()).toEqual([text('Methods')]);
    expect(field.querySelectorAll('br:not(.ProseMirror-trailingBreak)')).toHaveLength(0);
  });

  it('opens an equation selected whole on Enter, and asks for a new one on Mod-Shift-E', () => {
    const { editor, heard, field } = mount([text('Growth as '), equation()]);
    const { view } = editor;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 10)));
    expect(editor.equationAt()).toEqual({
      display: 'inline',
      pos: 10,
      mathml: SQUARED,
      latex: 'x^2',
    });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 });
    fireEvent.keyDown(field, { key: 'E', keyCode: 69, ctrlKey: true, shiftKey: true });
    expect(heard).toEqual(['equation', 'equation']);
    // Still there: the Enter that opened it did not replace it.
    expect(editor.read()).toEqual([text('Growth as '), equation()]);
  });

  it('takes a paste as plain text on one line, its line breaks spaces and its formatting gone', async () => {
    const { editor, field } = mount([text('Method')]);
    await typeAtEnd(field, ' ');
    field.dispatchEvent(pasteEvent(`and${CARRIAGE_RETURN}${LINE_FEED}materials${LINE_FEED}used`));
    expect(editor.read()).toEqual([text('Method and materials used')]);
  });

  it('undoes and redoes its own changes by the keys a text field answers', async () => {
    const { editor, field } = mount([text('Method')]);
    await typeAtEnd(field, 's');
    fireEvent.keyDown(field, { key: 'z', keyCode: 90, ctrlKey: true });
    expect(editor.read()).toEqual([text('Method')]);
    fireEvent.keyDown(field, { key: 'y', keyCode: 89, ctrlKey: true });
    expect(editor.read()).toEqual([text('Methods')]);
  });

  it('places an equation at the caret and reports it, and changes one where it stands', () => {
    const { editor, changes, field } = mount([text('Growth as ')]);
    caretAtEnd(field);
    expect(editor.insertEquation({ display: 'inline', mathml: SQUARED, latex: 'x^2' })).toBe(true);
    expect(changes.at(-1)).toEqual([text('Growth as '), equation()]);
    expect(field.querySelector('.aw-equation math')).not.toBeNull();
    expect(
      editor.insertEquation({ display: 'block', mathml: SQUARED, latex: null, numbered: false }),
    ).toBe(false);
    const Y = `<math xmlns="${NS}" alttext="y"><mi>y</mi></math>`;
    expect(editor.changeEquation(10, { display: 'inline', mathml: Y, latex: 'y' })).toBe(true);
    expect(editor.read()).toEqual([
      text('Growth as '),
      { type: 'equation', mathml: Y, latex: 'y' },
    ]);
  });

  it('replaces what it holds without reporting it, and forgets the history of what it replaced', async () => {
    const { editor, changes, field } = mount([text('Method')]);
    await typeAtEnd(field, 's');
    const heard = changes.length;
    editor.replace([text('Approach')]);
    expect(editor.read()).toEqual([text('Approach')]);
    expect(changes).toHaveLength(heard);
    fireEvent.keyDown(field, { key: 'z', keyCode: 90, ctrlKey: true });
    expect(editor.read()).toEqual([text('Approach')]);
    // The caret is at its end, where typing carries on.
    expect(editor.view.state.selection.from).toBe(editor.view.state.doc.content.size);
  });

  it('is gone once destroyed', () => {
    const { editor, field } = mount([text('Method')]);
    editor.destroy();
    expect(editor.view.isDestroyed).toBe(true);
    expect(field.isConnected).toBe(false);
  });
});
