import { fromEditor, NodeSelection, renderContent, type EditorView } from '@alloy-works/editor';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { open, json, lock, opened, quick, caretIn, blocksOf, para } from './test/componentEditor.js';

shimRangeMeasurement();

afterEach(() => vi.restoreAllMocks());

describe('index entries in the editor (the IX plan, IX-M)', () => {
  const everySave = Object.fromEntries(
    Array.from({ length: 64 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  );
  const answers = (stored: unknown) => ({
    'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
    'POST /v1/components/{id}/lock': () => json(200, { lock }),
    ...everySave,
  });

  /** Every marker the stored document holds, as a save would send it. */
  const markersIn = (view: EditorView) => {
    const [paragraph] = fromEditor(view.state.doc).content as unknown as [{ content: unknown[] }];
    return paragraph.content.filter((each) => (each as { type: string }).type === 'indexMarker');
  };
  const chips = () => [...document.querySelectorAll('.ProseMirror [data-index-marker]')];
  const marked = blocksOf({
    type: 'paragraph',
    id: 'b1',
    style: 'body',
    content: [
      { type: 'text', value: 'Bronze is an alloy.', marks: [] },
      { type: 'indexMarker', term: 'Alloy', sub: 'bronze' },
    ],
  });

  it('draws a marker as a chip naming its entry and saying it prints nothing, which the read text skips', async () => {
    const { surface } = open(answers(marked), quick);
    await surface();
    await screen.findByRole('button', { name: 'Index entry' });
    expect(chips().map((each) => each.textContent)).toEqual([
      'Index: Alloy, bronze (prints nothing)',
    ]);
    expect(chips()[0]).toHaveAttribute(
      'title',
      'Index entry Alloy, bronze. It prints nothing where it stands.',
    );
    // A reader's text and its words hold nothing of it.
    const read = renderContent(marked, document) as HTMLElement;
    expect(read.textContent).toBe('Bronze is an alloy.');
  });

  it('STR-043 marks an entry from the Index entry button, offering the terms already marked', async () => {
    const { surface } = open(answers(marked), quick);
    const view = await surface();
    caretIn(view, 'b1');
    const button = screen.getByRole('button', { name: 'Index entry' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Index entry' });
    const term = within(dialog).getByRole('combobox', { name: 'Term' });
    expect(document.getElementById(term.getAttribute('list')!)).toContainHTML('value="Alloy"');
    await userEvent.type(term, 'Tin');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // At the caret, the paragraph's start.
    expect(markersIn(view)).toEqual([
      { type: 'indexMarker', term: 'Tin' },
      { type: 'indexMarker', term: 'Alloy', sub: 'bronze' },
    ]);
    await waitFor(() => expect(chips()).toHaveLength(2));
    await waitFor(() => expect(view.hasFocus()).toBe(true));
  });

  it('CNT-077 opens the dialog from the keyboard alone, with Ctrl, Shift and 1, and changes the marker selected', async () => {
    const { surface } = open(answers(marked), quick);
    const view = await surface();
    await screen.findByRole('button', { name: 'Index entry' });
    act(() => {
      let at = -1;
      view.state.doc.descendants((node, pos) => {
        if (at === -1 && node.type.name === 'indexMarker') at = pos;
        return at === -1;
      });
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    });
    fireEvent.keyDown(view.dom, { key: '1', code: 'Digit1', ctrlKey: true, shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Index entry' });
    expect(within(dialog).getByRole('combobox', { name: 'Term' })).toHaveValue('Alloy');
    const sub = within(dialog).getByRole('textbox', { name: 'Sub-entry, if any' });
    expect(sub).toHaveValue('bronze');
    await userEvent.clear(sub);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'See another term instead' }));
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'See' }), 'Bronze');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change' }));
    expect(markersIn(view)).toEqual([{ type: 'indexMarker', term: 'Alloy', see: 'Bronze' }]);
    await waitFor(() => expect(chips()[0]).toHaveTextContent('Index: Alloy (prints nothing)'));
  });

  it('places nothing on Cancel', async () => {
    const { surface } = open(answers(blocksOf(para('b1', 'Bronze.'))), quick);
    const view = await surface();
    caretIn(view, 'b1');
    await userEvent.click(screen.getByRole('button', { name: 'Index entry' }));
    const dialog = await screen.findByRole('dialog', { name: 'Index entry' });
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Term' }), 'Tin');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(markersIn(view)).toEqual([]);
  });
});
