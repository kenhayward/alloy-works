import type {
  BlockNode,
  ContentDocument,
  CrossReferenceTarget,
  InlineNode,
  Mark,
} from '@alloy-works/domain';
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

/** A reference node as the editor holds one, to a block of the component unless told otherwise. */
const reference = (
  target: CrossReferenceTarget = { kind: 'block', block: 't1' },
  extra: Record<string, unknown> = {},
): Node => nodes.crossReference!.create({ id: 'x1', target, display: 'number', ...extra });

describe('a cross-reference in the editor schema (cross-references 1)', () => {
  it('is an inline atom, selectable whole, carrying no marks, with its four attributes', () => {
    const type = nodes.crossReference!;
    expect(type.isInline).toBe(true);
    expect(type.isAtom).toBe(true);
    expect(type.isLeaf).toBe(true);
    expect(type.spec.selectable).toBe(true);
    expect(type.spec.draggable).toBe(false);
    expect(type.spec.marks).toBe('');
    // An identifier the identity plugin fills, and no form for an output with no pages until one is
    // stored: absent in the stored model, null here. A target and a form have no default: nothing
    // makes a reference without choosing both.
    const target = { kind: 'block', block: 't1' } as const;
    expect(type.create({ target, display: 'page' }).attrs).toEqual({
      id: null,
      target,
      display: 'page',
      withoutPages: null,
    });
    expect(() => type.create({ target })).toThrow(/display/);
  });

  it('stands wherever inline content does, and never in preformatted text', () => {
    const one = Fragment.from(reference());
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

  it('renders a span a reader sees, saying Section for a section and Reference otherwise', () => {
    const spec = nodes.crossReference!.spec;
    expect(spec.toDOM!(reference())).toEqual([
      'span',
      { class: 'aw-reference', 'data-reference': '' },
      'Reference',
    ]);
    expect(spec.toDOM!(reference({ kind: 'node', node: 'n1' }))).toEqual([
      'span',
      { class: 'aw-reference', 'data-reference': '' },
      'Section',
    ]);
    // No parse rule, for a footnote's reason: a reference enters a component through its command or
    // the product's own clipboard alone, never guessed from an element.
    expect(spec.parseDOM).toBeUndefined();
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
/** A stored reference to the table `t1`, showing its number. */
const toTable = (id = 'x1'): InlineNode => ({
  type: 'crossReference',
  id,
  target: { kind: 'block', block: 't1' },
  display: 'number',
});
const table = (caption: InlineNode[]): BlockNode =>
  ({
    type: 'table',
    id: 't1',
    style: 'table',
    caption,
    headerRows: 0,
    headerColumns: 0,
    rows: [{ cells: [{ content: [paragraph('c1', text('North'))], colspan: 1, rowspan: 1 }] }],
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

const select = (state: EditorState, from: number, to = from) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));

const selectWhole = (state: EditorState, id: string) =>
  state.apply(state.tr.setSelection(NodeSelection.create(state.doc, startOf(state.doc, id))));

function run(state: EditorState, command: Command) {
  let next = state;
  const handled = command(state, (tr: Transaction) => (next = next.apply(tr)));
  return { handled, next };
}

const stored = (state: EditorState) => fromEditor(state.doc).content;

/** Every reference's marks, by type name, in document order. */
const referenceMarks = (state: EditorState): string[][] => {
  const found: string[][] = [];
  state.doc.descendants((node) => {
    if (node.type.name === 'crossReference') found.push(node.marks.map((mark) => mark.type.name));
  });
  return found;
};

/** The whole of the inline content of the textblock starting at `start`. */
const wholeOf = (state: EditorState, start: number) =>
  select(state, start + 1, start + state.doc.nodeAt(start)!.nodeSize - 1);

describe('marks around a cross-reference (cross-references 1)', () => {
  it('a mark put over words and a reference rests on the words alone, as one annotation', () => {
    const state = stateOf(
      documentOf(
        paragraph('p1', text('See '), toTable(), text(' below')),
        table([text('Readings, as '), toTable('x2'), text(' says')]),
      ),
    );
    // Over the whole paragraph, and over the whole of the table's caption: a caption is a home an
    // image never stood in, so nothing about images reached it before.
    let next = run(
      wholeOf(state, startOf(state.doc, 'p1')),
      toggleMarkCommand('strong', counter('s')),
    ).next;
    next = run(
      wholeOf(next, startOf(next.doc, 't1') + 1),
      toggleMarkCommand('strong', counter('k')),
    ).next;
    expect(referenceMarks(next)).toEqual([[], []]);
    expect(stored(next)[0]).toEqual(
      paragraph('p1', text('See ', strong('s1')), toTable(), text(' below', strong('s1'))),
    );
    expect((stored(next)[1] as { caption: unknown }).caption).toEqual([
      text('Readings, as ', strong('k1')),
      toTable('x2'),
      text(' says', strong('k1')),
    ]);
    // And on over it: the selection is bold throughout, the reference carrying nothing to be.
    expect(markThroughout(wholeOf(next, startOf(next.doc, 'p1')), 'strong')).toBe(true);
  });

  it('takes a mark off over a selection holding a reference, where the button says it is on', () => {
    const state = stateOf(
      documentOf(
        paragraph('p1', text('See ', strong('s1')), toTable(), text(' below', strong('s1'))),
      ),
    );
    const all = wholeOf(state, startOf(state.doc, 'p1'));
    expect(markThroughout(all, 'strong')).toBe(true);
    const next = run(all, toggleMarkCommand('strong', counter())).next;
    expect(stored(next)).toEqual([paragraph('p1', text('See '), toTable(), text(' below'))]);
  });

  it('an annotation either side of a reference stays one, whatever is typed after it', () => {
    const state = stateOf(
      documentOf(
        paragraph('p1', text('See ', emphasis('e1')), toTable(), text(' below', emphasis('e1'))),
        table([text('As ', link('k1')), toTable('x2'), text(' said', link('k1'))]),
      ),
      counter('fresh'),
    );
    // A caret straight after the reference, in the paragraph and in the caption: what is typed there
    // carries on the annotation it stands in, rather than splitting it in two.
    let next = select(state, startOf(state.doc, 'x1') + 1);
    next = next.apply(next.tr.insertText('!'));
    next = select(next, startOf(next.doc, 'x2') + 1);
    next = next.apply(next.tr.insertText('?'));
    expect(stored(next)).toEqual([
      paragraph('p1', text('See ', emphasis('e1')), toTable(), text('! below', emphasis('e1'))),
      table([text('As ', link('k1')), toTable('x2'), text('? said', link('k1'))]),
    ]);
  });

  it('offers nowhere to put a mark on a reference selected whole', () => {
    const state = stateOf(documentOf(paragraph('p1', text('See '), toTable(), text(' below'))));
    expect(somewhereToPutMark(selectWhole(state, 'x1'), 'hyperlink')).toBe(false);
  });
});
