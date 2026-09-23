import type { BlockNode, ContentDocument, InlineNode, Mark } from '@alloy-works/domain';
import { undo } from 'prosemirror-history';
import { Fragment, type Node } from 'prosemirror-model';
import {
  NodeSelection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { fromEditor, toEditor } from './mapping.js';
import { markThroughout, somewhereToPutMark, toggleMarkCommand } from './marks.js';
import { editorSchema } from './schema.js';
import { createEditorState } from './state.js';

const { nodes } = editorSchema;

const NS = 'http://www.w3.org/1998/Math/MathML';
/** An equation in the one form the MathML reader writes, spoken as _x squared_. */
const SQUARED = `<math xmlns="${NS}" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>`;
/** One with no alternative at all. */
const UNSPOKEN = `<math xmlns="${NS}" display="block"><mi>E</mi><mo>=</mo><mi>m</mi></math>`;

describe('an equation in the editor schema (equations 1)', () => {
  it('is an inline atom, selectable whole, carrying no marks, with its MathML and its LaTeX', () => {
    const type = nodes.equation!;
    expect(type.isInline).toBe(true);
    expect(type.isAtom).toBe(true);
    expect(type.isLeaf).toBe(true);
    expect(type.spec.selectable).toBe(true);
    expect(type.spec.draggable).toBe(false);
    expect(type.spec.marks).toBe('');
    // No LaTeX until one is typed: absent in the stored model, null here. The MathML has no default:
    // nothing makes an equation without one.
    expect(type.create({ mathml: SQUARED }).attrs).toEqual({ mathml: SQUARED, latex: null });
    expect(() => type.create({})).toThrow(/mathml/);
  });

  it('stands wherever inline content does, and never in preformatted text', () => {
    const one = Fragment.from(nodes.equation!.create({ mathml: SQUARED }));
    for (const home of [
      'paragraph',
      'footnoteParagraph',
      'term',
      'attribution',
      'tableCaption',
      'figureCaption',
      'tableNote',
    ]) {
      expect(nodes[home]!.validContent(one), home).toBe(true);
    }
    expect(nodes.preformatted!.validContent(one)).toBe(false);
  });

  it('is a block atom too, selectable whole, named as a block is, numbered or not', () => {
    const type = nodes.equationBlock!;
    expect(type.isBlock).toBe(true);
    expect(type.isAtom).toBe(true);
    expect(type.isLeaf).toBe(true);
    expect(type.spec.selectable).toBe(true);
    expect(type.spec.draggable).toBe(false);
    expect(type.spec.group).toBe('block');
    expect(type.create({ mathml: SQUARED }).attrs).toEqual({
      id: null,
      mathml: SQUARED,
      latex: null,
      numbered: false,
    });
    expect(() => type.create({ numbered: true })).toThrow(/mathml/);
  });

  it('stands as a block wherever a block may, and never in a cell, a footnote or a run', () => {
    const one = Fragment.from(nodes.equationBlock!.create({ mathml: SQUARED }));
    const paragraph = nodes.paragraph!.create();
    expect(nodes.doc!.validContent(one)).toBe(true);
    expect(nodes.listItem!.validContent(one)).toBe(true);
    // A quotation holds its blocks and then its attribution.
    expect(nodes.blockquote!.validContent(one)).toBe(true);
    // A definition item opens with its term, and its body is blocks.
    expect(
      nodes.definitionItem!.validContent(Fragment.from([nodes.term!.create(), one.child(0)])),
    ).toBe(true);
    // A cell holds paragraphs and lists alone (tables 1, decision T-D); a list inside one is the
    // commands' and the paste's to refuse, as it is for a quotation.
    expect(nodes.table_cell!.validContent(one)).toBe(false);
    expect(nodes.footnote!.validContent(one)).toBe(false);
    expect(nodes.paragraph!.validContent(one)).toBe(false);
    expect(nodes.table_cell!.validContent(Fragment.from(paragraph))).toBe(true);
  });

  it('renders its alternative as words, in a span inline and a block of its own, with no parse rule', () => {
    const inline = nodes.equation!.spec;
    const block = nodes.equationBlock!.spec;
    expect(inline.toDOM!(nodes.equation!.create({ mathml: SQUARED }))).toEqual([
      'span',
      { class: 'aw-equation', 'data-equation': '' },
      'x squared',
    ]);
    expect(block.toDOM!(nodes.equationBlock!.create({ mathml: SQUARED, numbered: true }))).toEqual([
      'div',
      { class: 'aw-equation-block', 'data-equation-block': '' },
      'x squared',
    ]);
    // No alternative is nothing to say: the view half draws that one marked (ruling R5).
    expect(inline.toDOM!(nodes.equation!.create({ mathml: UNSPOKEN }))).toEqual([
      'span',
      { class: 'aw-equation', 'data-equation': '' },
      '',
    ]);
    // No parse rule, for a footnote's reason: an equation enters a component through its dialog or
    // the product's own clipboard alone, never guessed from an element.
    expect(inline.parseDOM).toBeUndefined();
    expect(block.parseDOM).toBeUndefined();
  });
});

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};

const text = (value: string, ...marks: Mark[]): InlineNode => ({ type: 'text', value, marks });
const emphasis = (id: string): Mark => ({ type: 'emphasis', id });
const link = (id: string): Mark => ({ type: 'hyperlink', id, href: 'https://example.org/' });
const strong = (id: string): Mark => ({ type: 'strong', id });
const paragraph = (id: string, ...content: InlineNode[]): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
/** A stored inline equation, with the LaTeX it was typed as. */
const squared: InlineNode = { type: 'equation', mathml: SQUARED, latex: 'x^2' };
/** A stored block equation. */
const blockEquation = (id: string, numbered = true): BlockNode => ({
  type: 'equation',
  id,
  mathml: SQUARED,
  latex: 'x^2',
  numbered,
});
const table = (caption: InlineNode[], cell: BlockNode[] = [paragraph('c1', text('North'))]) =>
  ({
    type: 'table',
    id: 't1',
    style: 'table',
    caption,
    headerRows: 0,
    headerColumns: 0,
    rows: [{ cells: [{ content: cell, colspan: 1, rowspan: 1 }] }],
  }) as BlockNode;

const documentOf = (...content: BlockNode[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Site visits',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

function stateOf(document: ContentDocument, newIdentifier = counter()): EditorState {
  const opened = toEditor(document);
  if (!opened.editable) throw new Error(`not editable: ${opened.unsupported.join(', ')}`);
  return createEditorState({ doc: opened.doc, newIdentifier });
}

/** Where the first node carrying this identifier starts. */
function startOf(doc: Node, id: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found === -1 && node.attrs.id === id) found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error(`no ${id}`);
  return found;
}

/** Where the first inline equation starts. */
function equationIn(doc: Node, from = 0): number {
  let found = -1;
  doc.nodesBetween(from, doc.content.size, (node, pos) => {
    if (found === -1 && node.type.name === 'equation') found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error('no equation');
  return found;
}

const select = (state: EditorState, from: number, to = from) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));

const selectAt = (state: EditorState, pos: number) =>
  state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)));

function run(state: EditorState, command: Command) {
  let next = state;
  const handled = command(state, (tr: Transaction) => (next = next.apply(tr)));
  return { handled, next };
}

const stored = (state: EditorState) => fromEditor(state.doc).content;

/** Every equation's marks, by type name, in document order. */
const equationMarks = (state: EditorState): string[][] => {
  const found: string[][] = [];
  state.doc.descendants((node) => {
    if (node.type.name === 'equation') found.push(node.marks.map((mark) => mark.type.name));
  });
  return found;
};

/** The whole of the inline content of the textblock starting at `start`. */
const wholeOf = (state: EditorState, start: number) =>
  select(state, start + 1, start + state.doc.nodeAt(start)!.nodeSize - 1);

/**
 * One equation in every inline home, each between two words carrying one annotation: a paragraph, a
 * footnote's paragraph, a term, an attribution, both captions and a table's note.
 */
const everyHome = (mark: (id: string) => Mark) => {
  const around = (id: string): InlineNode[] => [
    text('Before ', mark(id)),
    squared,
    text(' after', mark(id)),
  ];
  return documentOf(
    paragraph('p1', ...around('m1'), {
      type: 'footnote',
      id: 'f1',
      anchor: { kind: 'span' },
      content: [paragraph('fp1', ...around('m2'))],
    }),
    {
      type: 'list',
      id: 'l1',
      kind: 'definition',
      items: [{ term: around('m3'), content: [paragraph('i1', text('Weight'))] }],
    },
    {
      type: 'blockquote',
      id: 'q1',
      content: [paragraph('b1', text('Said'))],
      attribution: around('m4'),
    },
    { ...(table(around('m5')) as object), note: around('m6') } as BlockNode,
    {
      type: 'figure',
      id: 'g1',
      asset: '00000000-0000-4000-8000-00000000a551',
      imageStyle: 'figure',
      caption: around('m7'),
      alternative: { kind: 'decorative' },
    },
  );
};

describe('marks around an equation (equations 1)', () => {
  it('a mark put over words and an equation rests on the words alone, as one annotation', () => {
    const state = stateOf(
      documentOf(
        paragraph('p1', text('Where '), squared, text(' grows')),
        table([text('Readings of '), squared, text(' by site')]),
      ),
    );
    let next = run(
      wholeOf(state, startOf(state.doc, 'p1')),
      toggleMarkCommand('strong', counter('s')),
    ).next;
    next = run(
      wholeOf(next, startOf(next.doc, 't1') + 1),
      toggleMarkCommand('strong', counter('k')),
    ).next;
    expect(equationMarks(next)).toEqual([[], []]);
    expect(stored(next)[0]).toEqual(
      paragraph('p1', text('Where ', strong('s1')), squared, text(' grows', strong('s1'))),
    );
    expect((stored(next)[1] as { caption: unknown }).caption).toEqual([
      text('Readings of ', strong('k1')),
      squared,
      text(' by site', strong('k1')),
    ]);
    expect(markThroughout(wholeOf(next, startOf(next.doc, 'p1')), 'strong')).toBe(true);
  });

  it('an annotation either side of an equation stays one in every home, whatever is typed after it', () => {
    const before = everyHome(link);
    let state = stateOf(before, counter('fresh'));
    // A caret straight after each equation in turn, and a character typed there: it carries on the
    // link it stands in rather than splitting it in two.
    const count = equationMarks(state).length;
    expect(count).toBe(7);
    let from = 0;
    for (let index = 0; index < count; index += 1) {
      const at = equationIn(state.doc, from);
      state = select(state, at + 1);
      state = state.apply(state.tr.insertText('!'));
      from = at + 2;
    }
    const after = JSON.stringify(stored(state));
    expect(after).not.toContain('fresh');
    expect(after.match(/" after"/g)).toBeNull();
    expect(after.match(/"! after"/g)).toHaveLength(7);
    expect(equationMarks(state)).toEqual(Array.from({ length: 7 }, () => []));
  });

  it('keeps one annotation over an equation in every home when marked over it', () => {
    const state = stateOf(everyHome(emphasis));
    // Emphasis runs either side of every equation under one identifier: one annotation each, which
    // the stored model reads back as one range.
    expect(() => fromEditor(state.doc)).not.toThrow();
    expect(stored(state)).toEqual(everyHome(emphasis).content);
  });

  it('offers nowhere to put a mark on an equation selected whole, inline or block', () => {
    const state = stateOf(
      documentOf(paragraph('p1', text('Where '), squared), blockEquation('e1')),
    );
    const inline = selectAt(state, equationIn(state.doc));
    expect(somewhereToPutMark(inline, 'hyperlink')).toBe(false);
    const block = selectAt(state, startOf(state.doc, 'e1'));
    expect(somewhereToPutMark(block, 'hyperlink')).toBe(false);
  });
});

describe('a block equation named as a block is (equations 1)', () => {
  it('is given an identifier where it has none, and keeps it through a deletion undone', () => {
    const state = stateOf(documentOf(paragraph('p1', text('Where')), blockEquation('e1')));
    // Placed with none: the identity plugin names it, as it names any block.
    const end = state.doc.content.size;
    const placed = state.apply(
      state.tr.insert(end, nodes.equationBlock!.create({ mathml: SQUARED })),
    );
    const named = placed.doc.lastChild!.attrs.id as unknown;
    expect(typeof named).toBe('string');
    expect(named).not.toBe('e1');
    // Deleted and brought back by an undo, it is the same equation under the same name.
    const at = startOf(state.doc, 'e1');
    const gone = state.apply(state.tr.delete(at, at + 1));
    expect(() => startOf(gone.doc, 'e1')).toThrow();
    let back = gone;
    undo(gone, (tr) => (back = gone.apply(tr)));
    expect(startOf(back.doc, 'e1')).toBe(at);
    expect(stored(back)[1]).toEqual(blockEquation('e1'));
  });
});
