import type { BlockNode, ContentDocument } from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { describe, expect, it } from 'vitest';

import { blockCommand } from './blocks.js';
import { fromEditor, toEditor } from './mapping.js';
import { createEditorState, placeholderDecorations } from './state.js';
import { setTableHeaders, tableAt, tableCommand } from './tables.js';

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};

const text = (value: string, marks: { type: 'emphasis' | 'strong'; id: string }[] = []) => ({
  type: 'text' as const,
  value,
  marks,
});
const paragraph = (id: string, value = '') => ({
  type: 'paragraph' as const,
  id,
  style: 'body',
  content: value === '' ? [] : [text(value)],
});
const cell = (id: string, value: string, spans: { colspan?: number; rowspan?: number } = {}) => ({
  content: [paragraph(id, value)],
  colspan: spans.colspan ?? 1,
  rowspan: spans.rowspan ?? 1,
});

/** Readings: a header row, a header column, a cell spanning two rows and one spanning two columns. */
const readings: BlockNode = {
  type: 'table',
  id: 't1',
  style: 'table',
  caption: [text('Readings '), text('at noon', [{ type: 'emphasis', id: 'm1' }])],
  headerRows: 1,
  headerColumns: 1,
  keyColumns: [0],
  note: [text('Measured on site.')],
  rows: [
    { cells: [cell('c1', 'Site'), cell('c2', 'Values', { colspan: 2 })] },
    { cells: [cell('c3', 'York', { rowspan: 2 }), cell('c4', '1'), cell('c5', '2')] },
    { cells: [cell('c6', '3'), cell('c7', '4')] },
  ],
};

const documentOf = (...content: BlockNode[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Readings',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

function stateOf(document: ContentDocument, at?: number): EditorState {
  const opened = toEditor(document);
  if (!opened.editable) throw new Error(`not editable: ${opened.unsupported.join(', ')}`);
  const state = createEditorState({ doc: opened.doc, newIdentifier: counter() });
  if (at === undefined) return state;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

/** The position just inside the textblock carrying this identifier, or the table's caption. */
function inside(doc: Node, what: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (what === 'caption' ? node.type.name === 'tableCaption' : node.attrs.id === what) {
      found = pos + 1;
    }
    return true;
  });
  if (found === -1) throw new Error(`no ${what}`);
  return found;
}

function run(
  state: EditorState,
  command: (s: EditorState, d?: (tr: Transaction) => void) => boolean,
) {
  let next = state;
  const handled = command(state, (tr) => (next = state.apply(tr)));
  return { handled, next };
}

/** Each cell's kind and scope, row by row, as the surface holds them. */
function kinds(doc: Node): string[][] {
  const rows: string[][] = [];
  doc.descendants((node) => {
    if (node.type.name === 'table_row') {
      const row: string[] = [];
      node.forEach((child) => {
        row.push(
          `${child.type.name === 'table_header' ? 'th' : 'td'}${child.attrs.scope ? `:${child.attrs.scope}` : ''}`,
        );
      });
      rows.push(row);
    }
    return true;
  });
  return rows;
}

describe('a table in the editor', () => {
  it('CNT-016 opens a stored table and stores it back exactly: caption, spans, header counts and all', () => {
    const document = documentOf(readings);
    const opened = toEditor(document);
    if (!opened.editable) throw new Error('expected an editable table');
    expect(fromEditor(opened.doc)).toEqual(fromEditor(opened.doc));
    expect(fromEditor(opened.doc).content).toEqual(documentOf(readings).content);
  });

  it('makes each cell a header or a data cell from the counts, with the way it reads', () => {
    const opened = toEditor(documentOf(readings));
    if (!opened.editable) throw new Error('expected an editable table');
    expect(kinds(opened.doc)).toEqual([
      ['th:col', 'th:col'],
      ['th:row', 'td', 'td'],
      ['td', 'td'],
    ]);
  });

  it('opens a table whose note holds a footnote for reading only, naming the footnote', () => {
    const noted: BlockNode = {
      ...readings,
      note: [
        {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'table' },
          content: [
            { type: 'paragraph', id: 'f1p', style: 'footnote', content: [text('A note.')] },
          ],
        },
      ],
    };
    expect(toEditor(documentOf(noted))).toEqual({ editable: false, unsupported: ['footnote'] });
  });

  it('inserts a table of three columns and three rows, a header row, and the cursor in its first cell', () => {
    const start = stateOf(documentOf(paragraph('p1', 'Before')));
    const at = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 7)));
    const { handled, next } = run(at, blockCommand('table', counter('t')));
    expect(handled).toBe(true);
    const stored = fromEditor(next.doc).content;
    expect(stored).toMatchObject([
      { type: 'paragraph', content: [{ value: 'Before' }] },
      { type: 'table', caption: [], headerRows: 1, headerColumns: 0 },
    ]);
    const table = stored[1] as Extract<BlockNode, { type: 'table' }>;
    expect(table.rows.map((row) => row.cells.length)).toEqual([3, 3, 3]);
    expect(kinds(next.doc)[0]).toEqual(['th:col', 'th:col', 'th:col']);
    expect(next.selection.$from.parent.type.name).toBe('paragraph');
    expect(next.selection.$from.node(-1).type.name).toBe('table_header');
    expect(tableAt(next)).toMatchObject({ headerRows: 1, headerColumns: 0, rows: 3, columns: 3 });
  });

  it('puts a table in place of an empty paragraph rather than after it', () => {
    const { next } = run(
      stateOf(documentOf(paragraph('p1')), 1),
      blockCommand('table', counter('t')),
    );
    expect(fromEditor(next.doc).content.map((block) => block.type)).toEqual(['table']);
  });

  it('declines a table in a table, in its caption, and in a term, an attribution or preformatted text', () => {
    const inTable = stateOf(documentOf(readings));
    for (const where of ['c4', 'caption']) {
      const state = inTable.apply(
        inTable.tr.setSelection(TextSelection.create(inTable.doc, inside(inTable.doc, where))),
      );
      expect(run(state, blockCommand('table', counter('t'))).handled, where).toBe(false);
    }
    const code = stateOf(documentOf({ type: 'preformatted', id: 'x1', text: 'a' }), 1);
    expect(run(code, blockCommand('table', counter('t'))).handled).toBe(false);
  });

  it('sets the header rows and columns, clamped to the table, and every cell follows', () => {
    const state = stateOf(documentOf(readings));
    const at = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'c4'))),
    );
    const none = run(at, setTableHeaders({ rows: 0, columns: 0 })).next;
    expect(kinds(none.doc)).toEqual([
      ['td', 'td'],
      ['td', 'td', 'td'],
      ['td', 'td'],
    ]);
    const clamped = run(at, setTableHeaders({ rows: 9, columns: 9 })).next;
    expect(tableAt(clamped)).toMatchObject({ headerRows: 3, headerColumns: 3 });
    expect(() => fromEditor(clamped.doc)).not.toThrow();
  });

  it('adds, deletes, merges and splits, and every table it makes is one the store takes', () => {
    const state = stateOf(documentOf(readings));
    const at = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'c4'))),
    );
    for (const action of [
      'rowAbove',
      'rowBelow',
      'columnBefore',
      'columnAfter',
      'deleteRow',
      'deleteColumn',
    ] as const) {
      const { handled, next } = run(at, tableCommand(action));
      expect(handled, action).toBe(true);
      expect(() => fromEditor(next.doc), action).not.toThrow();
    }
    // Two cells merge into one spanning both, and the spanning header cell splits back into two.
    const four = inside(state.doc, 'c4') - 2;
    const five = inside(state.doc, 'c5') - 2;
    const selected = state.apply(
      state.tr.setSelection(CellSelection.create(state.doc, four, five)),
    );
    const merged = run(selected, tableCommand('merge'));
    expect(merged.handled).toBe(true);
    expect(
      (fromEditor(merged.next.doc).content[0] as Extract<BlockNode, { type: 'table' }>).rows[1]!
        .cells[1],
    ).toMatchObject({ colspan: 2 });
    const york = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'c3'))),
    );
    const split = run(york, tableCommand('split'));
    expect(split.handled).toBe(true);
    expect(
      (fromEditor(split.next.doc).content[0] as Extract<BlockNode, { type: 'table' }>).rows[2]!
        .cells,
    ).toHaveLength(3);
  });

  it('declines deleting the last row or column, which would leave a table of nothing', () => {
    const lone: BlockNode = {
      type: 'table',
      id: 't1',
      style: 'table',
      caption: [],
      headerRows: 0,
      headerColumns: 0,
      rows: [{ cells: [cell('c1', 'Only')] }],
    };
    const state = stateOf(documentOf(lone));
    const at = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'c1'))),
    );
    expect(run(at, tableCommand('deleteRow')).handled).toBe(false);
    expect(run(at, tableCommand('deleteColumn')).handled).toBe(false);
  });

  it('deletes the whole table, caption and all, leaving a paragraph where it was the only block', () => {
    const state = stateOf(documentOf(readings));
    const at = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'c4'))),
    );
    const { handled, next } = run(at, tableCommand('deleteTable'));
    expect(handled).toBe(true);
    expect(fromEditor(next.doc).content.map((block) => block.type)).toEqual(['paragraph']);
    expect(tableAt(next)).toBeNull();
  });

  it('declines a quotation or preformatted text in a cell, and in a list inside one', () => {
    const listed: BlockNode = {
      ...readings,
      rows: [
        { cells: [cell('c1', 'Site'), cell('c2', 'Values', { colspan: 2 })] },
        {
          cells: [
            cell('c3', 'York', { rowspan: 2 }),
            {
              content: [
                {
                  type: 'list',
                  id: 'l1',
                  kind: 'unordered',
                  items: [{ content: [paragraph('li1', 'one')] }],
                },
              ],
              colspan: 1,
              rowspan: 1,
            },
            cell('c5', '2'),
          ],
        },
        { cells: [cell('c6', '3'), cell('c7', '4')] },
      ],
    };
    const state = stateOf(documentOf(listed));
    for (const where of ['c4', 'li1']) {
      const id = where === 'c4' ? 'c5' : where;
      const at = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, id))),
      );
      expect(run(at, blockCommand('quotation', counter('q'))).handled, where).toBe(false);
      expect(run(at, blockCommand('preformatted', counter('q'))).handled, where).toBe(false);
    }
  });

  it('marks an empty caption so the surface can say what it is for', () => {
    const opened = toEditor(documentOf({ ...readings, caption: [] }));
    if (!opened.editable) throw new Error('expected an editable table');
    const classes = placeholderDecorations(opened.doc)
      .find()
      .map(
        (decoration) =>
          (decoration as unknown as { type: { attrs: { class: string } } }).type.attrs.class,
      );
    expect(classes).toEqual(['aw-empty']);
  });
});
