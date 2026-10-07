import type { createApiClient } from '@alloy-works/api-client';
import {
  bindingDigestInput,
  COLUMN_ALIGNMENTS,
  DEFAULT_TABLE_FIELDS,
  mergeFormat,
  type BoundColumn,
  type ColumnAlignment,
  type FieldFormat,
  type FieldKey,
  type TableColumn,
  type TablePresentation,
} from '@alloy-works/domain';
import {
  bindingContextOf,
  deleteBoundTable,
  repeatedColumn,
  setBoundTable,
  setBoundTablePart,
  type BoundTablePart,
  type BoundTablePlace,
  type EditorView,
  type SortKey,
} from '@alloy-works/editor';
import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';

import styles from './BoundTablePanel.module.css';
import { FormatDialog } from './FormatDialog.js';
import { TableStyle } from '../theme/StyleChoice.js';
import { usePresentation } from '../theme/presentation.js';

type Client = ReturnType<typeof createApiClient>;

/** The words the panel uses, each without a fancy dash (the TB2 plan, TB2-F). */
export const BOUND_TABLE_WORDS = {
  panel: 'Bound table',
  numbered: 'Numbered',
  headerColumn: 'First column heads its row',
  parts: {
    empty: 'Empty statement',
    note: 'Note',
    source: 'Source',
  } satisfies Record<BoundTablePart, string>,
  columns: 'Columns',
  column: 'Column',
  header: 'Header',
  unit: 'Unit',
  unitPlace: 'Unit stands',
  unitPlaces: { header: 'In the header', value: 'After each value' },
  align: 'Alignment',
  aligns: {
    style: "The table style's",
    start: 'Start',
    centre: 'Centre',
    end: 'End',
    decimal: 'On the decimal separator',
  } satisfies Record<ColumnAlignment | 'style', string>,
  wrap: 'Wrap',
  up: 'Move up',
  down: 'Move down',
  remove: 'Remove',
  format: 'Format',
  addColumn: 'Add column',
  sort: 'Sort',
  directions: { ascending: 'Ascending', descending: 'Descending' },
  nulls: { first: 'No value first', last: 'No value last' },
  addSort: 'Add sort',
  deleteTable: 'Delete table',
  unreadable:
    'You may not read its query definition, so only the columns it shows now are offered.',
  needsHeader: 'A column needs a header.',
  lastColumn: 'A table shows at least one column.',
  allShown: 'Every column is shown.',
} as const;

/** A column shown twice under one header, in the walk's words (TAB-048, `column_repeated`). */
export const repeatedWords = (column: string) =>
  `This table shows ${column} twice under one header. Give each a header of its own.`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface BoundTablePanelProps {
  readonly view: EditorView;
  /** The bound table the cursor stands in, as `boundTableAt` reads it. */
  readonly table: BoundTablePlace;
  readonly enabled: boolean;
  readonly client: Client;
  /** Told as the Format dialog opens and closes, so the page behind it can be made inert. */
  readonly onFormatting?: (open: boolean) => void;
  /** The panel's own element: a region `F6` moves between while the cursor is in one (CNT-077). */
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * **The Bound table panel** (the TB2 plan, TB2-F), beside the Value panel while the cursor stands in a
 * bound table: its table style and Numbered, as the Table panel's; whether its first column heads its
 * row; its empty statement, note and source, each added or removed; its columns - each one's column,
 * header, unit, alignment, wrap, place in the order and Format - and its sort, up to four keys. **The
 * columns offered are its definition's**, read as the Value dialog reads them; one who cannot read the
 * definition is offered the table's own. Every change is one transaction.
 */
export function BoundTablePanel({
  view,
  table,
  enabled,
  client,
  onFormatting,
  ref,
}: BoundTablePanelProps) {
  const [declared, setDeclared] = useState<readonly TableColumn[] | 'unreadable' | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [formatting, setFormattingNow] = useState<number | null>(null);
  // The Format button that opened the dialog, which takes the focus back as it closes.
  const formatOpener = useRef<HTMLElement | null>(null);
  const setFormatting = (at: number | null) => {
    setFormattingNow(at);
    onFormatting?.(at !== null);
  };
  // A panel taken away with its dialog open leaves nothing inert behind it.
  const onFormattingNow = useRef(onFormatting);
  onFormattingNow.current = onFormatting;
  useEffect(() => () => onFormattingNow.current?.(false), []);
  // After the render that takes the dialog away, and the page's inert with it.
  useEffect(() => {
    if (formatting !== null) return;
    const back = formatOpener.current;
    formatOpener.current = null;
    back?.focus();
  }, [formatting]);
  const presentation = usePresentation();

  // The version the document holds for it, as it stands: its declared columns are the ones offered
  // (the TB2 final review), so a binding pinned to an older version is offered that version's.
  const context = bindingContextOf(view.state);
  const heldNow = context?.kind === 'document' ? context.held.get(table.binding.id) : undefined;
  const heldColumns =
    heldNow !== undefined &&
    heldNow.binding === bindingDigestInput(table.binding) &&
    'table' in heldNow.shown
      ? heldNow.shown.table.columns
      : null;
  const held = useMemo(
    () => heldColumns?.filter((each) => each.type.base !== 'image') ?? null,
    [heldColumns],
  );

  // Only where the document holds nothing for it, or on its own, is the definition read.
  useEffect(() => {
    if (held !== null) return undefined;
    let live = true;
    void client
      .GET('/v1/query-definitions/{id}', { params: { path: { id: table.binding.query } } })
      .then(({ data }) => {
        if (!live) return;
        const definition = isRecord(data) && isRecord(data.definition) ? data.definition : null;
        setDeclared(
          definition === null || !Array.isArray(definition.columns)
            ? 'unreadable'
            : (definition.columns as TableColumn[]).filter((each) => each.type.base !== 'image'),
        );
      })
      .catch(() => live && setDeclared('unreadable'));
    return () => {
      live = false;
    };
  }, [client, table.binding.query, held]);
  const columnsKnown = held ?? (declared !== null && declared !== 'unreadable' ? declared : null);

  // What the page lays it out with, else the theme the page is set in, else the product's own.
  const style: TablePresentation =
    (context?.kind === 'document' ? context.tables?.styles.get(table.style) : undefined) ??
    (presentation?.state === 'ready'
      ? presentation.theme.tableStyles.get(table.style)
      : undefined) ??
    {};
  const offered: readonly TableColumn[] =
    columnsKnown ?? table.columns.map((each) => ({ name: each.column, type: { base: 'text' } }));
  const typeOf = (name: string) => columnsKnown?.find((each) => each.name === name)?.type ?? null;

  const change = (next: Parameters<typeof setBoundTable>[0], typed = false) =>
    enabled && setBoundTable(next, { typed })(view.state, view.dispatch);

  /** Sets the columns, saying why where the walk would refuse them. */
  const setColumns = (columns: readonly BoundColumn[], typed = false): boolean => {
    if (columns.length === 0) {
      setSaid(BOUND_TABLE_WORDS.lastColumn);
      return false;
    }
    if (columns.some((each) => each.header.trim() === '')) {
      setSaid(BOUND_TABLE_WORDS.needsHeader);
      return false;
    }
    const repeated = repeatedColumn(columns);
    if (repeated !== null) {
      setSaid(repeatedWords(repeated));
      return false;
    }
    setSaid(null);
    return change({ columns }, typed);
  };
  const withColumn = (at: number, column: BoundColumn) =>
    table.columns.map((each, index) => (index === at ? column : each));
  const move = (at: number, by: number) => {
    const columns = [...table.columns];
    const [moved] = columns.splice(at, 1);
    columns.splice(at + by, 0, moved!);
    setColumns(columns);
  };
  const unshown = offered.find(
    (each) => !table.columns.some((shown) => shown.column === each.name),
  );
  const unsorted = offered.find((each) => !table.sort.some((key) => key.column === each.name));
  const setSort = (sort: readonly SortKey[]) => change({ sort });

  const formattingColumn = formatting === null ? null : table.columns[formatting];
  const formattingType = formattingColumn ? typeOf(formattingColumn.column) : null;

  return (
    <div
      ref={ref}
      role="group"
      aria-label={BOUND_TABLE_WORDS.panel}
      tabIndex={-1}
      className={styles['panel']}
    >
      <div className={styles['row']}>
        <TableStyle view={view} value={table.style} enabled={enabled} />
        <label className={styles['inline']}>
          <input
            type="checkbox"
            checked={table.numbered}
            disabled={!enabled}
            onChange={(event) => change({ numbered: event.target.checked })}
          />
          {BOUND_TABLE_WORDS.numbered}
        </label>
        <label className={styles['inline']}>
          <input
            type="checkbox"
            checked={table.headerColumn}
            disabled={!enabled}
            onChange={(event) => change({ headerColumn: event.target.checked })}
          />
          {BOUND_TABLE_WORDS.headerColumn}
        </label>
        {(['empty', 'note', 'source'] as const).map((part) => (
          <label key={part} className={styles['inline']}>
            <input
              type="checkbox"
              checked={table.parts[part]}
              disabled={!enabled}
              onChange={(event) => {
                if (enabled)
                  setBoundTablePart(part, event.target.checked)(view.state, view.dispatch);
              }}
            />
            {BOUND_TABLE_WORDS.parts[part]}
          </label>
        ))}
      </div>
      {held === null && declared === 'unreadable' && (
        <p className={styles['note']}>{BOUND_TABLE_WORDS.unreadable}</p>
      )}
      <fieldset className={styles['group']}>
        <legend>{BOUND_TABLE_WORDS.columns}</legend>
        {table.columns.map((column, at) => (
          <ColumnFields
            key={at}
            at={at}
            column={column}
            count={table.columns.length}
            offered={offered}
            enabled={enabled}
            onColumns={(next, typed) => setColumns(withColumn(at, next), typed)}
            onMove={(by) => move(at, by)}
            onRemove={() => setColumns(table.columns.filter((_, index) => index !== at))}
            onFormat={(opener) => {
              formatOpener.current = opener;
              setFormatting(at);
            }}
          />
        ))}
        <button
          type="button"
          aria-disabled={!enabled || unshown === undefined}
          title={unshown === undefined ? BOUND_TABLE_WORDS.allShown : undefined}
          onClick={() => {
            if (!enabled || unshown === undefined) return;
            setColumns([...table.columns, { column: unshown.name, header: unshown.name }]);
          }}
        >
          {BOUND_TABLE_WORDS.addColumn}
        </button>
      </fieldset>
      <fieldset className={styles['group']}>
        <legend>{BOUND_TABLE_WORDS.sort}</legend>
        {table.sort.map((key, at) => {
          const set = (next: Partial<SortKey>) =>
            setSort(table.sort.map((each, index) => (index === at ? { ...each, ...next } : each)));
          const label = `${BOUND_TABLE_WORDS.sort} ${at + 1}`;
          return (
            <div key={at} role="group" aria-label={label} className={styles['row']}>
              <label className={styles['inline']}>
                {BOUND_TABLE_WORDS.column}
                <select
                  value={key.column}
                  disabled={!enabled}
                  onChange={(event) => set({ column: event.target.value })}
                >
                  {namesOffered(offered, key.column).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <select
                aria-label={`Direction of ${label}`}
                value={key.direction}
                disabled={!enabled}
                onChange={(event) => set({ direction: event.target.value as SortKey['direction'] })}
              >
                {Object.entries(BOUND_TABLE_WORDS.directions).map(([value, words]) => (
                  <option key={value} value={value}>
                    {words}
                  </option>
                ))}
              </select>
              <select
                aria-label={`No value in ${label}`}
                value={key.nulls}
                disabled={!enabled}
                onChange={(event) => set({ nulls: event.target.value as SortKey['nulls'] })}
              >
                {Object.entries(BOUND_TABLE_WORDS.nulls).map(([value, words]) => (
                  <option key={value} value={value}>
                    {words}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-disabled={!enabled}
                onClick={() => setSort(table.sort.filter((_, index) => index !== at))}
              >
                {BOUND_TABLE_WORDS.remove} {label.toLowerCase()}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-disabled={!enabled || table.sort.length >= 4 || unsorted === undefined}
          onClick={() => {
            if (!enabled || table.sort.length >= 4 || unsorted === undefined) return;
            setSort([
              ...table.sort,
              { column: unsorted.name, direction: 'ascending', nulls: 'last' },
            ]);
          }}
        >
          {BOUND_TABLE_WORDS.addSort}
        </button>
      </fieldset>
      {said !== null && (
        <p role="alert" className={styles['complaint']}>
          {said}
        </p>
      )}
      <div className={styles['row']}>
        <button
          type="button"
          className="danger"
          aria-disabled={!enabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (enabled) deleteBoundTable(view.state, view.dispatch);
          }}
        >
          {BOUND_TABLE_WORDS.deleteTable}
        </button>
      </div>
      {formattingColumn !== null &&
        formattingColumn !== undefined &&
        createPortal(
          <FormatDialog
            header={formattingColumn.header}
            type={formattingType}
            style={
              formattingType === null || formattingType.base === 'image'
                ? {}
                : mergeFormat(
                    DEFAULT_TABLE_FIELDS[formattingType.base as FieldKey],
                    style.fields?.[formattingType.base as FieldKey],
                  )
            }
            format={formattingColumn.format}
            onDone={(format: FieldFormat | undefined) => {
              const at = formatting!;
              const rest = without(formattingColumn, 'format');
              setColumns(withColumn(at, format === undefined ? rest : { ...rest, format }));
              setFormatting(null);
            }}
            onCancel={() => setFormatting(null)}
          />,
          document.body,
        )}
    </div>
  );
}

/** A column without one of its optional members, which it then leaves to the table style. */
function without(column: BoundColumn, member: 'format' | 'unit' | 'align' | 'wrap'): BoundColumn {
  const rest = { ...column };
  delete rest[member];
  return rest;
}

/** The names a column list offers: the definition's, and the one chosen where it has gone. */
function namesOffered(offered: readonly TableColumn[], chosen: string): string[] {
  const names = offered.map((each) => each.name);
  return names.includes(chosen) ? names : [chosen, ...names];
}

interface ColumnFieldsProps {
  readonly at: number;
  readonly column: BoundColumn;
  readonly count: number;
  readonly offered: readonly TableColumn[];
  readonly enabled: boolean;
  /** Asks for the column changed, answering whether it was; `typed` joins a keystroke's step. */
  readonly onColumns: (column: BoundColumn, typed: boolean) => boolean;
  readonly onMove: (by: number) => void;
  readonly onRemove: () => void;
  readonly onFormat: (opener: HTMLElement) => void;
}

/** One column's fields: its header and unit typed as drafts, refused ones kept until put right. */
function ColumnFields({
  at,
  column,
  count,
  offered,
  enabled,
  onColumns,
  onMove,
  onRemove,
  onFormat,
}: ColumnFieldsProps) {
  const [header, setHeader] = useState(column.header);
  const [unit, setUnit] = useState(column.unit?.text ?? '');
  // An undo, or another change, puts back what the table holds.
  useEffect(() => setHeader(column.header), [column.header]);
  useEffect(() => setUnit(column.unit?.text ?? ''), [column.unit?.text]);
  const label = `${BOUND_TABLE_WORDS.column} ${at + 1}`;
  const unitPlace = column.unit?.place ?? 'header';
  const bare = without(column, 'unit');
  return (
    <div role="group" aria-label={label} className={styles['column']}>
      <label className={styles['inline']}>
        {BOUND_TABLE_WORDS.column}
        <select
          value={column.column}
          disabled={!enabled}
          onChange={(event) => onColumns({ ...column, column: event.target.value }, false)}
        >
          {namesOffered(offered, column.column).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles['inline']}>
        {BOUND_TABLE_WORDS.header}
        <input
          value={header}
          disabled={!enabled}
          aria-invalid={header.trim() === ''}
          maxLength={200}
          onChange={(event) => {
            setHeader(event.target.value);
            onColumns({ ...column, header: event.target.value }, true);
          }}
        />
      </label>
      <label className={styles['inline']}>
        {BOUND_TABLE_WORDS.unit}
        <input
          value={unit}
          disabled={!enabled}
          maxLength={40}
          size={6}
          onChange={(event) => {
            const text = event.target.value;
            setUnit(text);
            onColumns(text === '' ? bare : { ...column, unit: { text, place: unitPlace } }, true);
          }}
        />
      </label>
      <label className={styles['inline']}>
        {BOUND_TABLE_WORDS.unitPlace}
        <select
          value={unitPlace}
          disabled={!enabled || column.unit === undefined}
          onChange={(event) =>
            column.unit !== undefined &&
            onColumns(
              {
                ...column,
                unit: { ...column.unit, place: event.target.value as 'header' | 'value' },
              },
              false,
            )
          }
        >
          {Object.entries(BOUND_TABLE_WORDS.unitPlaces).map(([value, words]) => (
            <option key={value} value={value}>
              {words}
            </option>
          ))}
        </select>
      </label>
      <label className={styles['inline']}>
        {BOUND_TABLE_WORDS.align}
        <select
          value={column.align ?? 'style'}
          disabled={!enabled}
          onChange={(event) => {
            const rest = without(column, 'align');
            const value = event.target.value;
            onColumns(
              value === 'style' ? rest : { ...rest, align: value as ColumnAlignment },
              false,
            );
          }}
        >
          {(['style', ...COLUMN_ALIGNMENTS] as const).map((value) => (
            <option key={value} value={value}>
              {BOUND_TABLE_WORDS.aligns[value]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles['inline']}>
        <input
          type="checkbox"
          checked={column.wrap !== false}
          disabled={!enabled}
          onChange={(event) => {
            const rest = without(column, 'wrap');
            onColumns(event.target.checked ? rest : { ...rest, wrap: false }, false);
          }}
        />
        {BOUND_TABLE_WORDS.wrap}
      </label>
      <button
        type="button"
        aria-disabled={!enabled || at === 0}
        onClick={() => at > 0 && enabled && onMove(-1)}
      >
        {BOUND_TABLE_WORDS.up}
      </button>
      <button
        type="button"
        aria-disabled={!enabled || at === count - 1}
        onClick={() => at < count - 1 && enabled && onMove(1)}
      >
        {BOUND_TABLE_WORDS.down}
      </button>
      <button type="button" aria-disabled={!enabled} onClick={() => enabled && onRemove()}>
        {BOUND_TABLE_WORDS.remove}
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-disabled={!enabled}
        onClick={(event) => enabled && onFormat(event.currentTarget)}
      >
        {BOUND_TABLE_WORDS.format}
      </button>
    </div>
  );
}
