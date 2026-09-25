import type { BlockNode, ContentDocument, InlineNode, Mark } from '@alloy-works/domain';
import { readFileSync } from 'node:fs';

import { undo } from 'prosemirror-history';
import { Fragment, type Node } from 'prosemirror-model';
import {
  EditorState,
  NodeSelection,
  TextSelection,
  type Command,
  type Transaction,
} from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { blockCommand } from './blocks.js';
import { changeEquation, equationAt, equationPlaceable, insertEquation } from './equations.js';
import { fromEditor, toEditor } from './mapping.js';
import {
  commandKeymap,
  EDITOR_COMMANDS,
  markThroughout,
  somewhereToPutMark,
  toggleMarkCommand,
} from './marks.js';
import { editorSchema } from './schema.js';
import { createEditorState, footnotePluginsOf } from './state.js';

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

/** A caret this many characters into the inline content of the node starting at `start`. */
const caretIn = (state: EditorState, start: number, offset = 0) =>
  select(state, start + 1 + offset);

/** The footnote's own editing state, as its nested editor holds it: its node is the document. */
function footnoteState(outer: EditorState, id: string, offset = 0): EditorState {
  const node = outer.doc.nodeAt(startOf(outer.doc, id))!;
  const state = EditorState.create({ doc: node, plugins: footnotePluginsOf(outer)(() => 'en-GB') });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1 + offset)));
}

const INLINE = { display: 'inline', mathml: SQUARED, latex: 'x^2' } as const;
const BLOCK = { display: 'block', mathml: SQUARED, latex: 'x^2', numbered: true } as const;

/** Every stored block's type and identifier, at the top level. */
const outline = (state: EditorState) =>
  stored(state).map((block) => [block.type, block.id] as const);

/**
 * One of every place a caret can stand: each inline home, and the blocks around them, so a command's
 * answer can be read for all of them at once.
 */
const everywhere = () =>
  stateOf(
    documentOf(
      paragraph('p1', text('Where')),
      {
        type: 'list',
        id: 'l1',
        kind: 'definition',
        items: [{ term: [text('Load')], content: [paragraph('i1', text('Weight'))] }],
      },
      {
        type: 'list',
        id: 'l2',
        kind: 'unordered',
        items: [{ content: [paragraph('i2', text('First'))] }],
      },
      {
        type: 'blockquote',
        id: 'q1',
        content: [paragraph('b1', text('Said'))],
        attribution: [text('Ada')],
      },
      {
        ...(table(
          [text('Readings')],
          [
            paragraph('c1', text('North')),
            {
              type: 'list',
              id: 'cl1',
              kind: 'unordered',
              items: [{ content: [paragraph('c2', text('South'))] }],
            },
          ],
        ) as object),
        note: [text('Estimated')],
      } as BlockNode,
      {
        type: 'figure',
        id: 'g1',
        asset: '00000000-0000-4000-8000-00000000a551',
        imageStyle: 'figure',
        caption: [text('Visits')],
        alternative: { kind: 'decorative' },
      },
      { type: 'preformatted', id: 'pre1', text: 'code' },
      paragraph('p9', text('End')),
    ),
  );

/** Where each kind of home starts in `everywhere()`, by name. */
function homesOf(state: EditorState): Record<string, number> {
  const tableAt = startOf(state.doc, 't1');
  const table = state.doc.nodeAt(tableAt)!;
  const quotation = startOf(state.doc, 'q1');
  return {
    paragraph: startOf(state.doc, 'p1'),
    term: startOf(state.doc, 'l1') + 2,
    'definition body': startOf(state.doc, 'i1'),
    'list item': startOf(state.doc, 'i2'),
    quotation: startOf(state.doc, 'b1'),
    attribution:
      quotation +
      state.doc.nodeAt(quotation)!.nodeSize -
      1 -
      state.doc.nodeAt(quotation)!.lastChild!.nodeSize,
    caption: tableAt + 1,
    cell: startOf(state.doc, 'c1'),
    'list in a cell': startOf(state.doc, 'c2'),
    note: tableAt + table.nodeSize - 1 - table.lastChild!.nodeSize,
    'figure caption': startOf(state.doc, 'g1') + 1,
    preformatted: startOf(state.doc, 'pre1'),
  };
}

describe('placing an equation (equations 1)', () => {
  it('CNT-025 places an inline one at the caret, selected whole, with its MathML and its LaTeX', () => {
    const state = caretIn(stateOf(documentOf(paragraph('p1', text('Where it grows.')))), 0, 5);
    const { handled, next } = run(state, insertEquation(INLINE));
    expect(handled).toBe(true);
    expect(stored(next)).toEqual([paragraph('p1', text('Where'), squared, text(' it grows.'))]);
    expect(equationAt(next)).toEqual({
      display: 'inline',
      pos: 6,
      mathml: SQUARED,
      latex: 'x^2',
    });
  });

  it('places it at the end of a selection, leaving the selected words where they are', () => {
    const state = select(stateOf(documentOf(paragraph('p1', text('Where it grows.')))), 1, 6);
    const { next } = run(state, insertEquation({ ...INLINE, latex: null }));
    expect(stored(next)).toEqual([
      paragraph('p1', text('Where'), { type: 'equation', mathml: SQUARED }, text(' it grows.')),
    ]);
  });

  it('places an inline one in every inline home, and never in preformatted text', () => {
    const state = everywhere();
    for (const [name, start] of Object.entries(homesOf(state))) {
      expect(state.doc.nodeAt(start)!.inlineContent, name).toBe(true);
      const at = caretIn(state, start, 1);
      const expected = name !== 'preformatted';
      expect(equationPlaceable(at, 'inline'), name).toBe(expected);
      const { handled, next } = run(at, insertEquation(INLINE));
      expect(handled, name).toBe(expected);
      if (!expected) continue;
      expect(equationAt(next), name).toMatchObject({ display: 'inline', mathml: SQUARED });
      expect(() => fromEditor(next.doc), name).not.toThrow();
    }
  });

  it('places a block one after the paragraph the caret is in, selected whole and named', () => {
    const state = caretIn(
      stateOf(documentOf(paragraph('p1', text('Where')), paragraph('p2', text('Then')))),
      0,
      2,
    );
    const { handled, next } = run(state, insertEquation(BLOCK));
    expect(handled).toBe(true);
    const [, equation] = stored(next);
    expect(outline(next)).toEqual([
      ['paragraph', 'p1'],
      ['equation', equation!.id],
      ['paragraph', 'p2'],
    ]);
    expect(equation).toEqual({ ...blockEquation(equation!.id), numbered: true });
    expect(equationAt(next)).toEqual({
      display: 'block',
      pos: startOf(next.doc, equation!.id),
      id: equation!.id,
      mathml: SQUARED,
      latex: 'x^2',
      numbered: true,
    });
  });

  it('places a block one in place of an empty paragraph, as a figure is placed', () => {
    const opened = stateOf(
      documentOf(paragraph('p1', text('Where')), paragraph('p2'), paragraph('p3', text('Then'))),
    );
    const state = caretIn(opened, startOf(opened.doc, 'p2'));
    const { next } = run(state, insertEquation({ ...BLOCK, numbered: false, latex: null }));
    const [, equation] = stored(next);
    expect(outline(next)).toEqual([
      ['paragraph', 'p1'],
      ['equation', equation!.id],
      ['paragraph', 'p3'],
    ]);
    expect(equation).toEqual({
      type: 'equation',
      id: equation!.id,
      mathml: SQUARED,
      numbered: false,
    });
  });

  it('leaves a paragraph after a block one that would otherwise end what holds it', () => {
    // An equation is an atom with nothing inside to type into, so where nothing followed it in its
    // list's item there would be nowhere for a caret to stand after it: the gap cursor stands past one
    // only where nothing follows it anywhere (`insertEquation`).
    const last = caretIn(stateOf(documentOf(paragraph('p1', text('Where')))), 0, 5);
    const after = run(last, insertEquation(BLOCK)).next;
    expect(stored(after).map((block) => block.type)).toEqual([
      'paragraph',
      'equation',
      'paragraph',
    ]);
    expect(stored(after)[2]).toMatchObject({ type: 'paragraph', content: [] });
    expect(equationAt(after)).toMatchObject({ display: 'block' });
    // In place of an empty last paragraph, the same: the empty line the author stood on stays below.
    const empty = caretIn(stateOf(documentOf(paragraph('p1', text('Where')), paragraph('p2'))), 7);
    const placed = run(empty, insertEquation(BLOCK)).next;
    expect(stored(placed).map((block) => block.type)).toEqual([
      'paragraph',
      'equation',
      'paragraph',
    ]);
    expect(() => fromEditor(placed.doc)).not.toThrow();
    // At the end of a quotation's text, where its attribution follows: no caret stands between a
    // block and the attribution, and Enter there leaves the quotation, so without the paragraph the
    // quotation could not go on after the equation (equations 1's final review, L1).
    const quoted = stateOf(
      documentOf({
        type: 'blockquote',
        id: 'q1',
        content: [paragraph('b1', text('Said'))],
        attribution: [text('Ada')],
      }),
    );
    const quoting = run(caretIn(quoted, startOf(quoted.doc, 'b1'), 4), insertEquation(BLOCK)).next;
    const [quotation] = stored(quoting);
    expect(quotation).toMatchObject({
      type: 'blockquote',
      content: [
        { type: 'paragraph', id: 'b1' },
        { type: 'equation' },
        { type: 'paragraph', content: [] },
      ],
      attribution: [text('Ada')],
    });
    expect(() => fromEditor(quoting.doc)).not.toThrow();
  });

  it('places a block one wherever a block may stand, and nowhere in a table or out of a paragraph', () => {
    const state = everywhere();
    const may = new Set(['paragraph', 'definition body', 'list item', 'quotation']);
    for (const [name, start] of Object.entries(homesOf(state))) {
      const at = caretIn(state, start, 1);
      expect(equationPlaceable(at, 'block'), name).toBe(may.has(name));
      const { handled, next } = run(at, insertEquation(BLOCK));
      expect(handled, name).toBe(may.has(name));
      if (!may.has(name)) {
        expect(next.doc.eq(at.doc), name).toBe(true);
        continue;
      }
      const placed = equationAt(next);
      expect(placed, name).toMatchObject({ display: 'block', numbered: true });
      // Straight after the paragraph the caret was in, which had words in it, in the same parent.
      expect(next.doc.resolve(placed!.pos).nodeBefore!.attrs.id, name).toBe(
        state.doc.nodeAt(start)!.attrs.id,
      );
      expect(() => fromEditor(next.doc), name).not.toThrow();
    }
    // Nor over a selection reaching across two blocks.
    const across = select(state, startOf(state.doc, 'p1') + 2, startOf(state.doc, 'p9') + 2);
    expect(equationPlaceable(across, 'block')).toBe(false);
  });

  it("places an inline one in a footnote's own text, and never a block one there", () => {
    const outer = stateOf(
      documentOf(
        paragraph('p1', text('Visited'), {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [paragraph('fp1', text('Once'))],
        }),
      ),
    );
    const inside = footnoteState(outer, 'f1', 4);
    const { handled, next } = run(inside, insertEquation(INLINE));
    expect(handled).toBe(true);
    expect(next.doc.firstChild!.lastChild!.type.name).toBe('equation');
    expect(equationPlaceable(inside, 'block')).toBe(false);
    expect(insertEquation(BLOCK)(inside)).toBe(false);
  });

  it('refuses MathML or LaTeX the stored model would refuse, and reads empty LaTeX as none', () => {
    const state = caretIn(stateOf(documentOf(paragraph('p1', text('Where')))), 0, 5);
    // Not the one form the reader writes: a save would refuse it, so nothing places it.
    expect(insertEquation({ ...INLINE, mathml: '<math><mi>x</mi></math>' })(state)).toBe(false);
    expect(insertEquation({ ...BLOCK, mathml: '' })(state)).toBe(false);
    const { next } = run(state, insertEquation({ ...INLINE, latex: '' }));
    expect(equationAt(next)).toMatchObject({ latex: null });
  });
});

describe('the equation selected, and changing it (equations 1)', () => {
  it('answers the equation selected whole, inline or block, and nothing for anything else', () => {
    const state = stateOf(
      documentOf(
        paragraph('p1', text('Where '), { type: 'equation', mathml: SQUARED }),
        blockEquation('e1', false),
      ),
    );
    expect(equationAt(state)).toBeNull();
    const inline = equationIn(state.doc);
    expect(equationAt(selectAt(state, inline))).toEqual({
      display: 'inline',
      pos: inline,
      mathml: SQUARED,
      latex: null,
    });
    expect(equationAt(selectAt(state, startOf(state.doc, 'e1')))).toEqual({
      display: 'block',
      pos: startOf(state.doc, 'e1'),
      id: 'e1',
      mathml: SQUARED,
      latex: 'x^2',
      numbered: false,
    });
    expect(equationAt(selectAt(state, startOf(state.doc, 'p1')))).toBeNull();
  });

  it('changes one in place, keeping a block its identifier, and keeps it selected whole', () => {
    const state = stateOf(
      documentOf(paragraph('p1', text('Where '), squared, text(' grows')), blockEquation('e1')),
    );
    const inline = equationIn(state.doc);
    const changedInline = run(
      selectAt(state, inline),
      changeEquation(inline, { display: 'inline', mathml: UNSPOKEN, latex: null }),
    );
    expect(changedInline.handled).toBe(true);
    expect(stored(changedInline.next)[0]).toEqual(
      paragraph('p1', text('Where '), { type: 'equation', mathml: UNSPOKEN }, text(' grows')),
    );
    expect(equationAt(changedInline.next)).toMatchObject({ display: 'inline', pos: inline });

    const block = startOf(state.doc, 'e1');
    const { handled, next } = run(
      selectAt(state, block),
      changeEquation(block, { display: 'block', mathml: UNSPOKEN, latex: 'E=m', numbered: false }),
    );
    expect(handled).toBe(true);
    expect(stored(next)[1]).toEqual({
      type: 'equation',
      id: 'e1',
      mathml: UNSPOKEN,
      latex: 'E=m',
      numbered: false,
    });
    expect(equationAt(next)).toMatchObject({ display: 'block', pos: block, id: 'e1' });
  });

  it('changes nothing where no equation stands, or where it would change which kind it is', () => {
    const state = stateOf(
      documentOf(paragraph('p1', text('Where '), squared), blockEquation('e1')),
    );
    expect(changeEquation(1, INLINE)(state)).toBe(false);
    expect(changeEquation(equationIn(state.doc), BLOCK)(state)).toBe(false);
    expect(changeEquation(startOf(state.doc, 'e1'), INLINE)(state)).toBe(false);
    expect(changeEquation(equationIn(state.doc), { ...INLINE, mathml: '<math/>' })(state)).toBe(
      false,
    );
  });
});

describe('Equation in the registry (equations 1)', () => {
  it('is a registry command on Ctrl or Cmd, Shift and E, which asks the renderer', () => {
    const entry = EDITOR_COMMANDS.find((command) => command.label === 'Equation');
    expect(entry).toEqual({
      kind: 'block',
      action: 'equation',
      label: 'Equation',
      shortcut: 'Mod-Shift-e',
      shortcutSaid: 'Ctrl or Cmd, Shift and E',
      prompts: true,
    });
    const state = everywhere();
    const homes = homesOf(state);
    const inText = caretIn(state, homes.caption!, 1);
    const inCode = caretIn(state, homes.preformatted!, 1);
    // As a block command it answers where an inline one could be placed - a caption holds no block,
    // and still an equation - and places nothing: its LaTeX is a value only the dialog can ask for.
    const equation = blockCommand('equation', counter());
    expect(equation(inText)).toBe(true);
    expect(equation(inCode)).toBe(false);
    expect(run(inText, equation).next.doc.eq(inText.doc)).toBe(true);
    const asked: string[] = [];
    const listening = commandKeymap(counter(), (name) => {
      asked.push(name);
      return true;
    });
    expect(listening['Mod-Shift-e']!(inText, () => undefined)).toBe(true);
    expect(listening['Mod-Shift-e']!(inCode, () => undefined)).toBe(false);
    expect(asked).toEqual(['equation']);
    expect(commandKeymap(counter())['Mod-Shift-e']!(inText, () => undefined)).toBe(false);
  });

  it('is available over an equation selected whole, a block one included, to change it', () => {
    const state = stateOf(documentOf(paragraph('p1', text('Where'), squared), blockEquation('e1')));
    const equation = blockCommand('equation', counter());
    expect(equation(selectAt(state, equationIn(state.doc)))).toBe(true);
    const block = selectAt(state, startOf(state.doc, 'e1'));
    expect(equationPlaceable(block, 'inline')).toBe(false);
    expect(equation(block)).toBe(true);
  });

  it("is available in a footnote's own text, as a reference is", () => {
    const outer = stateOf(
      documentOf(
        paragraph('p1', text('Visited'), {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [paragraph('fp1', text('Once'))],
        }),
      ),
    );
    expect(blockCommand('equation', counter())(footnoteState(outer, 'f1', 2))).toBe(true);
  });
});

describe('the editor stylesheet, for an equation (equations 1, ruling R5)', () => {
  it('sets a block on its own line with its number marker at the right, outlines one selected, and marks one undescribed or unshown by more than colour', () => {
    // Pinned in the stylesheet itself, as a reference's is: jsdom applies no stylesheet a package
    // ships.
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf-8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    // Every declaration of every rule whose selector list names this selector exactly.
    const rule = (selector: string) =>
      [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter((match) => match[1]!.split(',').some((each) => each.trim() === selector))
        .map((match) => match[2])
        .join(';');
    expect(rule('.aw-equation')).toMatch(/vertical-align:\s*baseline/);
    expect(rule('.aw-equation-block')).toMatch(/text-align:\s*center/);
    expect(rule('.aw-equation-block')).toMatch(/position:\s*relative/);
    expect(rule('.aw-equation-number')).toMatch(/position:\s*absolute/);
    expect(rule('.aw-equation-number')).toMatch(/right:\s*0/);
    expect(rule('.aw-equation.ProseMirror-selectednode')).toMatch(/outline:/);
    expect(rule('.aw-equation-block.ProseMirror-selectednode')).toMatch(/outline:/);
    expect(rule('.aw-equation-undescribed')).toMatch(/border:[^;]*dashed/);
    expect(rule('.aw-equation-unshown')).toMatch(/border:[^;]*dashed/);
  });

  it('keeps what an equation draws inside its own box, inline and as a block', () => {
    // The domain refuses the offsets Temml writes (`\raisebox`), and this is the second of the two:
    // MathML that reaches the surface by any route draws nothing over the lines around it or the
    // editor's controls (equations 1's final review, L3). An inline one is a box of its own so that
    // it can clip at all - an inline box does not.
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf-8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const rule = (selector: string) =>
      [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter((match) => match[1]!.split(',').some((each) => each.trim() === selector))
        .map((match) => match[2])
        .join(';');
    expect(rule('.aw-equation')).toMatch(/display:\s*inline-block/);
    for (const selector of ['.aw-equation', '.aw-equation-block']) {
      expect(rule(selector), selector).toMatch(/overflow:\s*clip/);
      expect(rule(selector), selector).toMatch(/overflow-clip-margin:/);
    }
  });

  it("draws the gap cursor, as prosemirror-gapcursor's own stylesheet does, only while the surface has the focus", () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf-8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const rule = (selector: string) =>
      [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter((match) => match[1]!.split(',').some((each) => each.trim() === selector))
        .map((match) => match[2])
        .join(';');
    expect(rule('.ProseMirror-gapcursor')).toMatch(/display:\s*none/);
    expect(rule('.ProseMirror-gapcursor')).toMatch(/position:\s*absolute/);
    expect(rule('.ProseMirror-gapcursor::after')).toMatch(/border-top:/);
    expect(rule('.ProseMirror-focused .ProseMirror-gapcursor')).toMatch(/display:\s*block/);
  });
});
