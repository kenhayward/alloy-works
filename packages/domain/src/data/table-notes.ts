import type { BlockNode, BoundTableNode } from '../content/model/blocks.js';
import type { FootnoteNode, InlineNode } from '../content/model/inline.js';
import { formatCounter } from '../structure/scheme.js';
import type { ColumnType } from './columns.js';
import {
  compareCanonical,
  valueProblem,
  type CanonicalResult,
  type CanonicalValue,
} from './canonical.js';
import type { LaidOut, TableColumn } from './table.js';

/**
 * **A table's notes** (the TB3 plan, TB3-C): a bound table's keyed notes matched to their rows, and
 * every table's notes lettered in its own sequence. Pure; the stage, the page and the provenance use
 * these two and nothing else.
 */

type TableNode = Extract<BlockNode, { type: 'table' }>;

/** A note's letter from its place in the table's sequence, counted from 0: `a` to `z`, then `aa`. */
export function tableNoteLetter(index: number): string {
  return formatCounter(index + 1, 'lowerAlpha');
}

/** Whether a key record names exactly the definition's key columns, in any order. */
export function keyNamesTheKey(
  key: Readonly<Record<string, CanonicalValue>>,
  columns: readonly string[],
): boolean {
  const named = Object.keys(key);
  return named.length === columns.length && columns.every((column) => Object.hasOwn(key, column));
}

/** A run of digits with its leading zeros taken off, `0` where none is left. */
const unpadded = (digits: string) => digits.replace(/^0+/, '') || '0';

/**
 * **A key's value as typed, in its column's canonical form** (TB3.3): what the page stores in a keyed
 * note's key - text in NFC, a number with no sign of plus, leading zero or trailing fractional zero,
 * a boolean from `true` or `false`, a time with no trailing fractional zero - or null where what is
 * typed is none of the type's values, or empty.
 */
export function canonicalKeyValue(type: ColumnType, typed: string): CanonicalValue {
  if (type.base === 'text') return typed === '' ? null : typed.normalize('NFC');
  const text = typed.trim();
  let value: CanonicalValue = text;
  if (type.base === 'boolean') {
    const word = text.toLowerCase();
    value = word === 'true' ? true : word === 'false' ? false : null;
  } else if (type.base === 'integer' || type.base === 'decimal') {
    const match = /^([+-]?)([0-9]*)(?:[.]([0-9]*))?$/.exec(text);
    if (match === null || `${match[2]}${match[3] ?? ''}` === '') return null;
    if (type.base === 'integer' && match[3] !== undefined) return null;
    const fraction = (match[3] ?? '').replace(/0+$/, '');
    const number = `${unpadded(match[2]!)}${fraction === '' ? '' : `.${fraction}`}`;
    value = match[1] === '-' && number !== '0' ? `-${number}` : number;
  } else if (type.base !== 'date') {
    // A time, a local date-time or an instant: a fraction's trailing zeros, and a bare point, off.
    value = text.replace(/[.]([0-9]*?)0+(?=Z?$)/, (_, kept: string) =>
      kept === '' ? '' : `.${kept}`,
    );
  }
  return value !== null && valueProblem(type, value) === null ? value : null;
}

/** Two values of one type compared canonicalised by it, so `"1.50"` is `1.5`; anything unreadable differs. */
function sameValue(type: TableColumn['type'], a: CanonicalValue, b: CanonicalValue): boolean {
  if (a === null || b === null || typeof a !== typeof b) return false;
  try {
    return compareCanonical(type, a, b) === 0;
  } catch {
    return false;
  }
}

/**
 * **Each keyed note's row** (TB3-C, CNT-039): its index into `result`'s rows, the first whose every key
 * column holds the note's value canonicalised by the column's declared type, or null where none does
 * (`note_row_missing`) - and null too where the note's key names other columns than `key`, which
 * `keyNamesTheKey` says. Column notes are not in the map.
 */
export function matchNoteRows(
  notes: readonly FootnoteNode[],
  result: CanonicalResult,
  key: readonly string[],
  columns: readonly TableColumn[],
): Map<string, number | null> {
  const at = new Map(result.columns.map(([name], index) => [name, index]));
  const types = new Map(columns.map((column) => [column.name, column.type]));
  const rows = new Map<string, number | null>();
  for (const note of notes) {
    const { anchor } = note;
    if (anchor.kind !== 'keyed') continue;
    const readable =
      key.length > 0 &&
      keyNamesTheKey(anchor.key, key) &&
      key.every((name) => at.has(name) && types.has(name));
    const found = readable
      ? result.rows.findIndex((row) =>
          key.every((name) =>
            sameValue(types.get(name)!, row[at.get(name)!] ?? null, anchor.key[name]!),
          ),
        )
      : -1;
    rows.set(note.id, found < 0 ? null : found);
  }
  return rows;
}

/**
 * A note placed: its letter, and where its mark stands - for a bound table, `row` the laid-out body row
 * or null for the header and `column` the column shown; for an authored table, the grid's row and the
 * cell's index in it.
 */
export interface PlacedNote {
  readonly note: FootnoteNode;
  readonly letter: string;
  readonly row: number | null;
  readonly column: number;
}

/**
 * The rows a bound table's notes are placed in: a layout's, or every row's index in the table's order
 * (`tableOrder`), where the page lays out its first rows alone (TB3.3).
 */
export type LaidRows = { readonly rows: LaidOut['rows'] | readonly { readonly index: number }[] };

/** The footnotes in a cell's blocks, in reading order: its paragraphs' and its list items' bodies'. */
function footnotesIn(blocks: readonly BlockNode[]): FootnoteNode[] {
  const inline = (content: readonly InlineNode[]) =>
    content.filter((each): each is FootnoteNode => each.type === 'footnote');
  return blocks.flatMap((block) =>
    block.type === 'paragraph'
      ? inline(block.content)
      : block.type === 'list'
        ? block.items.flatMap((item) => footnotesIn(item.content))
        : [],
  );
}

/**
 * **Every note of a table lettered in its own sequence** (TB3-C, TAB-026), in reading order. A bound
 * table's: column notes left to right, then keyed notes row by row in the laid-out order and left to
 * right, ties by note order; a keyed note whose row is gone or not laid out is not placed. An authored
 * table's: the footnotes in its cells, header rows included, row by row and cell by cell.
 */
export function placeTableNotes(table: TableNode): PlacedNote[];
export function placeTableNotes(
  table: BoundTableNode,
  laid: LaidRows,
  noteRows: ReadonlyMap<string, number | null>,
): PlacedNote[];
export function placeTableNotes(
  table: TableNode | BoundTableNode,
  laid?: LaidRows,
  noteRows?: ReadonlyMap<string, number | null>,
): PlacedNote[] {
  const lettered = (unlettered: Omit<PlacedNote, 'letter'>[]) =>
    unlettered.map((each, index) => ({ ...each, letter: tableNoteLetter(index) }));
  if (table.type === 'table') {
    return lettered(
      table.rows.flatMap((row, y) =>
        row.cells.flatMap((cell, x) =>
          footnotesIn(cell.content).map((note) => ({ note, row: y, column: x })),
        ),
      ),
    );
  }
  const shown = (column: string) => table.columns.findIndex((each) => each.column === column);
  const laidRow = new Map((laid?.rows ?? []).map((row, at) => [row.index, at]));
  type Place = Omit<PlacedNote, 'letter'> & { readonly order: number };
  const places = (table.notes ?? []).flatMap((note, order): Place[] => {
    const { anchor } = note;
    if (anchor.kind === 'column') return [{ note, row: null, column: shown(anchor.column), order }];
    if (anchor.kind !== 'keyed') return [];
    const index = noteRows?.get(note.id);
    const row = index == null ? undefined : laidRow.get(index);
    return row === undefined ? [] : [{ note, row, column: shown(anchor.column), order }];
  });
  places.sort((a, b) => (a.row ?? -1) - (b.row ?? -1) || a.column - b.column || a.order - b.order);
  return lettered(places.map(({ note, row, column }) => ({ note, row, column })));
}
