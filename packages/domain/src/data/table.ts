import type { BoundTableNode } from '../content/model/blocks.js';
import type { InlineNode } from '../content/model/inline.js';
import type { ValueFormats } from '../theme/schema.js';
import {
  compareCanonical,
  compareCodePoints,
  type CanonicalResult,
  type CanonicalValue,
} from './canonical.js';
import type { ColumnType } from './columns.js';
import type { Column } from './definition.js';
import {
  DEFAULT_TABLE_ALIGN,
  DEFAULT_TABLE_FIELDS,
  type ColumnAlignment,
  type FieldFormat,
  type FieldKey,
} from './field-format.js';
import {
  colouredNegative,
  formatCell,
  parenthesised,
  formatMismatch,
  mergeFormat,
  type CellWords,
} from './format-cell.js';

/**
 * **A bound table laid out** (tables.md; the TB1 plan, TB1-E): one pure function the page and the
 * publish's stage share, from a presentation, a result, its declared columns, the table style and the
 * value formats for the document's language, to rows of formatted text - or every failure, by name.
 */

/**
 * **The most rows a bound table prints** (tables.md, `table_too_long`; TB1-K), measured by TB1.2 in a
 * `node:24-bookworm` container limited to 1 GiB and 2 CPUs: an 8-column table through `assemble`, the
 * Word writer and the pinned Typst. 2,000 rows published in 3.5 s; 2,200 were killed for memory, the
 * engine's, never time - 10,000 would need about 5 GiB. An authored table of as many cells costs the
 * engine as much. The plan's "Changed while building" has the figures.
 */
export const TABLE_ROWS_MAX = 2_000;

/**
 * What a table style says of a bound table's cells (STY-014, STY-077; TB1-F): a format by type, an
 * alignment by type, and how a unit in a header is bracketed. Optional members of the table style at
 * `catalogue/3`, read as the product's defaults below where a stored style names none.
 */
export interface TablePresentation {
  readonly fields?: { readonly [K in FieldKey]?: FieldFormat | undefined } | undefined;
  readonly align?: { readonly [K in FieldKey]?: ColumnAlignment | undefined } | undefined;
  readonly unitBrackets?: 'parentheses' | 'brackets' | undefined;
}

/** Why a bound table cannot be laid out, each naming its column, or its member or count. */
export type TableFailure =
  | { readonly code: 'column_missing' | 'column_image'; readonly column: string }
  | { readonly code: 'format_mismatch'; readonly column: string; readonly detail: string }
  | { readonly code: 'table_too_long'; readonly detail: string };

/** A column as laid out: its result column, type, header, merged format, alignment and wrap. */
export interface LaidOutColumn {
  readonly name: string;
  readonly type: ColumnType;
  readonly header: string;
  readonly format: FieldFormat;
  readonly align: ColumnAlignment;
  readonly wrap: boolean;
}

/** A cell as laid out: what it prints, the canonical value it printed, its scope and its colour. */
export interface LaidOutCell {
  readonly text: string;
  readonly value: CanonicalValue;
  /** `row` where the table's first column heads its row; else a data cell. */
  readonly scope: 'row' | null;
  /** Whether it is set in the style's negative colour, beside its sign (TAB-016). */
  readonly negative: boolean;
  /** Whether it prints its value in parentheses, as its format asks of a negative (TAB-016). */
  readonly parenthesised: boolean;
}

/**
 * **A bound table laid out**: its header row, as text with a unit bracketed; its columns; its rows in
 * order; and, where it has none, the statement spanning it, a data cell (TAB-011).
 */
export interface LaidOut {
  readonly header: readonly { readonly text: string }[];
  readonly columns: readonly LaidOutColumn[];
  readonly rows: readonly { readonly cells: readonly LaidOutCell[] }[];
  readonly empty: {
    readonly content: readonly InlineNode[];
    readonly colspan: number;
    readonly scope: null;
  } | null;
}

/** The words a bound table prints that are the layout's: what no rows says, what a null says. */
export interface TableWords extends CellWords {
  readonly noRows: string;
}

/**
 * Two rows' values of one column, by the sort's rule (TAB-007, tables.md "Order"): text by code point
 * of its NFC form, everything else by the product's comparison over canonical values; nulls where the
 * key says, whichever the direction.
 */
function compareBy(
  type: ColumnType,
  a: CanonicalValue,
  b: CanonicalValue,
  key: NonNullable<BoundTableNode['sort']>[number],
): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return (a === null) === (key.nulls === 'first') ? -1 : 1;
  }
  const compared =
    type.base === 'text' && typeof a === 'string' && typeof b === 'string'
      ? compareCodePoints(a.normalize('NFC'), b.normalize('NFC'))
      : compareCanonical(type, a, b);
  return key.direction === 'ascending' ? compared : -compared;
}

/** A declared column as a check reads it: its name and its type, whoever may read the rest. */
export type TableColumn = Pick<Column, 'name' | 'type'>;

/** The format a shown column is printed in: its type's in the style, then its own (TAB-037). */
const formatOf = (
  shown: BoundTableNode['columns'][number],
  type: ColumnType,
  style: TablePresentation,
): FieldFormat =>
  mergeFormat(
    mergeFormat(DEFAULT_TABLE_FIELDS[type.base as FieldKey], style.fields?.[type.base as FieldKey]),
    shown.format,
  );

/**
 * **`checkTable`** (the TB2 plan, TB2-B): every failure `layoutTable` finds before it lays a row out,
 * from the declared columns and the row count alone, so the page can say a result is too long, or a
 * column gone, without reading its rows. `columns` are the result's: the declared columns it has.
 * In `layoutTable`'s order: each column shown - `column_missing` (TAB-004), `column_image`,
 * `format_mismatch` - then each sort key, then `table_too_long`.
 */
export function checkTable<C extends TableColumn>(
  table: BoundTableNode,
  columns: readonly C[],
  rowCount: number,
  style: TablePresentation,
): readonly TableFailure[] {
  const failures: TableFailure[] = [];
  const declared = new Map(columns.map((column) => [column.name, column]));
  const missing = new Set<string>();
  const found = (name: string) => {
    const column = declared.get(name);
    if (column === undefined && !missing.has(name)) {
      failures.push({ code: 'column_missing', column: name });
    }
    if (column === undefined) missing.add(name);
    return column;
  };
  for (const shown of table.columns) {
    const column = found(shown.column);
    if (column === undefined) continue;
    if (column.type.base === 'image') {
      failures.push({ code: 'column_image', column: shown.column });
      continue;
    }
    for (const member of formatMismatch(column.type, formatOf(shown, column.type, style))) {
      failures.push({ code: 'format_mismatch', column: shown.column, detail: member });
    }
  }
  for (const key of table.sort ?? []) {
    const column = found(key.column);
    if (column?.type.base === 'image') failures.push({ code: 'column_image', column: key.column });
  }
  if (rowCount > TABLE_ROWS_MAX) {
    failures.push({ code: 'table_too_long', detail: String(rowCount) });
  }
  return failures;
}

/** Stored order, then each sort key in turn; the stored position breaks every tie (TAB-007). */
function orderOf(
  result: CanonicalResult,
  sort: readonly {
    readonly key: NonNullable<BoundTableNode['sort']>[number];
    readonly type: ColumnType;
    readonly index: number;
  }[],
): number[] {
  const order = result.rows.map((_, index) => index);
  if (sort.length > 0) {
    order.sort((x, y) => {
      for (const { key, type, index } of sort) {
        const compared = compareBy(type, result.rows[x]![index]!, result.rows[y]![index]!, key);
        if (compared !== 0) return compared;
      }
      return x - y;
    });
  }
  return order;
}

/**
 * **A result in a bound table's order** (the TB2 final review): its rows sorted stably by the table's
 * sort, as `layoutTable` sorts them, every column kept - so the rows route can send a reader rows in
 * order without the columns they were sorted by. A sort column the result or the declared columns
 * lack is passed over; `layoutTable` says so.
 */
export function sortResult<C extends TableColumn>(
  table: BoundTableNode,
  result: CanonicalResult,
  columns: readonly C[],
): CanonicalResult {
  const at = new Map(result.columns.map(([name], index) => [name, index]));
  const declared = new Map(columns.map((column) => [column.name, column]));
  const sort = (table.sort ?? []).flatMap((key) => {
    const column = declared.get(key.column);
    const index = at.get(key.column);
    return column === undefined || index === undefined ? [] : [{ key, type: column.type, index }];
  });
  return {
    columns: result.columns,
    rows: orderOf(result, sort).map((index) => result.rows[index]!),
  };
}

/**
 * **`layoutTable`** (TB1-E): the columns shown in their order, headed as declared, a unit in the header
 * bracketed as the style says (TAB-001 to TAB-003); the rows in the result's stored order (TAB-006),
 * then sorted stably, ties keeping it (TAB-007); each cell by `formatCell` in its column's format over
 * its type's in the style (TAB-012), aligned by the column, else the style, else its type (TAB-046).
 * No rows lays out the statement declared, else `words.noRows` (TAB-011).
 *
 * Fails, every failure gathered, as `checkTable` finds them over the declared columns the result has.
 *
 * **`limit`** (TB2-B): every row is sorted and only the first `limit` formatted and returned - the
 * page's 50 of up to 2,000. The publish passes none. **`presorted`**: the rows are already in the
 * table's order (`sortResult`), so its sort is neither applied nor its columns looked for.
 */
export function layoutTable<C extends TableColumn>(
  table: BoundTableNode,
  result: CanonicalResult,
  columns: readonly C[],
  style: TablePresentation,
  formats: ValueFormats,
  words: TableWords,
  options: { readonly limit?: number; readonly presorted?: boolean } = {},
): LaidOut | { readonly failures: readonly TableFailure[] } {
  // Already in the table's order, its sort columns perhaps not sent (the TB2 final review).
  if (options.presorted === true && table.sort !== undefined) {
    const unsorted: BoundTableNode = { ...table };
    delete unsorted.sort;
    return layoutTable(unsorted, result, columns, style, formats, words, { ...options });
  }
  const at = new Map(result.columns.map(([name], index) => [name, index]));
  const present = columns.filter((column) => at.has(column.name));
  const failures = checkTable(table, present, result.rows.length, style);
  if (failures.length > 0) return { failures };
  const declared = new Map(present.map((column) => [column.name, column]));

  const [open, close] = style.unitBrackets === 'brackets' ? ['[', ']'] : ['(', ')'];
  const laidColumns = table.columns.map((shown): LaidOutColumn => {
    const { type } = declared.get(shown.column)!;
    const base = type.base as FieldKey;
    return {
      name: shown.column,
      type,
      header:
        shown.unit?.place === 'header'
          ? `${shown.header} ${open}${shown.unit.text}${close}`
          : shown.header,
      format: formatOf(shown, type, style),
      align: shown.align ?? style.align?.[base] ?? DEFAULT_TABLE_ALIGN[base],
      wrap: shown.wrap !== false,
    };
  });
  const sort = (table.sort ?? []).map((key) => ({
    key,
    type: declared.get(key.column)!.type,
    index: at.get(key.column)!,
  }));

  const order = orderOf(result, sort);
  const units = table.columns.map((shown) =>
    shown.unit?.place === 'value' ? shown.unit.text : undefined,
  );
  const indexes = laidColumns.map((column) => at.get(column.name)!);
  const shownOrder = options.limit === undefined ? order : order.slice(0, options.limit);
  const rows = shownOrder.map((index) => {
    const row = result.rows[index]!;
    return {
      cells: laidColumns.map((column, place): LaidOutCell => {
        const value = row[indexes[place]!] ?? null;
        return {
          text: formatCell(value, column.type, column.format, formats, words, units[place]),
          value,
          scope: table.headerColumn && place === 0 ? 'row' : null,
          negative: colouredNegative(value, column.type, column.format),
          parenthesised: parenthesised(value, column.type, column.format),
        };
      }),
    };
  });
  return {
    header: laidColumns.map((column) => ({ text: column.header })),
    columns: laidColumns,
    rows,
    empty:
      result.rows.length > 0
        ? null
        : {
            content: table.empty ?? [{ type: 'text', value: words.noRows, marks: [] }],
            colspan: laidColumns.length,
            scope: null,
          },
  };
}
