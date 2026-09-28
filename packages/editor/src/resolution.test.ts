import type { BlockNode, ContentDocument } from '@alloy-works/domain';
import type { Node as ProseNode } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { DecorationSet, type Decoration } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';

import { toEditor } from './mapping.js';
import {
  setStyleCheck,
  textWhereAt,
  unresolvedDecorations,
  type StyleCheck,
} from './resolution.js';
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

  it("marks a character in text a role sets, in a preformatted block's label, and in a footnote's own editor", () => {
    const state = opened([
      {
        type: 'figure',
        id: 'f1',
        asset: ASSET,
        imageStyle: 'half-width',
        caption: [{ type: 'text', value: 'Tray ا', marks: [] }],
        alternative: { kind: 'decorative' },
      },
      { type: 'preformatted', id: 'p1', language: 'اsql', text: 'select 1' },
    ]);
    const decorations = unresolvedDecorations(state.doc, check).find();
    // The caption's letter, marked where it stands.
    expect(
      decorations
        .filter((decoration) => attributesOf(decoration).class === 'aw-glyph-missing')
        .map((decoration) => state.doc.textBetween(decoration.from, decoration.to)),
    ).toEqual(['ا']);
    // The label is drawn, not typed: the block it labels is marked, the character named.
    const label = decorations.find(
      (decoration) => attributesOf(decoration).class === 'aw-label-glyph-missing',
    );
    expect(state.doc.nodeAt(label!.from)?.type.name).toBe('preformatted');
    expect(attributesOf(label!).title).toBe('No glyph for U+0627 in this typeface, in its label');

    // A footnote's own editor, whose document is the footnote: its paragraphs in the footnote's place.
    const withNote = opened([
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
            content: [paragraph('fp1', 'Note ا', 'gone')],
          },
        ],
      },
    ]);
    let footnote: ProseNode | undefined;
    withNote.doc.descendants((node) => {
      if (node.type.name === 'footnote') footnote = node;
      return footnote === undefined;
    });
    const inFootnote = unresolvedDecorations(footnote!, check, true).find();
    expect(
      inFootnote.map(
        (decoration) =>
          attributesOf(decoration)['data-unresolved-label'] ?? attributesOf(decoration).class,
      ),
    ).toEqual(expect.arrayContaining(['Style gone is not in this theme', 'aw-glyph-missing']));
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

describe('where the text at the cursor stands, for the face that sets it (W14.7, W-M)', () => {
  /** The first position holding this text, and the state with the caret there, or over it. */
  const at = (state: EditorState, text: string, length = 0) => {
    let found = -1;
    state.doc.descendants((node, pos) => {
      if (found === -1 && node.isText && node.text!.includes(text)) {
        found = pos + node.text!.indexOf(text);
      }
      return found === -1;
    });
    if (found === -1) throw new Error(`no ${text}`);
    return state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, found, found + length)),
    );
  };

  it("names a paragraph's style and place, a role's text, and code where inline code or preformatted text sets it", () => {
    const state = opened([
      paragraph('b1', 'Kept', 'lead'),
      { type: 'blockquote', id: 'q1', content: [paragraph('b2', 'Quoted')] },
      {
        type: 'paragraph',
        id: 'b3',
        style: 'body',
        content: [
          { type: 'text', value: 'Run ', marks: [] },
          { type: 'text', value: 'npm', marks: [{ type: 'inlineCode', id: 'c1' }] },
        ],
      },
      { type: 'preformatted', id: 'p1', text: 'select 1' },
      {
        type: 'figure',
        id: 'f1',
        asset: ASSET,
        imageStyle: 'half-width',
        caption: [{ type: 'text', value: 'Tray', marks: [] }],
        alternative: { kind: 'decorative' },
      },
    ]);
    expect(textWhereAt(at(state, 'ept'))).toEqual({
      paragraph: { style: 'lead', place: 'text' },
      role: null,
      code: false,
      inlineCode: false,
    });
    expect(textWhereAt(at(state, 'uoted'))).toMatchObject({
      paragraph: { style: 'body', place: 'quotation' },
    });
    // In the inline code run, and over it: what typing there would be set as.
    expect(textWhereAt(at(state, 'pm'))).toMatchObject({ code: true, inlineCode: true });
    expect(textWhereAt(at(state, 'npm', 3))).toMatchObject({ code: true, inlineCode: true });
    expect(textWhereAt(at(state, 'un '))).toMatchObject({ code: false, inlineCode: false });
    expect(textWhereAt(at(state, 'elect'))).toEqual({
      paragraph: null,
      role: 'preformatted',
      code: true,
      inlineCode: false,
    });
    expect(textWhereAt(at(state, 'ray'))).toMatchObject({ paragraph: null, role: 'caption' });
  });

  it("names a footnote's own paragraph in the footnote's place, and nothing where no text is typed", () => {
    const withNote = opened([
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
            content: [paragraph('fp1', 'Note', 'small')],
          },
        ],
      },
    ]);
    let footnote: ProseNode | undefined;
    withNote.doc.descendants((node) => {
      if (node.type.name === 'footnote') footnote = node;
      return footnote === undefined;
    });
    const note = EditorState.create({ doc: footnote! });
    expect(
      textWhereAt(note.apply(note.tr.setSelection(TextSelection.create(note.doc, 2)))),
    ).toMatchObject({ paragraph: { style: 'small', place: 'footnote' }, role: null });
    // Over something selected whole, no text is typed, so there is nothing to say.
    let placed = -1;
    withNote.doc.descendants((node, pos) => {
      if (node.type.name === 'footnote') placed = pos;
    });
    const whole = withNote.apply(
      withNote.tr.setSelection(NodeSelection.create(withNote.doc, placed)),
    );
    expect(textWhereAt(whole)).toBeNull();
  });
});
