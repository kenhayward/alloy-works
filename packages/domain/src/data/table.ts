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
 * engine as much. **Re-timed by TB3.2** with template 18, which measures every cell's words to know a
 * table too wide and is queried before it compiles (TB3-H, TB3-I): the engine's peak a third higher for
 * the same table, so 1,500 rows, the query's peak 913 MiB and the compile's 941, and 1,800 killed.
 * The TB3 and TB1 plans' "Changed while building" have the figures.
 */
export const TABLE_ROWS_MAX = 1_500;

/** **The most rows a table transposes** (tables.md, "Transposition"; TG-E): a small result, a year by month. */
export const TRANSPOSE_ROWS_MAX = 12;

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
  | {
      readonly code: 'column_missing' | 'column_image' | 'subtotal_not_boolean';
      readonly column: string;
    }
  | { readonly code: 'subtotal_ambiguous'; readonly detail: string }
  | { readonly code: 'format_mismatch'; readonly column: string; readonly detail: string }
  | { readonly code: 'table_too_long' | 'transpose_too_long'; readonly detail: string };

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
  /**
   * A transposed table's value (TG2): its own column's alignment, `decimal` set at the end since its
   * column now holds unlike quantities, and whether it may wrap - each its column's no longer.
   */
  readonly align?: ColumnAlignment;
  readonly wrap?: boolean;
}

/** A group's heading as laid out (TAB-008): its level, outermost 1, and its value formatted. */
export interface LaidOutHeading {
  readonly level: number;
  readonly text: string;
  readonly value: CanonicalValue;
}

/**
 * **A row as laid out**: its cells and its index into the rows it was laid out from (TB3-C); the
 * headings of the groups it opens, outermost first (TAB-008); and, for the query's subtotal row, the
 * level it totals (TAB-042).
 */
export interface LaidOutRow {
  readonly index: number;
  readonly cells: readonly LaidOutCell[];
  readonly opens?: readonly LaidOutHeading[];
  readonly subtotal?: number;
}

/**
 * **A bound table laid out**: its header row, as text with a unit bracketed; its columns; its rows in
 * order; and, where it has none, the statement spanning it, a data cell (TAB-011).
 */
export interface LaidOut {
  readonly header: readonly { readonly text: string }[];
  readonly columns: readonly LaidOutColumn[];
  readonly rows: readonly LaidOutRow[];
  /**
   * A transposed table's (TG2; TAB-021): the row of the result each value column came from, in order,
   * and the column each body row came from - which notes are placed by.
   */
  readonly transposed?: {
    readonly rows: readonly number[];
    readonly columns: readonly string[];
    /** The table as laid out before it was turned, which provenance records (TAB-019). */
    readonly from: LaidOut;
  };
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

/** The format a group's heading is printed in: its type's in the style, then the group's. */
const groupFormat = (
  group: NonNullable<BoundTableNode['groups']>[number],
  type: ColumnType,
  style: TablePresentation,
): FieldFormat =>
  mergeFormat(
    mergeFormat(DEFAULT_TABLE_FIELDS[type.base as FieldKey], style.fields?.[type.base as FieldKey]),
    group.format,
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
  for (const group of table.groups ?? []) {
    if (group.subtotal !== undefined) {
      const total = found(group.subtotal);
      if (total !== undefined && total.type.base !== 'boolean') {
        failures.push({ code: 'subtotal_not_boolean', column: group.subtotal });
      }
    }
    const column = found(group.column);
    if (column === undefined) continue;
    if (column.type.base === 'image') {
      failures.push({ code: 'column_image', column: group.column });
      continue;
    }
    for (const member of formatMismatch(column.type, groupFormat(group, column.type, style))) {
      failures.push({ code: 'format_mismatch', column: group.column, detail: member });
    }
  }
  if (table.transpose !== undefined) {
    const column = found(table.transpose.header);
    if (column?.type.base === 'image') {
      failures.push({ code: 'column_image', column: table.transpose.header });
    }
    if (rowCount > TRANSPOSE_ROWS_MAX) {
      failures.push({ code: 'transpose_too_long', detail: String(rowCount) });
    }
  }
  if (rowCount > TABLE_ROWS_MAX) {
    failures.push({ code: 'table_too_long', detail: String(rowCount) });
  }
  return failures;
}

type SortBy = readonly {
  readonly key: NonNullable<BoundTableNode['sort']>[number];
  readonly type: ColumnType;
  readonly index: number;
}[];

/** A level of grouping as ordering reads it: its group, and its columns' places in the result. */
interface GroupBy {
  readonly group: NonNullable<BoundTableNode['groups']>[number];
  readonly index: number;
  readonly subtotal: number | undefined;
}

/** Rows in stored order, then each sort key in turn; the stored position breaks every tie (TAB-007). */
function sortIndices(result: CanonicalResult, rows: number[], sort: SortBy): number[] {
  if (sort.length === 0) return rows;
  return [...rows].sort((x, y) => {
    for (const { key, type, index } of sort) {
      const compared = compareBy(type, result.rows[x]![index]!, result.rows[y]![index]!, key);
      if (compared !== 0) return compared;
    }
    return x - y;
  });
}

/** One row of a bound table's order: its index, the groups it opens, and the level it totals. */
interface Ordered {
  readonly index: number;
  readonly opens: readonly { readonly level: number; readonly value: CanonicalValue }[];
  readonly subtotal: number | undefined;
}

/**
 * **A bound table's order** (TAB-043; the TG plan, TG-K): groups by first appearance in stored order,
 * outermost first, each opening with its heading; within the innermost, the rows sorted stably; and
 * each level's subtotal rows - the query's, true in its `subtotal` column - last in their group, in
 * stored order, never sorted (TAB-042). A subtotal at level k belongs to its group by the values of
 * levels 1 to k alone. A row true at two levels is `subtotal_ambiguous`, naming its index.
 */
function orderOf(
  result: CanonicalResult,
  sort: SortBy,
  groups: readonly GroupBy[] = [],
): Ordered[] | { readonly ambiguous: number } {
  const all = result.rows.map((_, index) => index);
  if (groups.length === 0) {
    return sortIndices(result, all, sort).map((index) => ({
      index,
      opens: [],
      subtotal: undefined,
    }));
  }
  const totals = new Map<number, number>();
  for (const index of all) {
    const levels = groups.flatMap((group, level) =>
      group.subtotal !== undefined && result.rows[index]![group.subtotal] === true ? [level] : [],
    );
    if (levels.length > 1) return { ambiguous: index };
    if (levels.length === 1) totals.set(index, levels[0]!);
  }
  const ordered: Ordered[] = [];
  const opening: { level: number; value: CanonicalValue }[] = [];
  const emit = (index: number, subtotal: number | undefined) => {
    ordered.push({ index, opens: opening.splice(0), subtotal });
  };
  const within = (rows: number[], level: number) => {
    if (level === groups.length) {
      for (const index of sortIndices(result, rows, sort)) emit(index, undefined);
      return;
    }
    const at = groups[level]!.index;
    // Canonical values are strings, booleans or null, so the value itself keys its group, in the
    // order its first row met it.
    const parts = new Map<CanonicalValue, number[]>();
    for (const index of rows) {
      const value = result.rows[index]![at] ?? null;
      const part = parts.get(value) ?? [];
      part.push(index);
      parts.set(value, part);
    }
    for (const [value, part] of parts) {
      opening.push({ level: level + 1, value });
      within(
        part.filter((index) => totals.get(index) !== level),
        level + 1,
      );
      for (const index of part.filter((each) => totals.get(each) === level)) {
        emit(index, level + 1);
      }
    }
  };
  within(all, 0);
  return ordered;
}

/** The sort and the groups as the result holds them, passing over any column it lacks. */
function orderBy<C extends TableColumn>(
  table: BoundTableNode,
  result: CanonicalResult,
  columns: readonly C[],
): { readonly sort: SortBy; readonly groups: readonly GroupBy[] } {
  const at = new Map(result.columns.map(([name], index) => [name, index]));
  const declared = new Map(columns.map((column) => [column.name, column]));
  const sort = (table.sort ?? []).flatMap((key) => {
    const column = declared.get(key.column);
    const index = at.get(key.column);
    return column === undefined || index === undefined ? [] : [{ key, type: column.type, index }];
  });
  const groups = (table.groups ?? []).flatMap((group) => {
    const index = at.get(group.column);
    const subtotal = group.subtotal === undefined ? undefined : at.get(group.subtotal);
    return !declared.has(group.column) || index === undefined ? [] : [{ group, index, subtotal }];
  });
  return { sort, groups };
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
  return {
    columns: result.columns,
    rows: tableOrder(table, result, columns).map((index) => result.rows[index]!),
  };
}

/**
 * **Every row's index in a bound table's order** (TB3.3): `sortResult`'s order, as indices into the
 * result's rows, so the page letters a note on a row it does not lay out (`placeTableNotes`).
 */
export function tableOrder<C extends TableColumn>(
  table: BoundTableNode,
  result: CanonicalResult,
  columns: readonly C[],
): number[] {
  const { sort, groups } = orderBy(table, result, columns);
  const ordered = orderOf(result, sort, groups);
  // An ambiguous subtotal fails the layout; ordered without groups, its rows are still all sent.
  return 'ambiguous' in ordered
    ? sortIndices(
        result,
        result.rows.map((_, index) => index),
        sort,
      )
    : ordered.map((row) => row.index);
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
  const { sort, groups } = orderBy(table, result, present);
  const order = orderOf(result, sort, groups);
  if ('ambiguous' in order) {
    return { failures: [{ code: 'subtotal_ambiguous', detail: String(order.ambiguous) }] };
  }
  const printed = order.reduce((count, row) => count + 1 + row.opens.length, 0);
  if (printed > TABLE_ROWS_MAX) {
    return { failures: [{ code: 'table_too_long', detail: String(printed) }] };
  }
  const headingOf = (level: number, value: CanonicalValue): LaidOutHeading => {
    const { group } = groups[level - 1]!;
    const { type } = declared.get(group.column)!;
    return {
      level,
      text: formatCell(value, type, groupFormat(group, type, style), formats, words),
      value,
    };
  };
  const units = table.columns.map((shown) =>
    shown.unit?.place === 'value' ? shown.unit.text : undefined,
  );
  const indexes = laidColumns.map((column) => at.get(column.name)!);
  const shownOrder = options.limit === undefined ? order : order.slice(0, options.limit);
  const rows = shownOrder.map(({ index, opens, subtotal }): LaidOutRow => {
    const row = result.rows[index]!;
    return {
      index,
      ...(opens.length === 0
        ? {}
        : { opens: opens.map(({ level, value }) => headingOf(level, value)) }),
      ...(subtotal === undefined ? {} : { subtotal }),
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
  const laidOut: LaidOut = {
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
  if (table.transpose === undefined) return laidOut;
  const { header } = table.transpose;
  const { type } = declared.get(header)!;
  const shownAt = laidColumns.findIndex((column) => column.name === header);
  const corner: LaidOutColumn =
    shownAt >= 0
      ? { ...laidColumns[shownAt]!, align: 'start', wrap: true }
      : {
          name: header,
          type,
          header,
          format: formatOf({ column: header, header }, type, style),
          align: 'start',
          wrap: true,
        };
  return transposed(laidOut, corner, (index) =>
    formatCell(result.rows[index]![at.get(header)!] ?? null, type, corner.format, formats, words),
  );
}

/**
 * **A laid-out table transposed** (TG2; TAB-021, TAB-023): each row a column headed by its value in
 * the header column, `corner` heading the column of row headers; each shown column but that one a
 * row headed by its header, its values keeping its alignment - `decimal` set at the end - and wrap.
 * Every value moves; none is added or dropped.
 */
function transposed(
  laid: LaidOut,
  corner: LaidOutColumn,
  headed: (index: number) => string,
): LaidOut {
  const values = laid.columns.flatMap((column, at) => (column.name === corner.name ? [] : [at]));
  const heads = laid.rows.map((row) => headed(row.index));
  return {
    header: [{ text: corner.header }, ...heads.map((text) => ({ text }))],
    columns: [
      corner,
      ...heads.map((text): LaidOutColumn => ({ ...corner, header: text, align: 'end' })),
    ],
    // No rows, no row headers: the empty statement stands alone, as the publish sets it.
    rows:
      laid.empty !== null
        ? []
        : values.map((at) => {
            const column = laid.columns[at]!;
            return {
              index: -1,
              cells: [
                {
                  text: column.header,
                  value: null,
                  scope: 'row' as const,
                  negative: false,
                  parenthesised: false,
                },
                ...laid.rows.map((row) => ({
                  ...row.cells[at]!,
                  scope: null,
                  align: column.align === 'decimal' ? ('end' as const) : column.align,
                  wrap: column.wrap,
                })),
              ],
            };
          }),
    empty: laid.empty === null ? null : { ...laid.empty, colspan: 1 },
    transposed: {
      rows: laid.rows.map((row) => row.index),
      columns: values.map((at) => laid.columns[at]!.name),
      from: laid,
    },
  };
}
