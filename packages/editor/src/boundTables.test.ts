import {
  bindingDigestInput,
  parseContentDocument,
  type Binding,
  type BlockNode,
  type BoundTableNode,
  type CanonicalResult,
  type ContentDocument,
  type TableColumn,
} from '@alloy-works/domain';
import { GapCursor } from 'prosemirror-gapcursor';
import type { Node, ResolvedPos } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import {
  bindingsShown,
  boundTablesShown,
  PAGE_ROWS,
  TABLE_CHANGED,
  TABLE_NEVER_RESOLVED,
  TABLE_READING,
  type BindingContext,
  type BindingHeld,
  type BoundTableShown,
  type TableHeld,
} from './bindings.js';
import { bindingDecorations } from './bindingView.js';
import { PRODUCT_CLIPBOARD_TYPE, pasteInto, productClipboard, readClipboard } from './clipboard.js';
import { fromEditor, toEditor } from './mapping.js';
import { createEditorState } from './state.js';

/**
 * A bound table in the editor (the TB2 plan, task 2): its stored members mapped losslessly to the
 * `boundTable` node and back, what its body shows - by the one pure rule the surface and the read text
 * draw from - its binding's identity across a copy and a cut, and a body nothing can delete alone. The
 * drawing itself is the renderer's, tested there.
 */

const QUERY = '00000000-0000-4000-8000-00000000d001';
const text = (value: string) => ({ type: 'text' as const, value, marks: [] });

const tableBinding = (id: string, over: Partial<BoundTableNode['binding']> = {}) => ({
  type: 'binding' as const,
  id,
  query: QUERY,
  parameters: {},
  mode: 'checked' as const,
  ...over,
});

const inlineBinding = (id: string): Binding => ({
  type: 'binding',
  id,
  query: QUERY,
  parameters: { site: { literal: 'north' } },
  mode: 'checked',
  take: { column: 'site' },
});

const boundTable = (over: Partial<BoundTableNode> = {}): BoundTableNode => ({
  type: 'boundTable',
  id: 't1',
  style: 'table',
  binding: tableBinding('k1'),
  caption: [text('Readings')],
  columns: [
    { column: 'site', header: 'Site' },
    { column: 'depth', header: 'Depth', unit: { text: 'm', place: 'header' } },
  ],
  headerColumn: false,
  ...over,
});

const paragraph = (id: string, ...content: unknown[]): BlockNode =>
  ({ type: 'paragraph', id, style: 'body', content }) as BlockNode;

const documentOf = (...content: BlockNode[]): ContentDocument =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Sites',
    language: 'en-GB',
    direction: 'ltr',
    content,
  });

const opened = (document: ContentDocument): Node => {
  const editor = toEditor(document);
  if (!editor.editable) throw new Error(editor.unsupported.join(', '));
  return editor.doc;
};

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};

const stateOf = (document: ContentDocument, bindingContext: BindingContext | null = null) =>
  createEditorState({ doc: opened(document), newIdentifier: counter(), bindingContext });

const DECLARED: TableColumn[] = [
  { name: 'site', type: { base: 'text' } },
  { name: 'depth', type: { base: 'decimal', precision: 10, scale: 2 } },
];

const rowsOf = (count: number): CanonicalResult => ({
  columns: [
    ['site', 'text'],
    ['depth', 'decimal'],
  ],
  rows: Array.from({ length: count }, (_, at) => [`S${at}`, `${at}.5`]),
});

const heldTable = (table: TableHeld, binding = tableBinding('k1')): [string, BindingHeld] => [
  binding.id,
  { binding: bindingDigestInput(binding), shown: { table } },
];

const inDocument = (...entries: [string, BindingHeld][]): BindingContext => ({
  kind: 'document',
  held: new Map(entries),
});

const shownIn = (document: ContentDocument, context: BindingContext | null): BoundTableShown =>
  boundTablesShown(opened(document), context)[0]!.shown;

describe('a bound table mapped to the editor and back (TB2-C)', () => {
  it('opens every stored bound table for editing, and stores it in the same canonical form', () => {
    const tables: BoundTableNode[] = [
      boundTable(),
      boundTable({
        style: 'wide',
        numbered: false,
        binding: tableBinding('k1', { version: '00000000-0000-4000-8000-00000000d002' }),
        caption: [text('Depths at '), inlineBinding('k2') as never],
        columns: [
          {
            column: 'depth',
            header: 'Depth',
            unit: { text: 'm', place: 'value' },
            format: { places: 1, negative: 'parentheses' },
            align: 'end',
            wrap: false,
          },
          { column: 'site', header: 'Site' },
        ],
        headerColumn: true,
        sort: [
          { column: 'depth', direction: 'descending', nulls: 'last' },
          { column: 'measured_on', direction: 'ascending', nulls: 'first' },
        ],
        empty: [text('No readings were taken.')],
        note: [text('Taken at low tide.')],
        source: [text('The harbour survey')],
      }),
      boundTable({ note: [text('Only a note.')] }),
      boundTable({ source: [text('Only a source.')] }),
    ];
    for (const table of tables) {
      const stored = documentOf(paragraph('p1', text('Before')), table);
      expect(fromEditor(opened(stored))).toEqual(stored);
    }
  });

  it('stores an empty statement, a note or a source emptied by the author as absent', () => {
    const stored = documentOf(
      boundTable({ empty: [text('None')], note: [text('A note')], source: [text('A source')] }),
    );
    let state = stateOf(stored);
    for (const name of ['boundTableEmpty', 'tableNote', 'boundTableSource']) {
      let range: [number, number] | undefined;
      state.doc.descendants((node, pos) => {
        if (node.type.name === name) range = [pos + 1, pos + 1 + node.content.size];
      });
      state = state.apply(state.tr.delete(...range!));
    }
    const [table] = fromEditor(state.doc).content;
    expect(table).toEqual(boundTable());
  });
});

describe("what a bound table's body shows (TB2-D)", () => {
  it('lays out the headers with their units and the first 50 rows from the result the document holds, and counts the rest', () => {
    const rows = rowsOf(120);
    const shown = shownIn(
      documentOf(boundTable({ headerColumn: true })),
      inDocument(heldTable({ columns: DECLARED, rowCount: 120, rows })),
    );
    expect(shown.columns.map((each) => each.text)).toEqual(['Site', 'Depth (m)']);
    expect(shown.columns.map((each) => each.align)).toEqual(['start', 'decimal']);
    expect(shown.rows).toHaveLength(PAGE_ROWS);
    expect(shown.rows[0]).toEqual([
      { text: 'S0', scope: 'row', negative: false },
      { text: '0.50', scope: null, negative: false },
    ]);
    expect(shown.rows[49]![0]!.text).toBe('S49');
    expect(shown.more).toBe(70);
    expect(shown.spanning).toBeNull();
  });

  it('shows the empty statement, or the default layout words, spanning a table of no rows', () => {
    const none = rowsOf(0);
    const held = inDocument(heldTable({ columns: DECLARED, rowCount: 0, rows: none }));
    expect(shownIn(documentOf(boundTable()), held).spanning).toEqual({
      text: 'No rows',
      failed: false,
    });
    expect(
      shownIn(documentOf(boundTable({ empty: [text('No readings taken.')] })), held).spanning,
    ).toEqual({ text: 'No readings taken.', failed: false });
  });

  it("shows checkTable's failures in place, table_too_long without reading a row", () => {
    const missing = shownIn(
      documentOf(boundTable({ columns: [{ column: 'tide', header: 'Tide' }] })),
      inDocument(heldTable({ columns: DECLARED, rowCount: 2, rows: rowsOf(2) })),
    );
    expect(missing).toMatchObject({
      columns: [{ text: 'Tide' }],
      rows: [],
      spanning: { text: 'No rows - the result has no column tide', failed: true },
    });
    const long = shownIn(
      documentOf(boundTable()),
      inDocument(heldTable({ columns: DECLARED, rowCount: 2_001, rows: null })),
    );
    expect(long.spanning).toEqual({
      text: 'No rows - the result has 2001 rows, more than a table prints',
      failed: true,
    });
    // Passing the check with no rows read yet: it says it is reading them.
    expect(
      shownIn(
        documentOf(boundTable()),
        inDocument(heldTable({ columns: DECLARED, rowCount: 2, rows: null })),
      ).spanning,
    ).toEqual({ text: TABLE_READING, failed: false });
  });

  it('says why a binding holds nothing: never resolved, or changed since', () => {
    const document = documentOf(boundTable());
    expect(shownIn(document, inDocument()).spanning).toEqual({
      text: TABLE_NEVER_RESOLVED,
      failed: true,
    });
    const other = tableBinding('k1', { mode: 'pinned' });
    expect(
      shownIn(
        document,
        inDocument(heldTable({ columns: DECLARED, rowCount: 0, rows: null }, other)),
      ).spanning,
    ).toEqual({ text: TABLE_CHANGED, failed: true });
  });

  it("shows a component's bound table by its headers and one row naming the definition that fills it", () => {
    const document = documentOf(boundTable());
    const alone = shownIn(document, { kind: 'alone', titles: new Map([[QUERY, 'Readings']]) });
    expect(alone.columns.map((each) => each.text)).toEqual(['Site', 'Depth (m)']);
    expect(alone.spanning).toEqual({
      text: 'Filled from Readings in each document',
      failed: false,
    });
    expect(shownIn(document, { kind: 'alone', titles: new Map() }).spanning?.text).toBe(
      'Filled from a query definition in each document',
    );
    expect(shownIn(document, null).spanning?.text).toBe('Bound table');
  });

  it("DAT-047 shows a bound table's failure in its place alone: the rest of the document still shows what it holds", () => {
    const document = documentOf(
      paragraph('p1', text('At '), inlineBinding('k2')),
      boundTable({ columns: [{ column: 'tide', header: 'Tide' }] }),
    );
    const context = inDocument(
      [
        'k2',
        {
          binding: bindingDigestInput(inlineBinding('k2')),
          shown: { value: 'North', waiting: false },
        },
      ],
      heldTable({ columns: DECLARED, rowCount: 2, rows: rowsOf(2) }),
    );
    const doc = opened(document);
    expect(boundTablesShown(doc, context)[0]!.shown.spanning).toMatchObject({ failed: true });
    expect(bindingsShown(doc, context)[0]).toMatchObject({ text: 'North', failed: false });
  });

  it('keeps the memoised body in the decoration while the caption is typed in, and lays it out again once a column changes', () => {
    const context = inDocument(heldTable({ columns: DECLARED, rowCount: 3, rows: rowsOf(3) }));
    const state = stateOf(documentOf(boundTable()), context);
    const bodyOf = (from: EditorState) =>
      bindingDecorations(from.doc, context)
        .find()
        .map((each) => (each as unknown as { spec: { boundTable?: BoundTableShown } }).spec)
        .find((spec) => spec.boundTable !== undefined)!.boundTable;
    const before = bodyOf(state);
    const typed = state.apply(state.tr.insertText(' by site', 10));
    expect(fromEditor(typed.doc).content[0]).toMatchObject({ caption: [text('Readings by site')] });
    expect(bodyOf(typed)).toBe(before);
    let tablePos = 0;
    typed.doc.descendants((node, pos) => {
      if (node.type.name === 'boundTable') tablePos = pos;
    });
    const reheaded = typed.apply(
      typed.tr.setNodeAttribute(tablePos, 'columns', [{ column: 'site', header: 'Place' }]),
    );
    expect(bodyOf(reheaded)).not.toBe(before);
    expect(bodyOf(reheaded)!.columns.map((each) => each.text)).toEqual(['Place']);
  });
});

describe('copying, cutting and pasting a bound table (BI-D)', () => {
  const tableRange = (state: EditorState) => {
    let found: { from: number; to: number } | undefined;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'boundTable') found ??= { from: pos, to: pos + node.nodeSize };
    });
    return found!;
  };
  const tableBindings = (state: EditorState): string[] => {
    const found: string[] = [];
    state.doc.descendants((node) => {
      if (node.type.name === 'boundTable') found.push((node.attrs.binding as { id: string }).id);
    });
    return found;
  };
  const atEnd = (state: EditorState) =>
    state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
  const pasted = (state: EditorState, data: string) => {
    const outcome = pasteInto(
      state,
      readClipboard(
        {
          types: [PRODUCT_CLIPBOARD_TYPE],
          getData: (type) => (type === PRODUCT_CLIPBOARD_TYPE ? data : ''),
        },
        'blocks',
      ),
      counter('p'),
    );
    if (!outcome.ok) throw new Error(outcome.report.at(-1)?.message);
    return state.apply(outcome.transaction);
  };

  it("renews a copied bound table's binding, and keeps a cut one's", () => {
    const state = stateOf(documentOf(boundTable(), paragraph('p2', text('End'))));
    const { from, to } = tableRange(state);
    const clipped = productClipboard(state, from, to)!;

    const copied = pasted(atEnd(state), clipped);
    const [original, copy] = tableBindings(copied);
    expect(original).toBe('k1');
    expect(copy).not.toBe('k1');
    expect(() => fromEditor(copied.doc)).not.toThrow();

    const cut = state.apply(state.tr.delete(from, to));
    expect(tableBindings(pasted(atEnd(cut), clipped))).toEqual(['k1']);
  });
});

describe("a bound table's body, which nothing deletes alone (TB2-C)", () => {
  const KEY_CODES: Record<string, number> = { Backspace: 8, Delete: 46 };
  /** A key through the state's own keymap chain, as `blocks.test.ts` presses one. */
  function press(state: EditorState, key: string): EditorState {
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
    const event = { key, keyCode: KEY_CODES[key] ?? 0, shiftKey: false, ctrlKey: false };
    for (const plugin of state.plugins) {
      const handler = plugin.props.handleKeyDown;
      if (handler?.call(plugin, view as never, event as never)) break;
    }
    return next;
  }
  const where = (state: EditorState, name: string, end = false) => {
    let at = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === name && at === -1) at = end ? pos + node.nodeSize - 1 : pos + 1;
    });
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
  };
  const stored = documentOf(boundTable({ empty: [text('None')], note: [text('A note')] }));

  it('draws no gap cursor beside the body', () => {
    // With nothing after it, the body is the last thing in its table, closed on both sides.
    const state = stateOf(documentOf(boundTable()));
    let bodyEnd = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'boundTableBody') bodyEnd = pos + node.nodeSize;
    });
    // What the gap cursor plugin asks of a position before it stands there; untyped, but public in
    // its source and what every arrow key and click near a closed node consults.
    const valid = (GapCursor as unknown as { valid: ($pos: ResolvedPos) => boolean }).valid;
    expect(valid(state.doc.resolve(bodyEnd))).toBe(false);
    expect(valid(state.doc.resolve(bodyEnd - 1))).toBe(false);
  });

  it('deletes nothing with Backspace after it or Delete before it', () => {
    const state = stateOf(stored);
    for (const [at, key] of [
      [where(state, 'boundTableEmpty'), 'Backspace'],
      [where(state, 'tableNote'), 'Backspace'],
      [where(state, 'tableCaption', true), 'Delete'],
    ] as const) {
      const next = press(at, key);
      expect(fromEditor(next.doc)).toEqual(stored);
    }
  });
});

describe('a bound table of 2,000 rows on the page (the TB2 plan, task 3)', () => {
  it('sorts 2,000 rows of 8 columns and lays out the first 50 in under 50 ms', () => {
    const names = ['site', 'depth', 'on', 'at', 'count', 'open', 'note', 'ratio'];
    const columns: TableColumn[] = [
      { name: 'site', type: { base: 'text' } },
      { name: 'depth', type: { base: 'decimal', precision: 12, scale: 3 } },
      { name: 'on', type: { base: 'date' } },
      { name: 'at', type: { base: 'time', fraction: 0 } },
      { name: 'count', type: { base: 'integer' } },
      { name: 'open', type: { base: 'boolean' } },
      { name: 'note', type: { base: 'text' } },
      { name: 'ratio', type: { base: 'decimal', precision: 12, scale: 4 } },
    ];
    const result: CanonicalResult = {
      columns: columns.map((each) => [each.name, each.type.base]) as CanonicalResult['columns'],
      rows: Array.from({ length: 2_000 }, (_, at) => [
        `Site ${(at * 7919) % 2_000}`,
        `${(at * 37) % 1_000}.${at % 1_000}`,
        `2026-${String((at % 12) + 1).padStart(2, '0')}-${String((at % 28) + 1).padStart(2, '0')}`,
        `${String(at % 24).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}:00`,
        String(at * 13),
        at % 2 === 0,
        at % 5 === 0 ? null : `Note ${at}`,
        `-0.${String(at).padStart(4, '0')}`,
      ]),
    };
    const document = documentOf(
      boundTable({
        columns: names.map((name) => ({ column: name, header: name })),
        sort: [
          { column: 'depth', direction: 'descending', nulls: 'last' },
          { column: 'site', direction: 'ascending', nulls: 'first' },
        ],
      }),
    );
    const doc = opened(document);
    const timings: number[] = [];
    for (let run = 0; run < 7; run += 1) {
      // A fresh result object each run, so the memo never answers for the layout.
      const rows = { ...result };
      const context = inDocument(heldTable({ columns, rowCount: 2_000, rows }));
      const started = performance.now();
      const [shown] = boundTablesShown(doc, context);
      timings.push(performance.now() - started);
      expect(shown!.shown.rows).toHaveLength(PAGE_ROWS);
      expect(shown!.shown.more).toBe(1_950);
    }
    const median = [...timings].sort((a, b) => a - b)[3]!;
    expect(median).toBeLessThan(50);
  });
});
