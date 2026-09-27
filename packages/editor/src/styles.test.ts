import type { BlockNode, ContentDocument } from '@alloy-works/domain';
import { undo } from 'prosemirror-history';
import type { Node as ProseNode } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { fromEditor, toEditor } from './mapping.js';
import { createEditorState } from './state.js';
import { paragraphsAt, setImageStyle, setParagraphStyle, setTableStyle } from './styles.js';
import { figureAt, insertFigure } from './figures.js';
import { imageAt, insertImage } from './images.js';
import { tableAt } from './tables.js';

const ASSET = '00000000-0000-4000-8000-0000000000a1';

const paragraph = (id: string, text: string, style = 'body'): BlockNode => ({
  type: 'paragraph',
  id,
  style,
  content: [{ type: 'text', value: text, marks: [] }],
});

function opened(content: BlockNode[]): EditorState {
  const result = toEditor({
    schemaVersion: 1,
    type: 'component',
    title: 'Styles',
    language: 'en-GB',
    direction: 'ltr',
    content,
  } as unknown as ContentDocument);
  if (!result.editable) throw new Error(result.unsupported.join(', '));
  let next = 0;
  return createEditorState({ doc: result.doc, newIdentifier: () => `n${(next += 1)}` });
}

/** Runs a command, and the state it leaves, or throws where it would do nothing. */
function run(
  state: EditorState,
  command: (s: EditorState, d?: (tr: Transaction) => void) => boolean,
) {
  let after: EditorState | undefined;
  if (!command(state, (tr) => (after = state.apply(tr)))) throw new Error('did nothing');
  return after!;
}

/** The position just inside the text of the block with this text. */
function inside(state: EditorState, text: string): number {
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === text) at = pos + 1;
  });
  return at;
}

const stylesOf = (state: EditorState) =>
  fromEditor(state.doc).content.flatMap((block) =>
    block.type === 'paragraph' ? [[block.id, block.style]] : [],
  );

describe("choosing a block's style", () => {
  it('sets the style of every paragraph the selection touches, as one step Undo takes back', () => {
    let state = opened([
      paragraph('b1', 'First'),
      paragraph('b2', 'Second'),
      paragraph('b3', 'Third'),
    ]);
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, inside(state, 'First') + 2, inside(state, 'Second') + 2),
      ),
    );
    expect(paragraphsAt(state).map(({ node, place }) => [node.textContent, place])).toEqual([
      ['First', 'text'],
      ['Second', 'text'],
    ]);
    const chosen = run(state, setParagraphStyle('lead'));
    expect(stylesOf(chosen)).toEqual([
      ['b1', 'lead'],
      ['b2', 'lead'],
      ['b3', 'body'],
    ]);
    // Back to the default is `body`, which means the default where the paragraph stands.
    expect(stylesOf(run(chosen, setParagraphStyle('body')))).toEqual([
      ['b1', 'body'],
      ['b2', 'body'],
      ['b3', 'body'],
    ]);
    // One step in the component's history.
    let undone: EditorState | undefined;
    undo(chosen, (tr) => (undone = chosen.apply(tr)));
    expect(stylesOf(undone!)).toEqual(stylesOf(state));
  });

  it("sets a table's style, and a figure's and an image's in a line, each where the selection stands", () => {
    let state = opened([
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'Press ', marks: [] },
          {
            type: 'image',
            asset: ASSET,
            imageStyle: 'inline',
            alternative: { kind: 'decorative' },
          },
        ],
      },
      {
        type: 'figure',
        id: 'f1',
        asset: ASSET,
        imageStyle: 'figure',
        caption: [{ type: 'text', value: 'The tray', marks: [] }],
        alternative: { kind: 'decorative' },
      },
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [{ type: 'text', value: 'Readings', marks: [] }],
        headerRows: 0,
        headerColumns: 0,
        rows: [{ cells: [{ content: [paragraph('c1', 'Tray')], colspan: 1, rowspan: 1 }] }],
      },
    ]);

    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(state, 'Tray'))),
    );
    expect(tableAt(state)?.style).toBe('table');
    state = run(state, setTableStyle('banded'));
    expect(tableAt(state)?.style).toBe('banded');

    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(state, 'The tray'))),
    );
    expect(figureAt(state)?.imageStyle).toBe('figure');
    state = run(state, setImageStyle('half-width'));
    expect(figureAt(state)?.imageStyle).toBe('half-width');

    const image = inside(state, 'Press ') + 'Press '.length;
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, image)));
    expect(imageAt(state)?.imageStyle).toBe('inline');
    state = run(state, setImageStyle('icon'));
    expect(imageAt(state)?.imageStyle).toBe('icon');

    const stored = fromEditor(state.doc).content;
    expect(stored.find((block) => block.type === 'table')).toMatchObject({ style: 'banded' });
    expect(stored.find((block) => block.type === 'figure')).toMatchObject({
      imageStyle: 'half-width',
    });
  });

  it('places a figure and an image in a line in the style they were placed with, or the default', () => {
    let state = opened([paragraph('b1', 'Before')]);
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(state, 'Before') + 6)),
    );
    const decorative = { kind: 'decorative' } as const;
    const withImage = run(state, insertImage(ASSET, decorative, 'icon'));
    expect(JSON.stringify(fromEditor(withImage.doc).content)).toContain('"imageStyle":"icon"');
    const withFigure = run(
      state,
      insertFigure(ASSET, decorative, () => 'f9', 'half-width'),
    );
    expect(fromEditor(withFigure.doc).content[1]).toMatchObject({ imageStyle: 'half-width' });
    // Unsaid, the schema's defaults, as before.
    expect(
      fromEditor(
        run(
          state,
          insertFigure(ASSET, decorative, () => 'f9'),
        ).doc,
      ).content[1],
    ).toMatchObject({
      imageStyle: 'figure',
    });
  });

  it("names a footnote's paragraphs in the footnote's place in its own editor, and never from the text around it", () => {
    let state = opened([
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'Unbox', marks: [] },
          {
            type: 'footnote',
            id: 'n1',
            anchor: { kind: 'span' },
            content: [paragraph('fp1', 'Twice.')],
          },
        ],
      },
    ]);
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
    );
    // From the text: the paragraph, and not the footnote's inside it.
    expect(paragraphsAt(state).map(({ node, place }) => [node.textContent, place])).toEqual([
      ['UnboxTwice.', 'text'],
    ]);
    // In the footnote's own editor, whose document is the footnote: its paragraph, in its place.
    let footnote: ProseNode | undefined;
    state.doc.descendants((node) => {
      if (node.type.name === 'footnote') footnote = node;
      return footnote === undefined;
    });
    let inner = EditorState.create({ doc: footnote! });
    inner = inner.apply(inner.tr.setSelection(TextSelection.create(inner.doc, 2)));
    expect(paragraphsAt(inner).map(({ node, place }) => [node.textContent, place])).toEqual([
      ['Twice.', 'footnote'],
    ]);
    const chosen = run(inner, setParagraphStyle('small-note'));
    expect(chosen.doc.firstChild!.attrs.style).toBe('small-note');
  });

  it('does nothing where the selection stands in nothing of the kind', () => {
    const state = opened([paragraph('b1', 'Alone')]);
    expect(setTableStyle('banded')(state)).toBe(false);
    expect(setImageStyle('half-width')(state)).toBe(false);
  });
});
