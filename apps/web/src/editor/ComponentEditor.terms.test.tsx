import { fromEditor, Selection, type EditorView } from '@alloy-works/editor';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import {
  open,
  json,
  lock,
  opened,
  quick,
  caretIn,
  blocksOf,
  para,
} from './test/componentEditor.js';

shimRangeMeasurement();

afterEach(() => vi.restoreAllMocks());

const WHO = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9d01';
const TIDE = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9d02';
const version = { id: '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9df1', number: '0.1' };
const listed = (id: string, preferred: string, abbreviation: string, key: string, more = {}) => ({
  id,
  label: preferred,
  abbreviation,
  term: {
    schemaVersion: 1,
    base: 'en',
    labels: [{ language: 'en', preferred, alternatives: [], abbreviation }],
    definition: [],
    broader: [],
    narrower: [],
    related: [],
    ...more,
  },
  version,
  changedAt: '2026-10-22T09:00:00.000Z',
  state: { key, name: key, approved: key === 'approved' },
});

describe('terms in the editor (the TM plan, TMc)', () => {
  const everySave = Object.fromEntries(
    Array.from({ length: 16 }, (_, at) => [
      `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
      () => json(200, { sequence: at + 1, lock }),
    ]),
  );
  const answers = (stored: unknown) => ({
    'GET /v1/components/{id}': () => json(200, opened({ content: stored })),
    'POST /v1/components/{id}/lock': () => json(200, { lock }),
    'GET /v1/spaces/s1/terms': () =>
      json(200, {
        items: [
          listed(WHO, 'World Health Organization', 'WHO', 'approved'),
          listed(TIDE, 'Mean tide', 'MT', 'deprecated', { replacedBy: WHO }),
        ],
        next: null,
        total: 2,
      }),
    'POST /v1/components/{id}/terms/preview': (body: unknown) =>
      json(200, {
        terms: (body as { terms: string[] }).terms.map((term) =>
          term === TIDE
            ? {
                standing: 'deprecated',
                label: 'Mean tide',
                replacedBy: { id: WHO, label: 'World Health Organization' },
              }
            : { standing: 'approved', label: 'World Health Organization', replacedBy: null },
        ),
      }),
    ...everySave,
  });

  /** Every term mark the stored document holds. */
  const termsOf = (view: EditorView) =>
    JSON.stringify(fromEditor(view.state.doc)).match(/"term":"[^"]+"/g) ?? [];

  it('CNT-165 applies a term from the Term button over the word at the caret, and takes it off', async () => {
    const { surface } = open(answers(blocksOf(para('b1', 'Ask the WHO'))), quick);
    const view = await surface();
    caretIn(view, 'b1');
    // In WHO, at its second letter.
    const at = view.state.selection.from + 'Ask the W'.length;
    act(() =>
      view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at)))),
    );
    const button = screen.getByRole('button', { name: 'Term' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Term' });
    await userEvent.type(
      await within(dialog).findByRole('searchbox', { name: 'Find a term' }),
      'who',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(termsOf(view)).toEqual([`"term":"${WHO}"`]);
    expect(JSON.stringify(fromEditor(view.state.doc))).toContain(
      '"value":"WHO","marks":[{"type":"definedTerm"',
    );

    // The same action on the term opens on it, and takes it off.
    fireEvent.keyDown(view.dom, { key: 'g', code: 'KeyG', ctrlKey: true, altKey: true });
    const again = await screen.findByRole('dialog', { name: 'Term' });
    expect(
      within(again).getByRole('radio', { name: 'World Health Organization (WHO)' }),
    ).toBeChecked();
    await userEvent.click(within(again).getByRole('button', { name: 'Remove term' }));
    expect(termsOf(view)).toEqual([]);
  });

  /**
   * The browser's caret moved to `offset` in the text of `view`'s first paragraph, as an arrow key or
   * a click moves it, before its `selectionchange` has reached ProseMirror: the state still holds
   * the caret where it was, which is where a shortcut pressed straight after found it.
   */
  const browserMoves = (view: EditorView, anchor: number, head = anchor) => {
    view.focus();
    const text = view.dom.querySelector('p')!.firstChild!;
    document.getSelection()!.setBaseAndExtent(text, anchor, text, head);
  };

  it('CNT-165 opens the Term dialog from its shortcut over the word at the caret the author sees', async () => {
    const { surface } = open(answers(blocksOf(para('b1', 'The last paragraph.'))), quick, true);
    const view = await surface();
    caretIn(view, 'b1');
    // The caret at the end, after the full stop, where no word is...
    const end = view.state.selection.$from.end();
    act(() =>
      view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(end)))),
    );
    // ...and the browser's moved back before it, inside "paragraph", when the key is pressed.
    browserMoves(view, 'The last paragraph'.length);
    fireEvent.keyDown(view.dom, { key: 'g', code: 'KeyG', ctrlKey: true, altKey: true });
    expect(await screen.findByRole('dialog', { name: 'Term' })).toBeInTheDocument();
  });

  it('CNT-077 opens the Link dialog from its shortcut over the text the author has just selected', async () => {
    const { surface } = open(answers(blocksOf(para('b1', 'The last paragraph.'))), quick, true);
    const view = await surface();
    caretIn(view, 'b1');
    browserMoves(view, 'The last '.length, 'The last paragraph'.length);
    fireEvent.keyDown(view.dom, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Link' })).toBeInTheDocument();
  });

  it('LIB-018 LIB-062 flags a deprecated term where it is used, naming its replacement', async () => {
    const { surface } = open(
      answers(
        blocksOf({
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'Measured at ', marks: [] },
            { type: 'text', value: 'MT', marks: [{ type: 'definedTerm', id: 'd1', term: TIDE }] },
          ],
        }),
      ),
      quick,
    );
    await surface();
    await waitFor(() =>
      expect(document.querySelector('.ProseMirror .aw-term-flag')).toHaveTextContent(
        '(Deprecated: use World Health Organization)',
      ),
    );
    expect(document.querySelector('.ProseMirror .aw-term-deprecated')).toHaveTextContent('MT');
  });
});
