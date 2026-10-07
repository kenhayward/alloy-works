import {
  BOUND_TABLE_COLUMNS_MAX,
  BOUND_TABLE_SORT_MAX,
  type BoundColumn,
  type BoundTableNode,
  type CanonicalValue,
  type TableBinding,
  type TableColumn,
} from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { closeHistory } from 'prosemirror-history';
import { Plugin, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  mergeCells,
  splitCell,
  TableMap,
} from 'prosemirror-tables';

import type { BindingChoice } from './bindings.js';
import { editorSchema } from './schema.js';

const tableFigureNode = editorSchema.nodes.tableFigure;
const tableCaptionNode = editorSchema.nodes.tableCaption;
const tableNode = editorSchema.nodes.table;
const rowNode = editorSchema.nodes.table_row;
const cellNode = editorSchema.nodes.table_cell;
const headerNode = editorSchema.nodes.table_header;
const paragraphNode = editorSchema.nodes.paragraph;

/** A table the cursor stands in, as the table panel reads it. */
export interface TableAt {
  /** Where the table's `tableFigure` starts. */
  readonly pos: number;
  readonly id: string | null;
  /** Its table style, which the Table panel's Table style list shows. */
  readonly style: string;
  readonly headerRows: number;
  readonly headerColumns: number;
  readonly rows: number;
  readonly columns: number;
  /** Whether the table has a note beneath it (footnotes 1, ruling R11). */
  readonly note: boolean;
  /** Whether it takes a number, which the Table panel's Numbered box shows (STR-071). */
  readonly numbered: boolean;
  /** How it is set where too wide (TB3-G), or null for its table style's: the Table panel's Wide. */
  readonly wide: Wide | null;
}

/** How a table too wide for its measure is set (TB3-G). */
export type Wide = 'scale' | 'rotate';

/** The innermost table the selection stands in - its caption or any cell - or null. */
export function tableAt(state: EditorState): TableAt | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type !== tableFigureNode) continue;
    const map = TableMap.get(node.child(1));
    return {
      pos: $from.before(depth),
      id: (node.attrs.id as string | null) ?? null,
      style: node.attrs.style as string,
      headerRows: node.attrs.headerRows as number,
      headerColumns: node.attrs.headerColumns as number,
      rows: map.height,
      columns: map.width,
      note: node.childCount > 2,
      numbered: node.attrs.numbered !== false,
      wide: (node.attrs.wide as Wide | null) ?? null,
    };
  }
  return null;
}

/** What a cell at this place in the grid is: a header, and which way it reads, or a data cell. */
function kindAt(row: number, column: number, headerRows: number, headerColumns: number) {
  if (row < headerRows) return { type: headerNode, scope: 'col' };
  if (column < headerColumns) return { type: headerNode, scope: 'row' };
  return { type: cellNode, scope: null };
}

/**
 * A table's cells, built from rows of stored cells and the header counts - the mapping's half of
 * ruling R2, so a table opens already agreeing with its counts. Each cell's place in the grid is
 * found as HTML and the walk find it: at the first place in its row nothing above covers yet.
 */
export function tableOf(
  rows: readonly { cells: readonly { content: Node[]; colspan: number; rowspan: number }[] }[],
  headerRows: number,
  headerColumns: number,
): Node {
  const covered: boolean[][] = rows.map(() => []);
  return tableNode.create(
    null,
    rows.map((row, rowIndex) => {
      let column = 0;
      return rowNode.create(
        null,
        row.cells.map((cell) => {
          while (covered[rowIndex]![column]) column += 1;
          for (let down = 0; down < cell.rowspan; down += 1) {
            for (let across = 0; across < cell.colspan; across += 1) {
              covered[rowIndex + down]![column + across] = true;
            }
          }
          const kind = kindAt(rowIndex, column, headerRows, headerColumns);
          column += cell.colspan;
          return kind.type.create(
            { colspan: cell.colspan, rowspan: cell.rowspan, colwidth: null, scope: kind.scope },
            cell.content,
          );
        }),
      );
    }),
  );
}

/**
 * **The header counts are the truth; the cells' kinds follow them** (tables 1, ruling R2).
 * `prosemirror-tables` knows a header cell from a data cell by its node type, and the model stores
 * two counts, so after every transaction that changes a document each cell is made the kind its
 * place in the grid gives it - a row added above the header row becomes a header row, a merged cell
 * takes the kind of the place it starts - and each count is clamped to the table it counts.
 *
 * **Kept out of the history**, as the identity plugin's renewals are (issue #166): it is bookkeeping
 * derived from the document, and an undo that reverted it would only have it done again.
 */
export const tableHeadersAgree = new Plugin({
  appendTransaction(transactions, _old, state) {
    if (!transactions.some((transaction) => transaction.docChanged)) return null;
    const figures: { node: Node; pos: number }[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type !== tableFigureNode) return true;
      figures.push({ node, pos });
      return false;
    });
    const tr = state.tr;
    // Last first, so that taking a table away moves nothing still to be looked at.
    for (const { node, pos } of figures.reverse()) {
      const table = node.child(1);
      const map = TableMap.get(table);
      // A deletion running across a table can leave rows with no cell in any of them, which no
      // repair of `prosemirror-tables` fills, since there is no width to fill them to. A table of no
      // cells is no table, and the walk refuses one, so it goes - as Delete table takes it.
      if (map.width === 0) {
        const only = state.doc.resolve(pos).parent.childCount === 1;
        if (only) tr.replaceWith(pos, pos + node.nodeSize, paragraphNode.create());
        else tr.delete(pos, pos + node.nodeSize);
        continue;
      }
      const tableStart = pos + 1 + node.child(0).nodeSize + 1;
      const headerRows = Math.min(node.attrs.headerRows as number, map.height);
      const headerColumns = Math.min(node.attrs.headerColumns as number, map.width);
      if (headerRows !== node.attrs.headerRows || headerColumns !== node.attrs.headerColumns) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, headerRows, headerColumns });
      }
      for (const cellPos of new Set(map.map)) {
        const cell = table.nodeAt(cellPos)!;
        const place = map.findCell(cellPos);
        const kind = kindAt(place.top, place.left, headerRows, headerColumns);
        if (cell.type !== kind.type || cell.attrs.scope !== kind.scope) {
          tr.setNodeMarkup(tableStart + cellPos, kind.type, { ...cell.attrs, scope: kind.scope });
        }
      }
    }
    return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
  },
});

/** Whether the selection stands anywhere a table may not be put: in a table, a term, a caption, code. */
function nowhereForATable(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to)) return true;
  if ($from.parent.type !== paragraphNode) return true;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === tableFigureNode) return true;
  }
  return false;
}

/**
 * **Table**: three columns by three rows, the first a header row, with an empty caption above and the
 * cursor in the first cell (tables 1, ruling R3). It goes after the paragraph the cursor is in, or in
 * its place where that paragraph is empty, since an empty paragraph is where an author stands to put
 * something new. It declines in a table - a cell holds no table (decision T-D) - and anywhere that is
 * not a paragraph: a term, an attribution, a caption, preformatted text.
 */
export function insertTable(newIdentifier: () => string): Command {
  return (state, dispatch) => {
    if (nowhereForATable(state)) return false;
    const { $from } = state.selection;
    const depth = $from.depth;
    const index = $from.index(depth - 1);
    const parent = $from.node(depth - 1);
    const empty = $from.parent.content.size === 0;
    const at = empty ? index : index + 1;
    if (!parent.canReplaceWith(at, empty ? index + 1 : at, tableFigureNode)) return false;
    if (dispatch) {
      const blankRow = () => ({
        cells: [0, 1, 2].map(() => ({
          content: [paragraphNode.create()],
          colspan: 1,
          rowspan: 1,
        })),
      });
      const figure = tableFigureNode.create(
        { id: newIdentifier(), style: 'table', headerRows: 1, headerColumns: 0 },
        [tableCaptionNode.create(), tableOf([blankRow(), blankRow(), blankRow()], 1, 0)],
      );
      const start = empty ? $from.before(depth) : $from.after(depth);
      const tr = empty
        ? state.tr.replaceWith(start, $from.after(depth), figure)
        : state.tr.insert(start, figure);
      // Into the figure, past the caption, into the table, the first row, its first cell and that
      // cell's paragraph.
      const firstCell = start + 1 + figure.child(0).nodeSize + 1 + 1 + 1 + 1;
      dispatch(tr.setSelection(TextSelection.create(tr.doc, firstCell)).scrollIntoView());
    }
    return true;
  };
}

/** Sets a table's header rows and columns, clamped to it; the cells follow (`tableHeadersAgree`). */
export function setTableHeaders(counts: { rows?: number; columns?: number }): Command {
  return (state, dispatch) => {
    const table = tableAt(state);
    if (table === null) return false;
    const headerRows = Math.max(0, Math.min(counts.rows ?? table.headerRows, table.rows));
    const headerColumns = Math.max(
      0,
      Math.min(counts.columns ?? table.headerColumns, table.columns),
    );
    if (headerRows === table.headerRows && headerColumns === table.headerColumns) return false;
    if (dispatch) {
      const node = state.doc.nodeAt(table.pos)!;
      dispatch(
        state.tr.setNodeMarkup(table.pos, undefined, { ...node.attrs, headerRows, headerColumns }),
      );
    }
    return true;
  };
}

/**
 * **Numbered**, from the Table panel (STR-071): marks the table the cursor stands in unnumbered, so it
 * takes no number and uses up none, or numbered again. Its caption stays, and stays required
 * (TAB-034). One step for the undo history; declined where it already is what it is asked to be.
 */
export function setTableNumbered(numbered: boolean): Command {
  return (state, dispatch) => {
    const table = tableAt(state);
    if (table === null || table.numbered === numbered) return false;
    if (dispatch) {
      const node = state.doc.nodeAt(table.pos)!;
      dispatch(state.tr.setNodeMarkup(table.pos, undefined, { ...node.attrs, numbered }));
    }
    return true;
  };
}

/**
 * **Wide**, from the Table panel (TB3-G; TB3.3): how the table the cursor stands in is set where too
 * wide - scaled, rotated, or null for its table style's. One step; declined where it already is.
 */
export function setTableWide(wide: Wide | null): Command {
  return (state, dispatch) => {
    const table = tableAt(state);
    if (table === null || table.wide === wide) return false;
    if (dispatch) {
      const node = state.doc.nodeAt(table.pos)!;
      dispatch(state.tr.setNodeMarkup(table.pos, undefined, { ...node.attrs, wide }));
    }
    return true;
  };
}

/** What the table panel does, each one command (tables 1, ruling R4). */
export type TableAction =
  | 'rowAbove'
  | 'rowBelow'
  | 'columnBefore'
  | 'columnAfter'
  | 'deleteRow'
  | 'deleteColumn'
  | 'merge'
  | 'split'
  | 'deleteTable'
  | 'addNote'
  | 'removeNote';

/**
 * Removes the whole table, caption and all. `prosemirror-tables`' own `deleteTable` removes the
 * `table` node alone, which would leave a caption over nothing - a figure the schema refuses - so the
 * figure goes instead, and where it was the only block its parent must keep one, an empty paragraph
 * takes its place.
 */
const deleteTableFigure: Command = (state, dispatch) => {
  const table = tableAt(state);
  if (table === null) return false;
  if (dispatch) {
    const node = state.doc.nodeAt(table.pos)!;
    const $pos = state.doc.resolve(table.pos);
    const only = $pos.parent.childCount === 1;
    const end = table.pos + node.nodeSize;
    const tr = only
      ? state.tr.replaceWith(table.pos, end, paragraphNode.create())
      : state.tr.delete(table.pos, end);
    const near = TextSelection.near(tr.doc.resolve(Math.min(table.pos, tr.doc.content.size)));
    dispatch(tr.setSelection(near).scrollIntoView());
  }
  return true;
};

/**
 * Adds an empty note beneath the table and puts the cursor in it (CNT-038, footnotes 1, ruling R11):
 * a note on the table as a whole, which is how the model says one (FN-C). Declines where the table
 * has one already.
 */
const addNote: Command = (state, dispatch) => {
  const table = tableAt(state);
  if (table === null || table.note) return false;
  if (dispatch) {
    const end = table.pos + state.doc.nodeAt(table.pos)!.nodeSize - 1;
    const tr = state.tr.insert(end, editorSchema.nodes.tableNote!.create());
    dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)).scrollIntoView());
  }
  return true;
};

/**
 * Removes the table's note, whatever it holds; `Ctrl+Z` brings it back. A cursor in it goes to the
 * end of the table's last cell. Declines where the table has none.
 */
const removeNote: Command = (state, dispatch) => {
  const table = tableAt(state);
  if (table === null || !table.note) return false;
  if (dispatch) {
    const figure = state.doc.nodeAt(table.pos)!;
    const note = figure.child(2);
    const end = table.pos + figure.nodeSize - 1;
    const tr = state.tr.delete(end - note.nodeSize, end);
    const $near = tr.doc.resolve(tr.mapping.map(state.selection.from, -1));
    dispatch(tr.setSelection(TextSelection.near($near, -1)).scrollIntoView());
  }
  return true;
};

/**
 * One of the panel's commands. Each is `prosemirror-tables`' own, which keep the grid whole - the
 * walk's rule (decision T-C) - except deleting the table, which takes its caption with it; and deleting
 * the last row or column declines, since `prosemirror-tables` would take the table and leave the
 * caption.
 */
export function tableCommand(action: TableAction): Command {
  switch (action) {
    case 'rowAbove':
      return addRowBefore;
    case 'rowBelow':
      return addRowAfter;
    case 'columnBefore':
      return addColumnBefore;
    case 'columnAfter':
      return addColumnAfter;
    case 'deleteRow':
      return (state, dispatch) => (tableAt(state)?.rows ?? 0) > 1 && deleteRow(state, dispatch);
    case 'deleteColumn':
      return (state, dispatch) =>
        (tableAt(state)?.columns ?? 0) > 1 && deleteColumn(state, dispatch);
    case 'merge':
      return mergeCells;
    case 'split':
      return splitCell;
    case 'deleteTable':
      return deleteTableFigure;
    case 'addNote':
      return addNote;
    case 'removeNote':
      return removeNote;
  }
}

const boundTableNode = editorSchema.nodes.boundTable!;
const boundTableBodyNode = editorSchema.nodes.boundTableBody!;

/** What the Value dialog chooses for a bound table: a binding's members but its take (TB2-E). */
export type TableChoice = Omit<BindingChoice, 'take'>;

/** A bound table's sort key, as stored. */
export type SortKey = NonNullable<BoundTableNode['sort']>[number];

/** A bound table's own parts beneath its body, each present only where stored (TB2-C). */
export type BoundTablePart = 'empty' | 'note' | 'source';

const PART_NODES = {
  empty: 'boundTableEmpty',
  note: 'tableNote',
  source: 'boundTableSource',
} as const satisfies Record<BoundTablePart, string>;

/** A bound table's children beneath its body, in the order they stand (TB2-C; TB3.3). */
const BENEATH: readonly string[] = [
  'boundTableEmpty',
  'tableNote',
  'boundTableNote',
  'boundTableSource',
];

const boundTableNoteNode = editorSchema.nodes.boundTableNote!;
const footnoteParagraphNode = editorSchema.nodes.footnoteParagraph!;

/** The most notes a bound table holds (TB3-A). */
export const BOUND_TABLE_NOTES_MAX = 200;

/** A bound table's note's anchor (TB3-A): on a cell by the definition's key, or on a column. */
export type BoundNoteAnchor =
  | {
      readonly kind: 'keyed';
      readonly key: Readonly<Record<string, CanonicalValue>>;
      readonly column: string;
    }
  | { readonly kind: 'column'; readonly column: string };

/** One of a bound table's notes, as the panel lists it: its identifier and anchor. */
export interface BoundNoteAt {
  readonly id: string | null;
  readonly anchor: BoundNoteAnchor;
}

/** The bound table the cursor stands in, as the Bound table panel reads it (TB2-F). */
export interface BoundTablePlace {
  /** Where the `boundTable` node starts. */
  readonly pos: number;
  readonly id: string | null;
  readonly style: string;
  readonly numbered: boolean;
  readonly binding: TableBinding;
  readonly columns: readonly BoundColumn[];
  readonly headerColumn: boolean;
  readonly sort: readonly SortKey[];
  /** Whether it has an empty statement, a note and a source. */
  readonly parts: Readonly<Record<BoundTablePart, boolean>>;
  /** Its keyed and column notes, in the order they stand beneath it (TB3.3). */
  readonly notes: readonly BoundNoteAt[];
  /** How it is set where too wide (TB3-G), or null for its table style's. */
  readonly wide: Wide | null;
}

function placeOf(node: Node, pos: number): BoundTablePlace {
  const has = (type: string) => {
    let found = false;
    node.forEach((child) => {
      if (child.type.name === type) found = true;
    });
    return found;
  };
  return {
    pos,
    id: (node.attrs.id as string | null) ?? null,
    style: node.attrs.style as string,
    numbered: node.attrs.numbered !== false,
    binding: node.attrs.binding as TableBinding,
    columns: node.attrs.columns as BoundColumn[],
    headerColumn: node.attrs.headerColumn as boolean,
    sort: (node.attrs.sort as SortKey[] | null) ?? [],
    parts: {
      empty: has(PART_NODES.empty),
      note: has(PART_NODES.note),
      source: has(PART_NODES.source),
    },
    notes: notesOf(node),
    wide: (node.attrs.wide as Wide | null) ?? null,
  };
}

function notesOf(node: Node): BoundNoteAt[] {
  const notes: BoundNoteAt[] = [];
  node.forEach((child) => {
    if (child.type !== boundTableNoteNode) return;
    notes.push({
      id: (child.attrs.id as string | null) ?? null,
      anchor: child.attrs.anchor as BoundNoteAnchor,
    });
  });
  return notes;
}

/** The bound table the selection stands in - its caption or a part - or has selected whole, or null. */
export function boundTableAt(state: EditorState): BoundTablePlace | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === boundTableNode) return placeOf(node, $from.before(depth));
  }
  const selected = state.doc.nodeAt(state.selection.from);
  if (
    selected?.type === boundTableNode &&
    state.selection.to === state.selection.from + selected.nodeSize
  ) {
    return placeOf(selected, state.selection.from);
  }
  return null;
}

/**
 * **The columns a bound table starts with** (TB2-E): the first 64 declared columns that are not
 * images, in the definition's order, each headed by its name; and how many were left out.
 */
export function columnsPlaced(declared: readonly TableColumn[]): {
  readonly columns: readonly BoundColumn[];
  readonly left: number;
} {
  const columns = declared
    .filter((each) => each.type.base !== 'image')
    .slice(0, BOUND_TABLE_COLUMNS_MAX)
    .map((each) => ({ column: each.name, header: each.name.normalize('NFC') }));
  return { columns, left: declared.length - columns.length };
}

/**
 * The column a list shows twice under one header, by the walk's rule (TAB-048, `column_repeated`):
 * headers in NFC folded to one case. Null where there is none.
 */
export function repeatedColumn(columns: readonly BoundColumn[]): string | null {
  const headers = new Map<string, Set<string>>();
  for (const column of columns) {
    const seen = headers.get(column.column) ?? new Set<string>();
    const header = column.header.normalize('NFC').toLocaleLowerCase('und');
    if (seen.has(header)) return column.column;
    seen.add(header);
    headers.set(column.column, seen);
  }
  return null;
}

const bindingOf = (id: string, choice: TableChoice): TableBinding => ({
  type: 'binding',
  id,
  query: choice.query,
  ...(choice.version === undefined ? {} : { version: choice.version }),
  parameters: choice.parameters,
  mode: choice.mode,
});

/**
 * **Place as Table** (TB2-E): a bound table of the chosen definition where a table may go - after the
 * paragraph the cursor is in, or in its place where that paragraph is empty - showing `columnsPlaced`'s
 * columns, its caption empty and the cursor in it. Its binding is given a fresh identifier, as a placed
 * binding is. Declines where no column could be shown.
 */
export function insertBoundTable(
  choice: TableChoice,
  declared: readonly TableColumn[],
  newIdentifier: () => string,
): Command {
  return (state, dispatch) => {
    if (nowhereForATable(state)) return false;
    const { columns } = columnsPlaced(declared);
    if (columns.length === 0) return false;
    const { $from } = state.selection;
    const depth = $from.depth;
    const index = $from.index(depth - 1);
    const parent = $from.node(depth - 1);
    const empty = $from.parent.content.size === 0;
    const at = empty ? index : index + 1;
    if (!parent.canReplaceWith(at, empty ? index + 1 : at, boundTableNode)) return false;
    if (dispatch) {
      const table = boundTableNode.create(
        {
          id: newIdentifier(),
          style: 'table',
          binding: bindingOf(newIdentifier(), choice),
          columns,
          headerColumn: false,
          sort: null,
        },
        [tableCaptionNode.create(), boundTableBodyNode.create()],
      );
      const start = empty ? $from.before(depth) : $from.after(depth);
      const tr = empty
        ? state.tr.replaceWith(start, $from.after(depth), table)
        : state.tr.insert(start, table);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, start + 2)).scrollIntoView());
    }
    return true;
  };
}

/**
 * Changes the binding of the bound table at `pos`, keeping its identifier - the same binding, changed
 * (TB2-G) - and every column, so one the new definition lacks shows `column_missing`.
 */
export function changeTableBinding(pos: number, choice: TableChoice): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type !== boundTableNode) return false;
    if (dispatch) {
      const held = node.attrs.binding as TableBinding;
      dispatch(
        state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          binding: bindingOf(held.id, choice),
        }),
      );
    }
    return true;
  };
}

/** What the Bound table panel changes, each one transaction (TB2-F). */
export interface BoundTableChange {
  readonly columns?: readonly BoundColumn[];
  readonly headerColumn?: boolean;
  readonly sort?: readonly SortKey[];
  readonly numbered?: boolean;
  /** Wide (TB3-G): scale, rotate, or null for the table style's. */
  readonly wide?: Wide | null;
}

/** A column as stored: its header and unit in NFC, an empty unit none. */
function columnStored(column: BoundColumn): BoundColumn {
  const { unit, ...rest } = column;
  return {
    ...rest,
    header: column.header.normalize('NFC'),
    ...(unit === undefined || unit.text === ''
      ? {}
      : { unit: { ...unit, text: unit.text.normalize('NFC') } }),
  };
}

/**
 * **The Bound table panel's change** (TB2-F) to the table the cursor stands in, one step for the undo
 * history. Declines what the walk would refuse - no column or more than 64, a header empty or over 200
 * characters, a unit over 40, a column shown twice under one header (TAB-048), more than four sort
 * keys or one column sorted twice - and a change that changes nothing.
 *
 * Its own step even beside another made at once, unless `typed`: a header or a unit typed in the panel
 * a keystroke at a time joins the steps typed just before it, as typing in the text does.
 */
export function setBoundTable(change: BoundTableChange, { typed = false } = {}): Command {
  return (state, dispatch) => {
    const table = boundTableAt(state);
    if (table === null) return false;
    const columns = change.columns?.map(columnStored);
    if (columns !== undefined) {
      if (columns.length === 0 || columns.length > BOUND_TABLE_COLUMNS_MAX) return false;
      if (columns.some((each) => each.header === '' || [...each.header].length > 200)) {
        return false;
      }
      if (columns.some((each) => each.unit !== undefined && [...each.unit.text].length > 40)) {
        return false;
      }
      if (repeatedColumn(columns) !== null) return false;
    }
    const sort = change.sort;
    if (sort !== undefined) {
      if (sort.length > BOUND_TABLE_SORT_MAX) return false;
      if (new Set(sort.map((each) => each.column)).size !== sort.length) return false;
    }
    const node = state.doc.nodeAt(table.pos)!;
    const attrs = {
      ...node.attrs,
      ...(columns === undefined ? {} : { columns }),
      ...(change.headerColumn === undefined ? {} : { headerColumn: change.headerColumn }),
      ...(sort === undefined ? {} : { sort: sort.length === 0 ? null : [...sort] }),
      ...(change.numbered === undefined ? {} : { numbered: change.numbered }),
      ...(change.wide === undefined ? {} : { wide: change.wide }),
    };
    if (JSON.stringify(attrs) === JSON.stringify(node.attrs)) return false;
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(table.pos, undefined, attrs);
      dispatch(typed ? tr : closeHistory(tr));
    }
    return true;
  };
}

/**
 * Adds a bound table's empty statement, note or source, empty and in its place, the cursor in it; or
 * removes it, whatever it holds (TB2-F). Declines where it already is as asked.
 */
export function setBoundTablePart(part: BoundTablePart, present: boolean): Command {
  return (state, dispatch) => {
    const table = boundTableAt(state);
    if (table === null || table.parts[part] === present) return false;
    if (dispatch) {
      const node = state.doc.nodeAt(table.pos)!;
      const wanted = BENEATH.indexOf(PART_NODES[part]);
      // After the caption, the body and every child that stands before this one: its notes before
      // the source (TB3.3).
      let at = table.pos + 1;
      let found: { readonly from: number; readonly to: number } | null = null;
      node.forEach((child, offset) => {
        const from = table.pos + 1 + offset;
        if (child.type.name === PART_NODES[part]) found = { from, to: from + child.nodeSize };
        if (BENEATH.indexOf(child.type.name) < wanted) at = from + child.nodeSize;
      });
      if (present) {
        const tr = state.tr.insert(at, editorSchema.nodes[PART_NODES[part]]!.create());
        dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
      } else if (found !== null) {
        const { from, to } = found;
        const tr = state.tr.delete(from, to);
        const $near = tr.doc.resolve(Math.min(tr.mapping.map(state.selection.from, -1), from));
        dispatch(tr.setSelection(TextSelection.near($near, -1)).scrollIntoView());
      }
    }
    return true;
  };
}

/**
 * **Add note** (TB3.3; TB3-A): a note beneath the bound table the cursor stands in, after its other
 * notes, anchored on a column it shows or on that column's cell in the row a key names - the key's
 * values already canonical, as the panel makes them - one empty paragraph with the cursor in it. Its
 * identifier, and its paragraph's, the identity plugin gives. Declines a column not shown, a key of
 * no column, and a 201st note.
 */
export function addBoundTableNote(anchor: BoundNoteAnchor): Command {
  return (state, dispatch) => {
    const table = boundTableAt(state);
    if (table === null || table.notes.length >= BOUND_TABLE_NOTES_MAX) return false;
    if (!table.columns.some((each) => each.column === anchor.column)) return false;
    if (anchor.kind === 'keyed' && Object.keys(anchor.key).length === 0) return false;
    if (dispatch) {
      const node = state.doc.nodeAt(table.pos)!;
      const source = BENEATH.indexOf('boundTableSource');
      let at = table.pos + 1;
      node.forEach((child, offset) => {
        if (BENEATH.indexOf(child.type.name) < source) at = table.pos + 1 + offset + child.nodeSize;
      });
      const note = boundTableNoteNode.create({ id: null, anchor }, footnoteParagraphNode.create());
      const tr = state.tr.insert(at, note);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView());
    }
    return true;
  };
}

/** **Edit**, a bound table's note (TB3.3): the cursor put at the start of its words, typed in place. */
export function selectBoundTableNote(id: string): Command {
  return (state, dispatch) => {
    const table = boundTableAt(state);
    if (table === null) return false;
    let at = -1;
    state.doc.nodeAt(table.pos)!.forEach((child, offset) => {
      if (child.type === boundTableNoteNode && child.attrs.id === id)
        at = table.pos + 1 + offset + 2;
    });
    if (at < 0) return false;
    if (dispatch) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)).scrollIntoView());
    }
    return true;
  };
}

/** **Remove**, a bound table's note (TB3.3): the one with this identifier, whole, in the table the cursor stands in. */
export function removeBoundTableNote(id: string): Command {
  return (state, dispatch) => {
    const table = boundTableAt(state);
    if (table === null) return false;
    const node = state.doc.nodeAt(table.pos)!;
    let found: { readonly from: number; readonly to: number } | null = null;
    node.forEach((child, offset) => {
      if (child.type !== boundTableNoteNode || child.attrs.id !== id) return;
      const from = table.pos + 1 + offset;
      found = { from, to: from + child.nodeSize };
    });
    if (found === null) return false;
    if (dispatch) {
      const { from, to } = found;
      const tr = state.tr.delete(from, to);
      const $near = tr.doc.resolve(Math.min(from, tr.doc.content.size));
      dispatch(tr.setSelection(TextSelection.near($near, -1)).scrollIntoView());
    }
    return true;
  };
}

/** Removes the bound table the cursor stands in, whole; where it was the only block, a paragraph stays. */
export const deleteBoundTable: Command = (state, dispatch) => {
  const table = boundTableAt(state);
  if (table === null) return false;
  if (dispatch) {
    const node = state.doc.nodeAt(table.pos)!;
    const only = state.doc.resolve(table.pos).parent.childCount === 1;
    const end = table.pos + node.nodeSize;
    const tr = only
      ? state.tr.replaceWith(table.pos, end, paragraphNode.create())
      : state.tr.delete(table.pos, end);
    const near = TextSelection.near(tr.doc.resolve(Math.min(table.pos, tr.doc.content.size)));
    dispatch(tr.setSelection(near).scrollIntoView());
  }
  return true;
};
