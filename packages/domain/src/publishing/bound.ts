import type { BlockNode, BoundTableNode } from '../content/model/blocks.js';
import type { InlineNode } from '../content/model/inline.js';
import type { ColumnAlignment } from '../data/field-format.js';
import type { LaidOut } from '../data/table.js';

/**
 * **A bound table as the binding stage leaves it** (the TB1 plan, TB1-H): an ordinary table's members -
 * a header row from its columns, a row of text cells per laid-out row, the caption, note, style and
 * whether it is numbered - and, beside them, what an authored table has not: each column's alignment
 * and whether it wraps, the source, and per body cell whether it is inset by a parenthesis and the
 * colour a negative is set in. **Internal, outside `blockNodeSchema`**, so no authored table can store
 * these members; numbering, references and `assemble`'s table arm read it as the table it is.
 */
export interface LaidOutMembers {
  readonly align: readonly ColumnAlignment[];
  readonly wrap: readonly boolean[];
  readonly source: readonly InlineNode[] | null;
  /** Whether its one body row is the empty statement, a data cell spanning the table (TAB-011). */
  readonly empty: boolean;
  /** Per body row, per column: the parenthesis inset (TB1-I) and the negative colour (TAB-016). */
  readonly cells: readonly (readonly LaidOutCellMarks[])[];
}

export interface LaidOutCellMarks {
  readonly inset: boolean;
  readonly colour: string | null;
}

type TableNode = Extract<BlockNode, { type: 'table' }>;

export type LaidOutTable = TableNode & { readonly laidOut: LaidOutMembers };

/** Whether a table is a bound table the binding stage laid out, rather than an authored one. */
export function isLaidOut(block: BlockNode): block is LaidOutTable {
  return block.type === 'table' && 'laidOut' in block;
}

/**
 * **The colour a negative is set in where a table style names none** (TAB-016): the default theme's,
 * 6.5:1 on white paper.
 */
export const DEFAULT_NEGATIVE_COLOUR = '#c00000';

const runOf = (value: string): InlineNode[] =>
  value === '' ? [] : [{ type: 'text', value, marks: [] }];

/**
 * **A bound table laid out, as a table** (TB1-H): its header row of the columns' headers, a cell per
 * value of its rows, each one paragraph of the text `layoutTable` printed, in the place's default
 * style; `headerColumns` 1 where its first column heads its row; and, where it has no rows, one row of
 * the statement spanning it, a data cell.
 */
export function laidOutTable(
  table: BoundTableNode,
  laid: LaidOut,
  negativeColour: string,
): LaidOutTable {
  const cell = (content: InlineNode[], at: string, colspan = 1) => ({
    content: [{ type: 'paragraph' as const, id: `${table.id}-${at}`, style: 'body', content }],
    colspan,
    rowspan: 1,
  });
  const header = { cells: laid.header.map((each, x) => cell(runOf(each.text), `h${x}`)) };
  const body =
    laid.empty === null
      ? laid.rows.map((row, y) => ({
          cells: row.cells.map((each, x) => cell(runOf(each.text), `r${y}c${x}`)),
        }))
      : [{ cells: [cell([...laid.empty.content], 'empty', laid.empty.colspan)] }];
  const marks =
    laid.empty === null
      ? laid.rows.map((row) =>
          row.cells.map((each, x): LaidOutCellMarks => {
            const column = laid.columns[x]!;
            return {
              // A value without parentheses in a column printing them, aligned on its separator,
              // stands in by one so its separator meets theirs (TB1-I).
              inset:
                column.align === 'decimal' &&
                column.format.negative === 'parentheses' &&
                !each.text.endsWith(')'),
              colour: each.negative ? negativeColour : null,
            };
          }),
        )
      : [];
  return {
    type: 'table',
    id: table.id,
    style: table.style,
    caption: table.caption,
    headerRows: 1,
    headerColumns: table.headerColumn ? 1 : 0,
    ...(table.note === undefined ? {} : { note: table.note }),
    ...(table.numbered === false ? { numbered: false as const } : {}),
    rows: [header, ...body],
    laidOut: {
      align: laid.columns.map((column) => column.align),
      wrap: laid.columns.map((column) => column.wrap),
      source: table.source ?? null,
      empty: laid.empty !== null,
      cells: marks,
    },
  };
}
