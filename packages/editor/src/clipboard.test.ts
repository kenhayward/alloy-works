import type { ContentDocument, Mark } from '@alloy-works/domain';
import { undo } from 'prosemirror-history';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import {
  PRODUCT_CLIPBOARD_TYPE,
  pasteInto,
  productClipboard,
  readClipboard,
  type ClipboardSource,
} from './clipboard.js';
import { fromEditor, toEditor } from './mapping.js';
import { createEditorState } from './state.js';

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};

function stateOf(content: ContentDocument['content'], newIdentifier = counter()): EditorState {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Site visits',
    language: 'en-GB',
    direction: 'ltr',
    content,
  });
  if (!opened.editable) throw new Error('expected an editable document');
  return createEditorState({ doc: opened.doc, newIdentifier });
}

const paragraph = (id: string, value: string, marks: Mark[] = []) => ({
  type: 'paragraph' as const,
  id,
  style: 'body',
  content: value === '' ? [] : [{ type: 'text' as const, value, marks }],
});

/** A clipboard holding exactly these types, as a paste event's `clipboardData` does. */
const clipboard = (data: Record<string, string>): ClipboardSource => ({
  types: Object.keys(data),
  getData: (type) => data[type] ?? '',
});

/** Pastes into the state and answers the state afterwards, or fails the test saying why not. */
function paste(state: EditorState, data: Record<string, string>): EditorState {
  const into = state.selection.$from.parent.type.spec.code ? 'preformatted' : 'blocks';
  const outcome = pasteInto(state, readClipboard(clipboard(data), into), counter('p'));
  if (!outcome.ok) throw new Error(outcome.report.at(-1)?.message);
  return state.apply(outcome.transaction);
}

const stored = (state: EditorState) => fromEditor(state.doc).content;

const at = (state: EditorState, pos: number) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));

describe('pasting', () => {
  it('pastes lines of plain text, joining the first and last to the text around the caret', () => {
    // After "York " in "York Leeds".
    const state = paste(at(stateOf([paragraph('b1', 'York Leeds')]), 6), {
      'text/plain': 'and\nHull ',
    });
    // The receiving paragraph keeps its identifier, and what followed the caret is a new block, named
    // by the identity plugin exactly as a split's second half is.
    expect(stored(state)).toEqual([paragraph('b1', 'York and'), paragraph('n1', 'Hull Leeds')]);
  });

  it('pastes HTML with its structure, a list staying a list', () => {
    const state = paste(stateOf([paragraph('b1', '')]), {
      'text/html': '<ul><li>One</li><li><b>Two</b></li></ul>',
      'text/plain': 'One\nTwo',
    });
    expect(stored(state)).toMatchObject([
      {
        type: 'list',
        kind: 'unordered',
        items: [
          { content: [{ type: 'paragraph', content: [{ value: 'One' }] }] },
          {
            content: [
              { type: 'paragraph', content: [{ value: 'Two', marks: [{ type: 'strong' }] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("reads the product's own type before HTML, and HTML before plain text", () => {
    const source = stateOf([paragraph('s1', 'Bold', [{ type: 'strong', id: 's2' }])]);
    const copied = productClipboard(source, 0, source.doc.content.size);
    expect(copied).toBeDefined();
    const state = paste(stateOf([paragraph('b1', '')]), {
      [PRODUCT_CLIPBOARD_TYPE]: copied!,
      'text/html': '<p>From HTML</p>',
      'text/plain': 'From text',
    });
    expect(stored(state)).toMatchObject([
      { type: 'paragraph', content: [{ value: 'Bold', marks: [{ type: 'strong' }] }] },
    ]);
    expect(
      stored(
        paste(stateOf([paragraph('b1', '')]), {
          'text/html': '<p>From HTML</p>',
          'text/plain': 'x',
        }),
      ),
    ).toMatchObject([{ content: [{ value: 'From HTML' }] }]);
  });

  it('gives what it pastes new identifiers, never the ones it was copied with', () => {
    const source = stateOf([
      paragraph('s1', 'One', [{ type: 'emphasis', id: 's2' }]),
      paragraph('s3', 'Two'),
    ]);
    const copied = productClipboard(source, 0, source.doc.content.size)!;
    // Pasted back into the component it came from, at its end: nothing may keep a copied identifier.
    const state = paste(at(source, source.doc.content.size - 1), {
      [PRODUCT_CLIPBOARD_TYPE]: copied,
    });
    const ids = JSON.stringify(stored(state)).match(/"id":"[^"]+"/g)!;
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps pasted text exactly in preformatted text, reading only its plain text', () => {
    const opened = stateOf([{ type: 'preformatted', id: 'b1', text: 'a\n' }]);
    const state = paste(at(opened, 2), {
      'text/html': '<p>not this</p>',
      'text/plain': '\tb\r\n  c',
    });
    expect(stored(state)).toEqual([{ type: 'preformatted', id: 'b1', text: 'a\tb\n  c\n' }]);
  });

  it('takes a paste back with one undo', () => {
    const before = stateOf([paragraph('b1', 'York')]);
    const pasted = paste(at(before, 5), { 'text/html': '<p> and</p><p>Leeds</p>' });
    let undone = pasted;
    undo(pasted, (transaction) => (undone = pasted.apply(transaction)));
    expect(stored(undone)).toEqual([paragraph('b1', 'York')]);
  });

  it('refuses a clipboard nothing can be read from, changing nothing and saying why', () => {
    const state = stateOf([paragraph('b1', 'York')]);
    const outcome = pasteInto(
      state,
      readClipboard(clipboard({ 'image/png': 'x' }), 'blocks'),
      counter(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.report.at(-1)).toMatchObject({ action: 'refused', subject: 'unreadable' });
  });

  it('refuses what the pipeline admits and this editor cannot hold, by name', () => {
    const table = JSON.stringify({
      format: 'alloy-works/content',
      schemaVersion: 1,
      content: [
        {
          type: 'table',
          caption: 'Visits',
          headerRows: 0,
          headerColumns: 0,
          rows: [
            { cells: [{ content: [{ type: 'paragraph', content: [] }], colspan: 1, rowspan: 1 }] },
          ],
        },
      ],
    });
    const outcome = pasteInto(
      stateOf([paragraph('b1', 'York')]),
      readClipboard(clipboard({ [PRODUCT_CLIPBOARD_TYPE]: table }), 'blocks'),
      counter(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.report.slice(-2)).toMatchObject([
      { action: 'discarded', subject: 'unrepresentable', detail: 'table' },
      { action: 'refused', subject: 'invalid' },
    ]);
  });
});

describe('copying', () => {
  it("writes a selection in the product's own format, with the component's language", () => {
    const state = stateOf([paragraph('b1', 'York Leeds')]);
    const text = productClipboard(state, 1, 5)!;
    expect(JSON.parse(text)).toEqual({
      format: 'alloy-works/content',
      schemaVersion: 1,
      language: 'en-GB',
      direction: 'ltr',
      content: [paragraph('b1', 'York')],
    });
  });

  it('writes nothing of its own for a selection that is not a document on its own', () => {
    const state = stateOf([
      {
        type: 'blockquote',
        id: 'q1',
        content: [paragraph('b1', 'Said')],
        attribution: [{ type: 'text', value: 'Ada', marks: [] }],
      },
    ]);
    // Inside the attribution alone: a quotation holding nothing but its attribution is no block.
    const attribution = state.doc.firstChild!.lastChild!;
    const start = state.doc.content.size - 1 - attribution.nodeSize;
    expect(productClipboard(state, start + 1, start + 3)).toBeUndefined();
  });
});
