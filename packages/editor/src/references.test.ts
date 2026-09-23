import type {
  BlockNode,
  ContentDocument,
  CrossReferenceTarget,
  InlineNode,
  Mark,
} from '@alloy-works/domain';
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
import { fromEditor, toEditor } from './mapping.js';
import {
  commandKeymap,
  EDITOR_COMMANDS,
  markThroughout,
  somewhereToPutMark,
  toggleMarkCommand,
} from './marks.js';
import { changeReference, insertReference, referenceAt } from './references.js';
import { editorSchema } from './schema.js';
import { createEditorState, footnotePluginsOf } from './state.js';

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

/** A stored figure `g1`, captioned. */
const figure = (caption: InlineNode[]): BlockNode => ({
  type: 'figure',
  id: 'g1',
  asset: '00000000-0000-4000-8000-00000000a551',
  imageStyle: 'figure',
  caption,
  alternative: { kind: 'decorative' },
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

const TABLE_NUMBER = { target: { kind: 'block', block: 't1' }, display: 'number' } as const;

describe('placing and changing a cross-reference (cross-references 1)', () => {
  it('places one at the caret in a paragraph, selected whole and named as a block is', () => {
    const state = caretIn(
      stateOf(documentOf(paragraph('p1', text('See below.')), table([text('Readings')]))),
      0,
      3,
    );
    const { handled, next } = run(state, insertReference(TABLE_NUMBER));
    expect(handled).toBe(true);
    expect(stored(next)[0]).toEqual(paragraph('p1', text('See'), toTable('n1'), text(' below.')));
    expect(referenceAt(next)).toEqual({
      pos: 4,
      id: 'n1',
      target: { kind: 'block', block: 't1' },
      display: 'number',
      withoutPages: null,
    });
  });

  it('places it at the end of a selection, leaving the selected words where they are', () => {
    const state = select(stateOf(documentOf(paragraph('p1', text('See below.')))), 1, 4);
    const { next } = run(state, insertReference(TABLE_NUMBER));
    expect(stored(next)).toEqual([paragraph('p1', text('See'), toTable('n1'), text(' below.'))]);
  });

  it('places one in every inline home, and never in preformatted text or over a table', () => {
    const state = stateOf(
      documentOf(
        {
          type: 'list',
          id: 'l1',
          kind: 'definition',
          items: [{ term: [text('Load')], content: [paragraph('i1', text('Weight'))] }],
        },
        {
          type: 'blockquote',
          id: 'q1',
          content: [paragraph('b1', text('Said'))],
          attribution: [text('Ada')],
        },
        { ...table([text('Readings')]), note: [text('Estimated')] } as BlockNode,
        figure([text('Visits')]),
        { type: 'preformatted', id: 'pre1', text: 'code' },
      ),
    );
    const available = (at: EditorState) => insertReference(TABLE_NUMBER)(at);
    const term = startOf(state.doc, 'l1') + 2;
    const attribution =
      startOf(state.doc, 'b1') + state.doc.nodeAt(startOf(state.doc, 'b1'))!.nodeSize;
    const tableAt = startOf(state.doc, 't1');
    const homes: [string, number][] = [
      ['term', term],
      ['list item', startOf(state.doc, 'i1')],
      ['quotation', startOf(state.doc, 'b1')],
      ['attribution', attribution],
      ['caption', tableAt + 1],
      ['cell', startOf(state.doc, 'c1')],
      [
        'note',
        tableAt +
          state.doc.nodeAt(tableAt)!.nodeSize -
          1 -
          state.doc.nodeAt(tableAt)!.lastChild!.nodeSize,
      ],
      ['figure caption', startOf(state.doc, 'g1') + 1],
    ];
    for (const [name, start] of homes) {
      expect(state.doc.nodeAt(start)!.inlineContent, name).toBe(true);
      const at = caretIn(state, start, 1);
      expect(available(at), name).toBe(true);
      const { next } = run(at, insertReference(TABLE_NUMBER));
      expect(referenceAt(next), name).toMatchObject({ target: { kind: 'block', block: 't1' } });
      expect(() => fromEditor(next.doc), name).not.toThrow();
    }
    expect(available(caretIn(state, startOf(state.doc, 'pre1'), 1)), 'preformatted').toBe(false);
    const wholeTable = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, tableAt)));
    expect(available(wholeTable), 'a table selected whole').toBe(false);
  });

  it("places one in a footnote's own text, from its nested editor", () => {
    const outer = stateOf(
      documentOf(
        paragraph('p1', text('Visited'), {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [paragraph('fp1', text('Once'))],
        }),
        table([text('Readings')]),
      ),
    );
    const inside = footnoteState(outer, 'f1', 4);
    const { handled, next } = run(inside, insertReference(TABLE_NUMBER));
    expect(handled).toBe(true);
    expect(next.doc.firstChild!.lastChild!.type.name).toBe('crossReference');
    expect(blockCommand('reference', counter())(inside)).toBe(true);
  });

  it('answers the reference selected whole, and nothing for a caret or anything else', () => {
    const state = stateOf(
      documentOf(
        paragraph('p1', text('See '), {
          type: 'crossReference',
          id: 'x1',
          target: { kind: 'node', node: 'abcdefghijklmnopqrstuvwxyz' },
          display: 'page',
          withoutPages: 'title',
        }),
      ),
    );
    expect(referenceAt(state)).toBeNull();
    expect(referenceAt(selectWhole(state, 'x1'))).toEqual({
      pos: 5,
      id: 'x1',
      target: { kind: 'node', node: 'abcdefghijklmnopqrstuvwxyz' },
      display: 'page',
      withoutPages: 'title',
    });
    expect(referenceAt(selectWhole(state, 'p1'))).toBeNull();
  });

  it('changes a reference in place, keeping its identifier, and drops a form for no pages unless it is a page', () => {
    const state = selectWhole(
      stateOf(
        documentOf(
          paragraph('p1', text('See '), {
            type: 'crossReference',
            id: 'x1',
            target: { kind: 'block', block: 't1' },
            display: 'page',
            withoutPages: 'number',
          }),
          table([text('Readings')]),
          figure([text('Visits')]),
        ),
      ),
      'x1',
    );
    const pos = referenceAt(state)!.pos;
    // Still a page: the declared alternative is kept.
    const repointed = run(
      state,
      changeReference(pos, { target: { kind: 'block', block: 'g1' }, display: 'page' }),
    ).next;
    expect(referenceAt(repointed)).toEqual({
      pos,
      id: 'x1',
      target: { kind: 'block', block: 'g1' },
      display: 'page',
      withoutPages: 'number',
    });
    // No longer a page: the alternative goes, which the stored model would otherwise refuse.
    const { handled, next } = run(repointed, changeReference(pos, TABLE_NUMBER));
    expect(handled).toBe(true);
    expect(referenceAt(next)).toEqual({ pos, id: 'x1', ...TABLE_NUMBER, withoutPages: null });
    expect(stored(next)[0]).toEqual(paragraph('p1', text('See '), toTable('x1')));
    // Nothing to change where no reference stands.
    expect(changeReference(1, TABLE_NUMBER)(next)).toBe(false);
  });

  it('is a registry command, Reference, on Ctrl or Cmd, Alt and X, which asks the renderer', () => {
    const entry = EDITOR_COMMANDS.find((command) => command.label === 'Reference');
    expect(entry).toEqual({
      kind: 'block',
      action: 'reference',
      label: 'Reference',
      shortcut: 'Mod-Alt-x',
      shortcutSaid: 'Ctrl or Cmd, Alt and X',
      prompts: true,
    });
    const state = stateOf(
      documentOf(paragraph('p1', text('See')), { type: 'preformatted', id: 'pre1', text: 'code' }),
    );
    const inText = caretIn(state, startOf(state.doc, 'p1'), 3);
    const inCode = caretIn(state, startOf(state.doc, 'pre1'), 1);
    // As a block command it answers where one could be placed, and places nothing: its target is a
    // value only the renderer's dialog can ask for.
    const reference = blockCommand('reference', counter());
    expect(reference(inText)).toBe(true);
    expect(reference(inCode)).toBe(false);
    expect(run(inText, reference).next.doc.eq(inText.doc)).toBe(true);
    // Its shortcut is handed to the renderer where one could be placed, and nowhere else.
    const asked: string[] = [];
    const listening = commandKeymap(counter(), (name) => {
      asked.push(name);
      return true;
    });
    expect(listening['Mod-Alt-x']!(inText, () => undefined)).toBe(true);
    expect(listening['Mod-Alt-x']!(inCode, () => undefined)).toBe(false);
    expect(asked).toEqual(['reference']);
    expect(commandKeymap(counter())['Mod-Alt-x']!(inText, () => undefined)).toBe(false);
  });
});
