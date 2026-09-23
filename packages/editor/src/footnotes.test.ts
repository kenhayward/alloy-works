import type { BlockNode, ContentDocument, InlineNode, Mark } from '@alloy-works/domain';
import { joinBackward, selectNodeBackward } from 'prosemirror-commands';
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

import { pasteInto, readClipboard } from './clipboard.js';
import { footnoteAt, insertFootnote } from './footnotes.js';
import { fromEditor, toEditor } from './mapping.js';
import {
  EDITOR_COMMANDS,
  markAt,
  markThroughout,
  removeMarkCommand,
  spansOf,
  toggleMarkCommand,
} from './marks.js';
import { editorSchema } from './schema.js';
import { createEditorState, footnotePluginsOf, placeholderDecorations } from './state.js';
import { tableAt, tableCommand } from './tables.js';

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};

const text = (value: string, ...marks: Mark[]): InlineNode => ({ type: 'text', value, marks });
const emphasis = (id: string): Mark => ({ type: 'emphasis', id });
const link = (id: string): Mark => ({ type: 'hyperlink', id, href: 'https://example.org/' });
const paragraph = (id: string, ...content: InlineNode[]): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
type Anchor = Extract<InlineNode, { type: 'footnote' }>['anchor'];
const footnote = (
  id: string,
  paragraphs: BlockNode[],
  anchor: Anchor = { kind: 'span' },
): InlineNode => ({ type: 'footnote', id, anchor, content: paragraphs });
const table = (cells: BlockNode[][], extra: Record<string, unknown> = {}): BlockNode =>
  ({
    type: 'table',
    id: 't1',
    style: 'table',
    caption: [text('Readings')],
    headerRows: 0,
    headerColumns: 0,
    rows: [{ cells: cells.map((content) => ({ content, colspan: 1, rowspan: 1 })) }],
    ...extra,
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

/** Where the node carrying this identifier starts. */
function startOf(doc: Node, id: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found === -1 && node.attrs.id === id) found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error(`no ${id}`);
  return found;
}

const caret = (state: EditorState, pos: number) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));

/** The caret this many characters into the textblock carrying that identifier. */
const into = (state: EditorState, id: string, offset = 0) =>
  caret(state, startOf(state.doc, id) + 1 + offset);

const selectWhole = (state: EditorState, id: string) =>
  state.apply(state.tr.setSelection(NodeSelection.create(state.doc, startOf(state.doc, id))));

function run(state: EditorState, command: Command) {
  let next = state;
  const handled = command(state, (tr: Transaction) => (next = next.apply(tr)));
  return { handled, next };
}

const stored = (state: EditorState) => fromEditor(state.doc).content;

const KEY_CODES: Record<string, number> = { Enter: 13, Backspace: 8, Delete: 46, f: 70 };

/** A key through the state's own keymaps, in the order the view consults them. */
function press(
  state: EditorState,
  key: string,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
) {
  let next = state;
  const view = {
    get state() {
      return next;
    },
    dispatch: (tr: Transaction) => {
      next = next.apply(tr);
    },
    endOfTextblock: (dir: string) => {
      const { $head } = next.selection;
      return dir === 'backward' || dir === 'up'
        ? $head.parentOffset === 0
        : $head.parentOffset === $head.parent.content.size;
    },
  };
  const event = {
    key,
    keyCode: KEY_CODES[key] ?? 0,
    shiftKey: modifiers.shift ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
    metaKey: false,
  };
  for (const plugin of state.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (handler === undefined) continue;
    if (handler.call(plugin, view as never, event as never)) return { handled: true, next };
  }
  return { handled: false, next };
}

/** The footnote's own editing state, as its nested editor holds it: its node is the document. */
function footnoteState(outer: EditorState, id: string, offset = 0): EditorState {
  const node = outer.doc.nodeAt(startOf(outer.doc, id))!;
  const state = EditorState.create({ doc: node, plugins: footnotePluginsOf(outer)(() => 'en-GB') });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1 + offset)));
}

describe('a footnote in the editor (footnotes 1)', () => {
  it('CNT-036 opens a footnote anchored to a span in running text and stores it back exactly', () => {
    const document = documentOf(
      paragraph(
        'p1',
        text('Visited twice'),
        footnote('f1', [
          paragraph('fp1', text('Once in '), text('spring', emphasis('e1')), text('.')),
          paragraph('fp2', text('Once in autumn.')),
        ]),
        text(' last year.'),
      ),
    );
    const opened = toEditor(document);
    if (!opened.editable) throw new Error(opened.unsupported.join(', '));
    expect(fromEditor(opened.doc).content).toEqual(document.content);
  });

  it('keeps an anchor by key, by position and to the table as stored, which nothing edits', () => {
    for (const anchor of [
      { kind: 'cell', key: 'north' },
      { kind: 'cellPosition', row: 0, column: 0 },
      { kind: 'table' },
    ] as const) {
      const document = documentOf(
        table([[paragraph('c1', text('North'), footnote('f1', [paragraph('fp1')], anchor))]]),
      );
      expect(stored(stateOf(document)), anchor.kind).toEqual(document.content);
    }
  });

  it('opens a footnote in a list item, a quotation and a table cell for editing', () => {
    const inList: BlockNode = {
      type: 'list',
      id: 'l1',
      kind: 'unordered',
      items: [{ content: [paragraph('i1', text('Item'), footnote('f1', [paragraph('fp1')]))] }],
    };
    const inQuotation: BlockNode = {
      type: 'blockquote',
      id: 'q1',
      content: [paragraph('b1', text('Said'), footnote('f2', [paragraph('fp2')]))],
    };
    const inCell = table([[paragraph('c1', text('Cell'), footnote('f3', [paragraph('fp3')]))]]);
    const document = documentOf(inList, inQuotation, inCell);
    expect(stored(stateOf(document))).toEqual(document.content);
  });

  it('opens a component read-only, naming it, where a footnote stands anywhere but a paragraph', () => {
    const inCaption = table([[paragraph('c1')]], {
      caption: [text('Readings'), footnote('f1', [paragraph('fp1')])],
    });
    const inNote = table([[paragraph('c1')]], {
      note: [text('Estimated'), footnote('f1', [paragraph('fp1')])],
    });
    const inAttribution: BlockNode = {
      type: 'blockquote',
      id: 'q1',
      content: [paragraph('b1', text('Said'))],
      attribution: [text('Ada'), footnote('f1', [paragraph('fp1')])],
    };
    const inTerm: BlockNode = {
      type: 'list',
      id: 'l1',
      kind: 'definition',
      items: [
        { term: [text('Word'), footnote('f1', [paragraph('fp1')])], content: [paragraph('d1')] },
      ],
    };
    for (const block of [inCaption, inNote, inAttribution, inTerm]) {
      expect(toEditor(documentOf(block))).toEqual({ editable: false, unsupported: ['footnote'] });
    }
  });

  it('opens a component read-only, naming it, where a footnote holds what the editor has no mark for', () => {
    const document = documentOf(
      paragraph(
        'p1',
        text('Visited'),
        footnote('f1', [
          paragraph('fp1', text('see', { type: 'comment', id: 'm1', threadId: 'th1' })),
        ]),
      ),
    );
    expect(toEditor(document)).toEqual({ editable: false, unsupported: ['mark:comment'] });
  });

  it("holds nothing in a footnote's paragraphs that CNT-129 excludes, by its content expressions", () => {
    const { nodes } = editorSchema;
    const image = nodes.image!.create({ asset: 'a1', alternative: { kind: 'decorative' } });
    const inner = nodes.footnote!.create(
      { id: 'f2' },
      nodes.footnoteParagraph!.create({ id: 'x' }),
    );
    expect(nodes.footnoteParagraph!.validContent(Fragment.from(image))).toBe(false);
    expect(nodes.footnoteParagraph!.validContent(Fragment.from(inner))).toBe(false);
    expect(nodes.footnote!.validContent(Fragment.from(nodes.paragraph!.create()))).toBe(false);
    expect(nodes.footnote!.validContent(Fragment.empty)).toBe(false);
  });
});

describe('placing and deleting a footnote (footnotes 1)', () => {
  it('CNT-036 places a footnote anchored to its span at the cursor in a paragraph, selected whole', () => {
    const state = into(stateOf(documentOf(paragraph('p1', text('Visited twice.')))), 'p1', 13);
    const { handled, next } = run(state, insertFootnote(counter('new')));
    expect(handled).toBe(true);
    // Named by the identity plugin, which names whatever a command places (ADR-0023).
    expect(stored(next)).toEqual([
      paragraph('p1', text('Visited twice'), footnote('n1', [paragraph('n2')]), text('.')),
    ]);
    expect(footnoteAt(next)).toEqual({ pos: 14, id: 'n1' });
  });

  it('places it at the end of a selection, leaving the selected words where they are', () => {
    const state = stateOf(documentOf(paragraph('p1', text('Visited twice.'))));
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 8)));
    const { next } = run(selected, insertFootnote(counter('new')));
    expect(stored(next)).toEqual([
      paragraph('p1', text('Visited'), footnote('n1', [paragraph('n2')]), text(' twice.')),
    ]);
  });

  it('places one in a list item, a quotation and a table cell, and nowhere else', () => {
    const quotation: BlockNode = {
      type: 'blockquote',
      id: 'q1',
      content: [paragraph('b1', text('Said'))],
      attribution: [text('Ada')],
    };
    const state = stateOf(
      documentOf(
        {
          type: 'list',
          id: 'l1',
          kind: 'unordered',
          items: [{ content: [paragraph('i1', text('Item'))] }],
        },
        quotation,
        table([[paragraph('c1', text('Cell'))]]),
        { type: 'preformatted', id: 'pre1', text: 'code' },
      ),
    );
    const available = (at: EditorState) => insertFootnote(counter())(at);
    for (const id of ['i1', 'b1', 'c1']) expect(available(into(state, id, 1)), id).toBe(true);
    expect(available(into(state, 'pre1', 1)), 'preformatted').toBe(false);
    // The attribution and the caption carry no identifier: the caret stands just inside each.
    const attribution =
      startOf(state.doc, 'b1') + state.doc.nodeAt(startOf(state.doc, 'b1'))!.nodeSize;
    expect(available(caret(state, attribution + 1)), 'attribution').toBe(false);
    expect(available(caret(state, startOf(state.doc, 't1') + 2)), 'caption').toBe(false);
  });

  it("declines in a footnote's own paragraph, whatever key or button asks", () => {
    const outer = stateOf(
      documentOf(
        paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1', text('Once'))])),
      ),
    );
    const inside = footnoteState(outer, 'f1', 2);
    expect(insertFootnote(counter())(inside)).toBe(false);
    expect(press(inside, 'f', { ctrl: true, alt: true }).handled).toBe(false);
  });

  it('is a registry command, Footnote, on Ctrl or Cmd, Alt and F, which the keymap runs', () => {
    const entry = EDITOR_COMMANDS.find((command) => command.label === 'Footnote');
    expect(entry).toMatchObject({
      kind: 'block',
      action: 'footnote',
      shortcut: 'Mod-Alt-f',
      shortcutSaid: 'Ctrl or Cmd, Alt and F',
    });
    const state = into(stateOf(documentOf(paragraph('p1', text('Visited')))), 'p1', 7);
    const { handled, next } = press(state, 'f', { ctrl: true, alt: true });
    expect(handled).toBe(true);
    expect(footnoteAt(next)).not.toBeNull();
  });

  it('Enter on a footnote selected whole is taken, and never splits the paragraph over it', () => {
    const document = documentOf(
      paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1')]), text(' twice.')),
    );
    const pressed = press(selectWhole(stateOf(document), 'f1'), 'Enter');
    expect(pressed.handled).toBe(true);
    expect(stored(pressed.next)).toEqual(document.content);
  });

  it('deletes the footnote with its mark, and undo brings it back whole, newly named', () => {
    const document = documentOf(
      paragraph(
        'p1',
        text('Visited'),
        footnote('f1', [paragraph('fp1', text('Once.')), paragraph('fp2', text('Twice.'))]),
        text(' twice.'),
      ),
    );
    const selected = selectWhole(stateOf(document), 'f1');
    const deleted = selected.apply(selected.tr.deleteSelection());
    expect(stored(deleted)).toEqual([paragraph('p1', text('Visited twice.'))]);
    // Whole, under new identifiers: what an undo puts back is placed, and ADR-0023's descent rule
    // names whatever is placed, as it does a block brought back the same way.
    const restored = stored(run(deleted, undo).next);
    const unnamed = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(unnamed)
        : typeof value === 'object' && value !== null
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => key !== 'id')
                .map(([key, member]) => [key, unnamed(member)]),
            )
          : value;
    expect(unnamed(restored)).toEqual(unnamed(document.content));
  });
});

describe('marks around and inside a footnote (footnotes 1)', () => {
  it('a footnote placed inside emphasised words carries no mark, and the emphasis stays one', () => {
    const state = into(
      stateOf(documentOf(paragraph('p1', text('Visited twice', emphasis('e1'))))),
      'p1',
      7,
    );
    const { next } = run(state, insertFootnote(counter('new')));
    const node = next.doc.nodeAt(footnoteAt(next)!.pos)!;
    expect(node.marks).toEqual([]);
    expect(stored(next)).toEqual([
      paragraph(
        'p1',
        text('Visited', emphasis('e1')),
        footnote('n1', [paragraph('n2')]),
        text(' twice', emphasis('e1')),
      ),
    ]);
  });

  it("an annotation either side of a footnote is one, and the footnote's text is a range of its own", () => {
    const state = stateOf(
      documentOf(
        paragraph(
          'p1',
          text('Visited', emphasis('e1')),
          footnote('f1', [paragraph('fp1', text('Once', emphasis('e1')))]),
          text(' twice', emphasis('e1')),
        ),
      ),
      counter('fresh'),
    );
    // Any change runs the repair; the one inside the footnote is a second piece and is renamed.
    const next = state.apply(state.tr.insertText('!', state.doc.content.size - 1));
    const spans = spansOf(next.doc, editorSchema.marks.emphasis!);
    expect(spans.map((span) => span.mark.attrs.id)).toEqual(['e1', 'fresh1']);
    expect(stored(next)).toEqual([
      paragraph(
        'p1',
        text('Visited', emphasis('e1')),
        footnote('f1', [paragraph('fp1', text('Once', emphasis('fresh1')))]),
        text(' twice!', emphasis('e1')),
      ),
    ]);
  });

  it("a mark put on, or taken off, over a range holding a footnote leaves the footnote's text as it was", () => {
    const document = documentOf(
      paragraph(
        'p1',
        text('Visited'),
        footnote('f1', [paragraph('fp1', text('Once'), text('Twice', link('k2')))]),
        text(' twice'),
      ),
    );
    const state = stateOf(document);
    const all = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
    );
    const strong = run(all, toggleMarkCommand('strong', counter('s'))).next;
    expect(markThroughout(strong, 'strong')).toBe(true);
    expect(stored(strong)).toEqual([
      paragraph(
        'p1',
        text('Visited', { type: 'strong', id: 's1' }),
        footnote('f1', [paragraph('fp1', text('Once'), text('Twice', link('k2')))]),
        text(' twice', { type: 'strong', id: 's1' }),
      ),
    ]);

    const linked = stateOf(
      documentOf(
        paragraph(
          'p1',
          text('Visited', link('k1')),
          footnote('f1', [paragraph('fp1', text('Once', link('k2')))]),
          text(' twice', link('k1')),
        ),
      ),
    );
    const unlinked = run(into(linked, 'p1', 2), removeMarkCommand('hyperlink')).next;
    expect(stored(unlinked)).toEqual([
      paragraph(
        'p1',
        text('Visited'),
        footnote('f1', [paragraph('fp1', text('Once', link('k2')))]),
        text(' twice'),
      ),
    ]);
  });

  it("reads a range's marks past a footnote's text", () => {
    const state = stateOf(
      documentOf(
        paragraph(
          'p1',
          text('Visited'),
          footnote('f1', [paragraph('fp1', text('Once', link('k2')))]),
          text(' twice'),
        ),
      ),
    );
    const all = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
    );
    expect(markAt(all, 'hyperlink')).toBeNull();
  });

  it('what is typed straight after a footnote carries on the marks it stands in', () => {
    const state = stateOf(
      documentOf(
        paragraph(
          'p1',
          text('Visited', emphasis('e1')),
          footnote('f1', [paragraph('fp1')]),
          text(' twice', emphasis('e1')),
        ),
      ),
    );
    const after = startOf(state.doc, 'f1') + state.doc.nodeAt(startOf(state.doc, 'f1'))!.nodeSize;
    const at = caret(state, after);
    const typed = at.apply(at.tr.insertText('!'));
    expect(stored(typed)).toEqual([
      paragraph(
        'p1',
        text('Visited', emphasis('e1')),
        footnote('f1', [paragraph('fp1')]),
        text('! twice', emphasis('e1')),
      ),
    ]);
  });

  it("the nine marks apply in a footnote's own paragraphs from their shortcuts", () => {
    const outer = stateOf(
      documentOf(
        paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1', text('Once'))])),
      ),
    );
    const inside = footnoteState(outer, 'f1');
    const selected = inside.apply(inside.tr.setSelection(TextSelection.create(inside.doc, 1, 5)));
    const { handled, next } = press(selected, 'b', { ctrl: true });
    expect(handled).toBe(true);
    expect(next.doc.firstChild!.firstChild!.marks.map((mark) => mark.type.name)).toEqual([
      'strong',
    ]);
  });

  it("every block command declines in a footnote's own paragraphs", () => {
    const outer = stateOf(
      documentOf(
        paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1', text('Once'))])),
      ),
    );
    const inside = footnoteState(outer, 'f1', 1);
    for (const command of EDITOR_COMMANDS) {
      if (command.kind !== 'block') continue;
      const [modifiers, key] = [
        command.shortcut.split('-').slice(0, -1),
        command.shortcut.split('-').at(-1)!,
      ];
      const pressed = press(inside, key, {
        ctrl: modifiers.includes('Mod'),
        alt: modifiers.includes('Alt'),
        shift: modifiers.includes('Shift'),
      });
      expect(pressed.next.doc.eq(inside.doc), command.label).toBe(true);
    }
  });
});

describe("identity and emptiness in a footnote's paragraphs (footnotes 1)", () => {
  it('gives a copied footnote and its paragraphs identifiers of their own', () => {
    const state = stateOf(
      documentOf(
        paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1', text('Once'))])),
      ),
      counter('fresh'),
    );
    const node = state.doc.nodeAt(startOf(state.doc, 'f1'))!;
    const next = state.apply(state.tr.insert(1, node));
    const ids: string[] = [];
    next.doc.descendants((each) => {
      if (typeof each.attrs.id === 'string') ids.push(each.attrs.id);
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['f1', 'fp1', 'fresh1', 'fresh2']));
  });

  it('refuses two adjacent empty paragraphs in a footnote, as anywhere else', () => {
    const state = stateOf(
      documentOf(paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1')]))),
    );
    const inside = startOf(state.doc, 'fp1') + 2;
    const next = state.apply(
      state.tr.insert(inside, editorSchema.nodes.footnoteParagraph!.create({ id: 'fp2' })),
    );
    expect(stored(next)).toEqual([
      paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1')])),
    ]);
  });

  it('Enter in an empty footnote paragraph does nothing, and splits one that holds text', () => {
    const outer = stateOf(
      documentOf(paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1')]))),
    );
    const empty = footnoteState(outer, 'f1');
    const pressed = press(empty, 'Enter');
    expect(pressed.handled).toBe(true);
    expect(pressed.next.doc.childCount).toBe(1);

    const holding = footnoteState(
      stateOf(
        documentOf(
          paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1', text('Once'))])),
        ),
      ),
      'f1',
      4,
    );
    const split = press(holding, 'Enter').next;
    expect(split.doc.childCount).toBe(2);
    expect(split.doc.child(1).type.name).toBe('footnoteParagraph');
  });
});

describe("a table's note (footnotes 1)", () => {
  const withNote = (note?: InlineNode[]) =>
    stateOf(documentOf(table([[paragraph('c1', text('North'))]], note ? { note } : {})));

  it('CNT-038 opens a stored note beneath the table and stores it back exactly', () => {
    const document = documentOf(
      table([[paragraph('c1', text('North'))]], {
        note: [text('Figures are '), text('estimated', emphasis('e1')), text('.')],
      }),
    );
    expect(stored(stateOf(document))).toEqual(document.content);
  });

  it('CNT-038 adds a note from the Table panel, puts the cursor in it, and stores what is typed', () => {
    const state = into(withNote(), 'c1', 1);
    expect(tableAt(state)?.note).toBe(false);
    const added = run(state, tableCommand('addNote'));
    expect(added.handled).toBe(true);
    expect(added.next.selection.$from.parent.type.name).toBe('tableNote');
    expect(tableAt(added.next)?.note).toBe(true);
    const typed = added.next.apply(added.next.tr.insertText('Estimated.'));
    expect(stored(typed)).toEqual([
      table([[paragraph('c1', text('North'))]], { note: [text('Estimated.')] }),
    ]);
  });

  it('stores a note of no text as none', () => {
    const added = run(into(withNote(), 'c1', 1), tableCommand('addNote')).next;
    expect(stored(added)).toEqual([table([[paragraph('c1', text('North'))]])]);
  });

  it('removes the note, and offers each of the two only where it would do something', () => {
    const state = into(withNote([text('Estimated.')]), 'c1', 1);
    expect(tableCommand('addNote')(state)).toBe(false);
    const removed = run(state, tableCommand('removeNote'));
    expect(removed.handled).toBe(true);
    expect(stored(removed.next)).toEqual([table([[paragraph('c1', text('North'))]])]);
    expect(tableCommand('removeNote')(removed.next)).toBe(false);
    const outside = stateOf(documentOf(paragraph('p1', text('Plain'))));
    expect(tableCommand('addNote')(into(outside, 'p1'))).toBe(false);
  });

  it('Enter in the note leaves the table for a paragraph after it', () => {
    const state = withNote([text('Estimated.')]);
    const note = state.doc.firstChild!.lastChild!;
    const end = state.doc.firstChild!.nodeSize - 2;
    expect(note.type.name).toBe('tableNote');
    const pressed = press(caret(state, end), 'Enter');
    expect(pressed.handled).toBe(true);
    expect(pressed.next.doc.childCount).toBe(2);
    expect(pressed.next.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('Backspace at the start of the note never reaches into the table', () => {
    const state = withNote([text('Estimated.')]);
    const start = state.doc.firstChild!.nodeSize - 2 - 'Estimated.'.length;
    const at = caret(state, start);
    const view = { endOfTextblock: () => true, state: at };
    expect(joinBackward(at, () => undefined, view as never)).toBe(false);
    expect(selectNodeBackward(at, () => undefined, view as never)).toBe(false);
  });

  it('shows an empty note its placeholder', () => {
    const added = run(into(withNote(), 'c1', 1), tableCommand('addNote')).next;
    const names = placeholderDecorations(added.doc)
      .find()
      .map((decoration) => added.doc.nodeAt(decoration.from)!.type.name);
    expect(names).toContain('tableNote');
  });
});

describe('a paste into a footnote (footnotes 1)', () => {
  const clipboard = (plain: string) => ({
    types: ['text/plain'],
    getData: (type: string) => (type === 'text/plain' ? plain : ''),
  });

  it("goes through admission, and its paragraphs become the footnote's", () => {
    const state = stateOf(
      documentOf(paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1')]))),
    );
    const at = caret(state, startOf(state.doc, 'fp1') + 1);
    const outcome = pasteInto(
      at,
      readClipboard(clipboard('Once.\n\nTwice.'), 'blocks'),
      counter('p'),
    );
    if (!outcome.ok) throw new Error(outcome.report.at(-1)?.message);
    const content = stored(at.apply(outcome.transaction));
    const note = (content[0] as Extract<BlockNode, { type: 'paragraph' }>).content[1]!;
    expect(note).toMatchObject({ type: 'footnote', id: 'f1' });
    const paragraphs = (note as Extract<InlineNode, { type: 'footnote' }>).content as BlockNode[];
    expect(paragraphs.map((each) => (each as { content: InlineNode[] }).content)).toEqual([
      [text('Once.')],
      [text('Twice.')],
    ]);
  });

  it('refuses a list, saying what could not be placed', () => {
    const state = stateOf(
      documentOf(paragraph('p1', text('Visited'), footnote('f1', [paragraph('fp1')]))),
    );
    const at = caret(state, startOf(state.doc, 'fp1') + 1);
    const outcome = pasteInto(
      at,
      readClipboard(
        { types: ['text/html'], getData: () => '<ul><li>One</li><li>Two</li></ul>' },
        'blocks',
      ),
      counter('p'),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.report.map((entry) => entry.detail)).toContain('list');
  });
});
