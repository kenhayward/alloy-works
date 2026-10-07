import {
  parseContentDocument,
  type BlockNode,
  type BoundTableNode,
  type ContentDocument,
  type TableColumn,
} from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { undo } from 'prosemirror-history';
import { describe, expect, it } from 'vitest';

import { fromEditor, toEditor } from './mapping.js';
import { createEditorState } from './state.js';
import { setTableStyle } from './styles.js';
import {
  boundTableAt,
  changeTableBinding,
  columnsPlaced,
  deleteBoundTable,
  insertBoundTable,
  repeatedColumn,
  setBoundTable,
  setBoundTablePart,
  type TableChoice,
} from './tables.js';

/**
 * Placing and shaping a bound table (the TB2 plan, task 4; TB2-E to TB2-G): Place as Table's columns,
 * the panel's commands - each one step, each declining what the walk would refuse - and a binding
 * changed with its columns kept.
 */

const QUERY = '00000000-0000-4000-8000-00000000d001';
const OTHER = '00000000-0000-4000-8000-00000000d002';
const text = (value: string) => ({ type: 'text' as const, value, marks: [] });

const boundTable = (over: Partial<BoundTableNode> = {}): BoundTableNode => ({
  type: 'boundTable',
  id: 't1',
  style: 'table',
  binding: { type: 'binding', id: 'k1', query: QUERY, parameters: {}, mode: 'checked' },
  caption: [text('Readings')],
  columns: [
    { column: 'site', header: 'Site' },
    { column: 'depth', header: 'Depth' },
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

const counter = () => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

function stateOf(document: ContentDocument): EditorState {
  const editor = toEditor(document);
  if (!editor.editable) throw new Error(editor.unsupported.join(', '));
  return createEditorState({ doc: editor.doc, newIdentifier: counter(), bindingContext: null });
}

/** The state with the cursor at the start of the first node of this type. */
function into(state: EditorState, type: string): EditorState {
  let at = -1;
  state.doc.descendants((node: Node, pos) => {
    if (at < 0 && node.type.name === type) at = pos + 1;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

const run = (state: EditorState, command: Command) => {
  let next = state;
  const done = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { done, state: next };
};

const stored = (state: EditorState) =>
  fromEditor(state.doc).content.find((each) => each.type === 'boundTable') as BoundTableNode;

const CHOICE: TableChoice = { query: QUERY, parameters: {}, mode: 'checked' };

describe('placing a bound table (TB2-E)', () => {
  it('shows the first 64 declared columns that are not images, headed by their names, and counts the rest', () => {
    const declared: TableColumn[] = [
      { name: 'photo', type: { base: 'image', encoding: 'binary' } } as TableColumn,
      ...Array.from({ length: 67 }, (_, at) => ({
        name: `c${at}`,
        type: { base: 'text' as const },
      })),
      { name: 'map', type: { base: 'image', encoding: 'binary' } } as TableColumn,
    ];
    const placed = columnsPlaced(declared);
    expect(placed.columns).toHaveLength(64);
    expect(placed.columns[0]).toEqual({ column: 'c0', header: 'c0' });
    expect(placed.columns.at(-1)).toEqual({ column: 'c63', header: 'c63' });
    expect(placed.left).toBe(5);
  });

  it('places one after the paragraph, its binding and itself given fresh identifiers, the cursor in its caption', () => {
    const state = into(stateOf(documentOf(paragraph('p1', text('Before')))), 'paragraph');
    const declared: TableColumn[] = [
      { name: 'site', type: { base: 'text' } },
      { name: 'depth', type: { base: 'decimal', precision: 10, scale: 2 } },
    ];
    const { done, state: after } = run(state, insertBoundTable(CHOICE, declared, counter()));
    expect(done).toBe(true);
    const table = stored(after);
    expect(table).toMatchObject({
      columns: [
        { column: 'site', header: 'Site'.toLowerCase() },
        { column: 'depth', header: 'depth' },
      ],
      headerColumn: false,
      caption: [],
    });
    expect(table.binding).toEqual({ type: 'binding', id: 'n2', ...CHOICE });
    expect(table.id).toBe('n1');
    expect(after.selection.$from.parent.type.name).toBe('tableCaption');
    expect(boundTableAt(after)?.binding.id).toBe('n2');
  });

  it('declines in a table and where no column could be shown', () => {
    const state = into(stateOf(documentOf(paragraph('p1'), boundTable())), 'tableCaption');
    expect(
      insertBoundTable(CHOICE, [{ name: 'a', type: { base: 'text' } }], counter())(state),
    ).toBe(false);
    const empty = into(stateOf(documentOf(paragraph('p1'))), 'paragraph');
    expect(
      insertBoundTable(
        CHOICE,
        [{ name: 'photo', type: { base: 'image', encoding: 'binary' } } as TableColumn],
        counter(),
      )(empty),
    ).toBe(false);
  });
});

describe('the Bound table panel (TB2-F)', () => {
  const inTable = () => into(stateOf(documentOf(paragraph('p1'), boundTable())), 'tableCaption');

  it('sets the columns, the header column, the sort and Numbered, each one step for undo', () => {
    let state = inTable();
    const columns = [
      { column: 'depth', header: 'Depth', unit: { text: 'm', place: 'header' as const } },
      { column: 'site', header: 'Site' },
    ];
    for (const change of [
      { columns },
      { headerColumn: true },
      { sort: [{ column: 'depth', direction: 'descending' as const, nulls: 'last' as const }] },
      { numbered: false },
    ]) {
      const ran = run(state, setBoundTable(change));
      expect(ran.done).toBe(true);
      state = ran.state;
    }
    expect(stored(state)).toMatchObject({
      columns,
      headerColumn: true,
      sort: [{ column: 'depth', direction: 'descending', nulls: 'last' }],
      numbered: false,
    });
    const undone = run(state, undo).state;
    expect(stored(undone).numbered).toBeUndefined();
    expect(stored(undone).sort).toHaveLength(1);
  });

  it('stores a header and a unit in NFC, and an emptied unit as none', () => {
    const { state } = run(
      inTable(),
      setBoundTable({
        columns: [
          { column: 'site', header: 'Café', unit: { text: '', place: 'value' } },
          { column: 'depth', header: 'Depth' },
        ],
      }),
    );
    expect(stored(state).columns[0]).toEqual({ column: 'site', header: 'Café' });
  });

  it('declines no column, an empty header, a column repeated under one header and a column sorted twice', () => {
    const state = inTable();
    const refused = [
      { columns: [] },
      { columns: [{ column: 'site', header: '' }] },
      {
        columns: [
          { column: 'site', header: 'Site' },
          { column: 'site', header: 'SITE' },
        ],
      },
      {
        sort: [
          { column: 'site', direction: 'ascending' as const, nulls: 'last' as const },
          { column: 'site', direction: 'descending' as const, nulls: 'last' as const },
        ],
      },
    ];
    for (const change of refused) expect(setBoundTable(change)(state)).toBe(false);
    expect(
      repeatedColumn([
        { column: 'site', header: 'Site' },
        { column: 'site', header: 'Name' },
      ]),
    ).toBeNull();
    expect(
      setBoundTable({
        columns: [
          { column: 'site', header: 'Site' },
          { column: 'site', header: 'Name' },
        ],
      })(state),
    ).toBe(true);
  });

  it('adds and removes the empty statement, the note and the source, each in its place', () => {
    let state = inTable();
    for (const part of ['source', 'empty', 'note'] as const) {
      state = run(state, setBoundTablePart(part, true)).state;
      state = state.apply(state.tr.insertText(part));
    }
    expect(stored(state)).toMatchObject({
      empty: [text('empty')],
      note: [text('note')],
      source: [text('source')],
    });
    expect(setBoundTablePart('note', true)(state)).toBe(false);
    state = run(state, setBoundTablePart('note', false)).state;
    expect(stored(state).note).toBeUndefined();
    expect(stored(state).source).toEqual([text('source')]);
  });

  it('sets its table style, and deletes it whole', () => {
    let state = inTable();
    state = run(state, setTableStyle('wide')).state;
    expect(stored(state).style).toBe('wide');
    state = run(state, deleteBoundTable).state;
    expect(fromEditor(state.doc).content.map((each) => each.type)).toEqual(['paragraph']);
  });
});

describe("changing a bound table's binding (TB2-G)", () => {
  it('keeps its identifier and every column', () => {
    const state = stateOf(documentOf(paragraph('p1'), boundTable()));
    let pos = -1;
    state.doc.descendants((node, at) => {
      if (node.type.name === 'boundTable') pos = at;
    });
    const { state: after } = run(
      state,
      changeTableBinding(pos, { query: OTHER, version: QUERY, parameters: {}, mode: 'pinned' }),
    );
    expect(stored(after).binding).toEqual({
      type: 'binding',
      id: 'k1',
      query: OTHER,
      version: QUERY,
      parameters: {},
      mode: 'pinned',
    });
    expect(stored(after).columns).toEqual(boundTable().columns);
  });
});
