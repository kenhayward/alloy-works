import type { BlockNode, ContentDocument } from '@alloy-works/domain';
import type { EditorState } from 'prosemirror-state';
import { DecorationSet, type Decoration } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';

import { toEditor } from './mapping.js';
import { setStyleCheck, unresolvedDecorations, type StyleCheck } from './resolution.js';
import { createEditorState } from './state.js';

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
    title: 'Markers',
    language: 'en-GB',
    direction: 'ltr',
    content,
  } as unknown as ContentDocument);
  if (!result.editable) throw new Error(result.unsupported.join(', '));
  let next = 0;
  return createEditorState({ doc: result.doc, newIdentifier: () => `n${(next += 1)}` });
}

/**
 * A theme's answers, by hand: `lead` for running text only, `gone` in no catalogue, `banded` a table's,
 * `half-width` a figure's; Arabic covered by no face; and inline code set by a face that lacks `ß`.
 */
const check: StyleCheck = {
  paragraph: (style, place) =>
    style === 'lead'
      ? place === 'text'
        ? null
        : 'misplaced'
      : style === 'gone'
        ? 'missing'
        : null,
  table: (style) => (style === 'banded' ? null : 'missing'),
  image: (style, target) =>
    style === 'half-width' ? (target === 'figure' ? null : 'misplaced') : 'missing',
  uncovered: (text, where) =>
    new Set(
      [...text]
        .filter((character) => character >= '؀' && character <= 'ۿ')
        .concat(where.code ? [...text].filter((character) => character === 'ß') : [])
        .map((character) => character.codePointAt(0)!),
    ),
};

const attributesOf = (decoration: Decoration) =>
  (decoration as unknown as { type: { attrs?: Record<string, string> } }).type.attrs ?? {};

describe('what will not resolve, marked where it stands (STY-070)', () => {
  it('marks a paragraph whose style the theme does not hold, or holds for somewhere else, and leaves the rest alone', () => {
    const state = opened([
      paragraph('b1', 'Kept', 'lead'),
      paragraph('b2', 'Gone', 'gone'),
      { type: 'blockquote', id: 'q1', content: [paragraph('b3', 'Quoted', 'lead')] },
      paragraph('b4', 'Plain'),
    ]);
    const marked = unresolvedDecorations(state.doc, check)
      .find()
      .filter((decoration) => 'data-unresolved' in attributesOf(decoration))
      .map((decoration) => [
        state.doc.nodeAt(decoration.from)?.textContent,
        attributesOf(decoration)['data-unresolved'],
        attributesOf(decoration)['data-unresolved-label'],
      ]);
    expect(marked).toEqual([
      ['Gone', 'missing', 'Style gone is not in this theme'],
      ['Quoted', 'misplaced', 'Style lead does not apply here'],
    ]);
  });

  it("marks a table's and an image's style the theme does not hold, or holds only for another kind of image", () => {
    const state = opened([
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'Press ', marks: [] },
          {
            type: 'image',
            asset: ASSET,
            imageStyle: 'half-width',
            alternative: { kind: 'decorative' },
          },
        ],
      },
      {
        type: 'figure',
        id: 'f1',
        asset: ASSET,
        imageStyle: 'half-width',
        caption: [{ type: 'text', value: 'Tray', marks: [] }],
        alternative: { kind: 'decorative' },
      },
      {
        type: 'table',
        id: 't1',
        style: 'striped',
        caption: [{ type: 'text', value: 'Readings', marks: [] }],
        headerRows: 0,
        headerColumns: 0,
        rows: [{ cells: [{ content: [paragraph('c1', 'Cell')], colspan: 1, rowspan: 1 }] }],
      },
    ]);
    const marked = unresolvedDecorations(state.doc, check)
      .find()
      .filter((decoration) => 'data-unresolved' in attributesOf(decoration))
      .sort((a, b) => a.from - b.from)
      .map((decoration) => [
        state.doc.nodeAt(decoration.from)?.type.name,
        attributesOf(decoration)['data-unresolved-label'],
      ]);
    expect(marked).toEqual([
      ['image', 'Image style half-width does not apply here'],
      ['tableFigure', 'Table style striped is not in this theme'],
    ]);
  });

  it('marks each character the face setting it cannot set, naming it, in its setting', () => {
    const state = opened([
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'Strasse ا Straße ', marks: [] },
          {
            type: 'text',
            value: 'Gruß',
            marks: [{ type: 'inlineCode', id: 'm1' }],
          },
        ],
      },
    ]);
    const glyphs = unresolvedDecorations(state.doc, check)
      .find()
      .filter((decoration) => attributesOf(decoration).class === 'aw-glyph-missing')
      .map((decoration) => [
        state.doc.textBetween(decoration.from, decoration.to),
        attributesOf(decoration).title,
      ]);
    // The Arabic letter in running text; the sharp s only in code, whose face lacks it.
    expect(glyphs).toEqual([
      ['ا', 'No glyph for U+0627 in this typeface'],
      ['ß', 'No glyph for U+00DF in this typeface'],
    ]);
  });

  it('marks nothing until the theme is given, and follows the theme the surface is given', () => {
    let state = opened([paragraph('b1', 'Gone', 'gone')]);
    const marked = (of: EditorState) =>
      of.plugins
        .map((plugin) => plugin.props.decorations?.call(plugin, of))
        .filter((set): set is DecorationSet => set instanceof DecorationSet)
        .flatMap((set) => set.find())
        .filter((decoration) => 'data-unresolved' in attributesOf(decoration)).length;
    expect(marked(state)).toBe(0);
    setStyleCheck({ state, dispatch: (tr) => (state = state.apply(tr)) }, check);
    expect(marked(state)).toBe(1);
  });
});
