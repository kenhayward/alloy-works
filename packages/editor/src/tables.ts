import type { Node } from 'prosemirror-model';
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
  readonly headerRows: number;
  readonly headerColumns: number;
  readonly rows: number;
  readonly columns: number;
}

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
      headerRows: node.attrs.headerRows as number,
      headerColumns: node.attrs.headerColumns as number,
      rows: map.height,
      columns: map.width,
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
  | 'deleteTable';

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
  }
}
