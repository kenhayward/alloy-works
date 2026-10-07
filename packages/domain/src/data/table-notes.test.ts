import { describe, expect, it } from 'vitest';

import type { BlockNode, BoundTableNode } from '../content/model/blocks.js';
import type { FootnoteNode } from '../content/model/inline.js';
import { DEFAULT_VALUE_FORMATS } from '../theme/default.js';
import type { CanonicalResult } from './canonical.js';
import type { Column } from './definition.js';
import { layoutTable, type LaidOut } from './table.js';
import { keyNamesTheKey, matchNoteRows, placeTableNotes, tableNoteLetter } from './table-notes.js';

/** A bound table's notes matched to their rows and lettered (the TB3 plan, TB3-C). */

const COLUMNS: Column[] = [
  { name: 'site', from: { column: 'site' }, type: { base: 'text' } },
  { name: 'depth', from: { column: 'depth' }, type: { base: 'decimal', precision: 10, scale: 2 } },
  { name: 'day', from: { column: 'day' }, type: { base: 'integer' } },
];
const RESULT: CanonicalResult = {
  columns: [
    ['site', 'text'],
    ['depth', 'decimal'],
    ['day', 'integer'],
  ],
  rows: [
    ['North', '4.5', '1'],
    ['South', '1.25', '1'],
    ['North', '2', '2'],
  ],
};

const note = (id: string, anchor: FootnoteNode['anchor']): FootnoteNode => ({
  type: 'footnote',
  id,
  anchor,
  content: [{ type: 'paragraph', id: `${id}-p`, style: 'body', content: [] }],
});
const keyed = (id: string, key: Record<string, string | boolean>, column = 'depth') =>
  note(id, { kind: 'keyed', key, column });
const onColumn = (id: string, column: string) => note(id, { kind: 'column', column });

const table = (notes: FootnoteNode[], over: Partial<BoundTableNode> = {}): BoundTableNode => ({
  type: 'boundTable',
  id: 't1',
  style: 'table',
  binding: {
    type: 'binding',
    id: 'k1',
    query: '00000000-0000-4000-8000-00000000d001',
    parameters: {},
    mode: 'checked',
  },
  caption: [{ type: 'text', value: 'Readings', marks: [] }],
  columns: [
    { column: 'site', header: 'Site' },
    { column: 'day', header: 'Day' },
    { column: 'depth', header: 'Depth' },
  ],
  headerColumn: false,
  notes,
  ...over,
});
const laid = (presentation: BoundTableNode): LaidOut => {
  const out = layoutTable(presentation, RESULT, COLUMNS, {}, DEFAULT_VALUE_FORMATS, {
    noRows: 'No rows',
    notAvailable: 'Not available',
  });
  if ('failures' in out) throw new Error(JSON.stringify(out.failures));
  return out;
};
const KEY = ['site', 'day'];
const placed = (presentation: BoundTableNode) => {
  const out = laid(presentation);
  const rows = matchNoteRows(presentation.notes ?? [], RESULT, KEY, COLUMNS);
  return { out, notes: placeTableNotes(presentation, out, rows) };
};

describe("a bound table's notes, matched to their rows and lettered", () => {
  it('CNT-039 names its row by key values, never a position, and follows its row through a re-sort', () => {
    const south = keyed('n1', { site: 'South', day: '1' });
    for (const direction of ['ascending', 'descending'] as const) {
      const { out, notes } = placed(
        table([south], { sort: [{ column: 'depth', direction, nulls: 'last' }] }),
      );
      const [only] = notes;
      expect(only).toMatchObject({ letter: 'a', column: 2 });
      expect(out.rows[only!.row!]!.cells[0]!.text, direction).toBe('South');
    }
    expect(laid(table([])).rows.map((row) => row.index)).toEqual([0, 1, 2]);
  });

  it('TAB-024 anchors a note to a cell by the key and a column; a decimal key typed with trailing zeros finds its row', () => {
    const rows = matchNoteRows(
      [keyed('n1', { site: 'North', day: '2' }), keyed('n2', { depth: '4.50' }, 'site')],
      RESULT,
      KEY,
      COLUMNS,
    );
    expect(rows.get('n1')).toBe(2);
    // The second keys by a column that is not the key: gone, and said so beside it.
    expect(rows.get('n2')).toBeNull();
    expect(
      matchNoteRows([keyed('n2', { depth: '4.50' }, 'site')], RESULT, ['depth'], COLUMNS),
    ).toEqual(new Map([['n2', 0]]));
    expect(
      matchNoteRows([keyed('n3', { day: '01', site: 'North' })], RESULT, KEY, COLUMNS),
    ).toEqual(new Map([['n3', 0]]));
  });

  it('TAB-025 anchors a note to a column, marked in its header', () => {
    const { notes } = placed(table([onColumn('n1', 'depth'), onColumn('n2', 'site')]));
    expect(notes.map((each) => [each.note.id, each.letter, each.row, each.column])).toEqual([
      ['n2', 'a', null, 0],
      ['n1', 'b', null, 2],
    ]);
  });

  it("TAB-026 letters a bound table's notes in its own sequence: columns left to right, then cells row by row, ties by note order", () => {
    const { notes } = placed(
      table([
        keyed('late', { site: 'North', day: '2' }, 'site'),
        keyed('second', { site: 'North', day: '1' }, 'depth'),
        keyed('first', { site: 'North', day: '1' }, 'site'),
        keyed('again', { site: 'North', day: '1' }, 'depth'),
        onColumn('head', 'day'),
      ]),
    );
    expect(notes.map((each) => `${each.letter} ${each.note.id}`)).toEqual([
      'a head',
      'b first',
      'c second',
      'd again',
      'e late',
    ]);
  });

  it("TAB-026 letters an authored table's cell footnotes in its own sequence, its header rows first, row by row", () => {
    const run = (value: string) => ({ type: 'text' as const, value, marks: [] });
    const footnote = (id: string): FootnoteNode => note(id, { kind: 'span' });
    const cell = (id: string, ...notes: FootnoteNode[]) => ({
      content: [{ type: 'paragraph' as const, id, style: 'body', content: [run(id), ...notes] }],
      colspan: 1,
      rowspan: 1,
    });
    const authored: Extract<BlockNode, { type: 'table' }> = {
      type: 'table',
      id: 't2',
      style: 'table',
      caption: [run('Authored')],
      headerRows: 1,
      headerColumns: 0,
      rows: [
        { cells: [cell('a'), cell('b', footnote('f-head'))] },
        { cells: [cell('c', footnote('f-c1'), footnote('f-c2')), cell('d', footnote('f-d'))] },
      ],
    };
    expect(
      placeTableNotes(authored).map((each) => [each.note.id, each.letter, each.row, each.column]),
    ).toEqual([
      ['f-head', 'a', 0, 1],
      ['f-c1', 'b', 1, 0],
      ['f-c2', 'c', 1, 0],
      ['f-d', 'd', 1, 1],
    ]);
  });

  it('letters a to z, then aa', () => {
    expect([0, 25, 26, 27, 51, 52].map(tableNoteLetter)).toEqual([
      'a',
      'z',
      'aa',
      'ab',
      'az',
      'ba',
    ]);
  });

  it('answers null for a row gone, and for a key naming columns that are not the key; places neither', () => {
    const rows = matchNoteRows(
      [keyed('n1', { site: 'West', day: '1' }), keyed('n2', { site: 'North' })],
      RESULT,
      KEY,
      COLUMNS,
    );
    expect(rows).toEqual(
      new Map([
        ['n1', null],
        ['n2', null],
      ]),
    );
    expect(keyNamesTheKey({ site: 'West', day: '1' }, KEY)).toBe(true);
    expect(keyNamesTheKey({ site: 'North' }, KEY)).toBe(false);
    const gone = table([keyed('n1', { site: 'West', day: '1' })]);
    expect(placeTableNotes(gone, laid(gone), rows)).toEqual([]);
  });
});
