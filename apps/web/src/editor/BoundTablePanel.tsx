import type { createApiClient } from '@alloy-works/api-client';
import {
  bindingDigestInput,
  canonicalKeyValue,
  COLUMN_ALIGNMENTS,
  DEFAULT_TABLE_FIELDS,
  mergeFormat,
  type BoundColumn,
  type CanonicalValue,
  type ColumnAlignment,
  type FieldFormat,
  type FieldKey,
  type TableColumn,
  type TablePresentation,
} from '@alloy-works/domain';
import {
  addBoundTableNote,
  bindingContextOf,
  BOUND_TABLE_NOTES_MAX,
  boundTablesShown,
  deleteBoundTable,
  boundTableFocusedColumn,
  focusBoundTableColumn,
  noteColumnDropped,
  removeBoundTableNote,
  repeatedColumn,
  selectBoundTableNote,
  setBoundTable,
  setBoundTablePart,
  type BoundNoteAnchor,
  type BoundNoteAt,
  type BoundTablePart,
  type BoundTablePlace,
  type EditorView,
  type SortKey,
  type Wide,
} from '@alloy-works/editor';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';

import { Chip } from '../parts/Chip.js';
import { IconButton } from '../parts/IconButton.js';
import { Segmented } from '../parts/Segmented.js';
import { Tooltip } from '../parts/Tooltip.js';
import { useStatus } from '../shell/Status.js';
import styles from './BoundTablePanel.module.css';
import { Icon } from './Icon.js';
import { FormatDialog } from './FormatDialog.js';
import { TableStyle } from '../theme/StyleChoice.js';
import { usePresentation } from '../theme/presentation.js';

type Client = ReturnType<typeof createApiClient>;

/** The words the panel uses, each without a fancy dash (the TB2 plan, TB2-F). */
export const BOUND_TABLE_WORDS = {
  panel: 'Bound table',
  /** The Table tab while the cursor is in no table (ADR-0052). */
  panelReadOnly: 'Bound table, read only',
  tableReadOnly: 'Table, read only',
  readOnly:
    'Read only. Edit the component and put the cursor in the table to change its formatting.',
  formatSet: 'Set for this column',
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
  wraps: 'Wraps',
  noWrap: 'Does not wrap',
  text: 'Text',
  left: 'Move left',
  right: 'Move right',
  table: 'Table',
  of: 'of',
  none: 'None',
  shows: 'Shows',
  follows: 'Follows the column the cursor is in.',
  remove: 'Remove',
  format: 'Format',
  addColumn: 'Add column',
  sort: 'Sort',
  directions: { ascending: 'Ascending', descending: 'Descending' },
  nulls: { first: 'No value first', last: 'No value last' },
  addSort: 'Add sort',
  sortHint:
    'Rows are sorted by the first key, then by each next key where the earlier ones are equal. A table takes up to four.',
  newNoteOn: 'New note on',
  deleteTable: 'Delete table',
  unreadable:
    'You may not read its query definition, so only the columns it shows now are offered.',
  needsHeader: 'A column needs a header.',
  lastColumn: 'A table shows at least one column.',
  allShown: 'Every column is shown.',
  wide: 'Wide',
  wides: {
    style: "The table style's",
    scale: 'Scale to fit',
    rotate: 'Rotate onto landscape pages',
  } satisfies Record<Wide | 'style', string>,
  notes: 'Notes',
  noteOn: 'Note on',
  noteOns: { column: 'A column', cell: 'A cell, by its row' },
  noteColumn: 'Column',
  keyIs: (column: string) => `Where ${column} is`,
  addNote: 'Add note',
  editNote: 'Edit',
  removeNote: 'Remove',
  noKey: 'Its query definition declares no key, so a note can stand on a column alone.',
  keyUnknown:
    'The key of its query definition is not known here, so a note can stand on a column alone.',
  keyNeeded: (column: string) => `Type a value of ${column} for the row the note is on.`,
  tooManyNotes: `A table holds at most ${BOUND_TABLE_NOTES_MAX} notes.`,
  noteStands: (column: string) =>
    `A note stands on ${column}. Remove the note before taking the column out of the table.`,
} as const;

/** Each alignment's glyph on its segment, its name in full the segment's name. */
const ALIGN_ICONS: Readonly<Record<ColumnAlignment, string>> = {
  start: 'Align start',
  centre: 'Align centre',
  end: 'Align end',
  decimal: 'Align decimal',
};

/** A note as the panel lists it: what it stands on, in words. */
export function noteOnWords(anchor: BoundNoteAnchor, header: (column: string) => string): string {
  if (anchor.kind === 'column') return `On the column ${header(anchor.column)}`;
  const key = Object.entries(anchor.key)
    .map(([column, value]) => `${column} is ${String(value)}`)
    .join(' and ');
  return `On ${header(anchor.column)} where ${key}`;
}

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
  /** Its value in one line, at the start of the band's first line (ADR-0051, decision 2). */
  readonly value?: ReactNode;
}

/** The fold open: one of Column, Sort and Notes, or none (ADR-0052). */
type Open = 'column' | 'sort' | 'notes' | null;

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
  value,
}: BoundTablePanelProps) {
  const bandId = useId();
  const [open, setOpen] = useState<Open>('column');
  // The column in hand (ADR-0052): a pill sets it, and so does a press on its cells in the text,
  // which the surface holds. Marked in the text, and said in the status bar, while Columns shows.
  const [chosenColumn, setChosenColumn] = useState(0);
  const inHand = Math.max(0, Math.min(chosenColumn, table.columns.length - 1));
  const sent = useRef<number | null>(null);
  const pressed = boundTableFocusedColumn(view.state);
  useEffect(() => {
    if (pressed === null || pressed === sent.current) return;
    sent.current = pressed;
    setChosenColumn(pressed);
    setOpen('column');
  }, [pressed]);
  const setInHand = (at: number) => {
    setChosenColumn(at);
    setOpen('column');
  };
  const focused = open === 'column' ? inHand : null;
  useEffect(() => {
    sent.current = focused;
    focusBoundTableColumn(focused)(view.state, view.dispatch);
  }, [focused, view]);
  useEffect(
    () => () => {
      if (!view.isDestroyed) focusBoundTableColumn(null)(view.state, view.dispatch);
    },
    [view],
  );
  const status = useStatus();
  const where =
    focused === null
      ? BOUND_TABLE_WORDS.table
      : `${BOUND_TABLE_WORDS.table}, column ${focused + 1} of ${table.columns.length}`;
  useEffect(() => {
    status?.place(where);
  }, [status, where]);
  useEffect(() => () => status?.place(null), [status]);
  const [declared, setDeclared] = useState<readonly TableColumn[] | 'unreadable' | null>(null);
  // The definition's key, read with its columns where the document holds none (TB3.3).
  const [declaredKey, setDeclaredKey] = useState<readonly string[] | null>(null);
  const [said, setSaid] = useState<{ readonly text: string; readonly at: number | null } | null>(
    null,
  );
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
        setDeclaredKey(
          definition !== null && Array.isArray(definition.key)
            ? (definition.key as unknown[]).filter((each) => typeof each === 'string')
            : null,
        );
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
  const setColumns = (
    columns: readonly BoundColumn[],
    typed = false,
    at: number | null = null,
  ): boolean => {
    const refuse = (text: string) => {
      setSaid({ text, at });
      return false;
    };
    if (columns.length === 0) return refuse(BOUND_TABLE_WORDS.lastColumn);
    if (columns.some((each) => each.header.trim() === '')) {
      return refuse(BOUND_TABLE_WORDS.needsHeader);
    }
    const repeated = repeatedColumn(columns);
    if (repeated !== null) return refuse(repeatedWords(repeated));
    const noted = noteColumnDropped(table.notes, columns);
    if (noted !== null) return refuse(BOUND_TABLE_WORDS.noteStands(noted));
    setSaid(null);
    return change({ columns }, typed);
  };
  const withColumn = (at: number, column: BoundColumn) =>
    table.columns.map((each, index) => (index === at ? column : each));
  const move = (at: number, by: number) => {
    const columns = [...table.columns];
    const [moved] = columns.splice(at, 1);
    columns.splice(at + by, 0, moved!);
    if (setColumns(columns, false, at + by)) setInHand(at + by);
  };
  const unshown = offered.find(
    (each) => !table.columns.some((shown) => shown.column === each.name),
  );
  const unsorted = offered.find((each) => !table.sort.some((key) => key.column === each.name));
  const setSort = (sort: readonly SortKey[]) => change({ sort });

  // Its notes as the page shows them, each with its letter and why it fails (TB3.3).
  const tableShown = boundTablesShown(view.state.doc, context).find(
    (each) => each.tablePos === table.pos,
  )?.shown;
  const heldTable = heldNow !== undefined && 'table' in heldNow.shown ? heldNow.shown.table : null;
  const key: readonly string[] | null =
    heldColumns !== null && heldTable?.key !== undefined
      ? heldTable.key
      : held === null && declaredKey !== null
        ? declaredKey
        : null;
  const header = (name: string) =>
    table.columns.find((each) => each.column === name)?.header ?? name;

  const formattingColumn = formatting === null ? null : table.columns[formatting];
  const formattingType = formattingColumn ? typeOf(formattingColumn.column) : null;

  const maySort = enabled && table.sort.length < 4 && unsorted !== undefined;
  const addSort = () => {
    if (!maySort || unsorted === undefined) return;
    setSort([...table.sort, { column: unsorted.name, direction: 'ascending', nulls: 'last' }]);
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-label={BOUND_TABLE_WORDS.panel}
      tabIndex={-1}
      className={styles['band']}
    >
      {held === null && declared === 'unreadable' && (
        <p className={styles['unreadable']}>{BOUND_TABLE_WORDS.unreadable}</p>
      )}
      {value !== undefined && <div className={styles['section']}>{value}</div>}
      <section className={styles['section']} aria-labelledby={`${bandId}-table`}>
        <h3 id={`${bandId}-table`} className={styles['heading']}>
          {BOUND_TABLE_WORDS.table}
        </h3>
        <div className={styles['fields']}>
          <TableStyle view={view} value={table.style} enabled={enabled} />
          <label>
            {BOUND_TABLE_WORDS.wide}
            <select
              value={table.wide ?? 'style'}
              disabled={!enabled}
              onChange={(event) => {
                const chosen = event.target.value;
                change({ wide: chosen === 'style' ? null : (chosen as Wide) });
              }}
            >
              {(['style', 'scale', 'rotate'] as const).map((each) => (
                <option key={each} value={each}>
                  {BOUND_TABLE_WORDS.wides[each]}
                </option>
              ))}
            </select>
          </label>
          <span className={styles['label']} id={`${bandId}-shows`}>
            {BOUND_TABLE_WORDS.shows}
          </span>
          <span role="group" aria-labelledby={`${bandId}-shows`} className={styles['shows']}>
            <IconButton
              label={BOUND_TABLE_WORDS.numbered}
              pressed={table.numbered}
              className={styles['toggle']}
              aria-disabled={!enabled}
              onClick={() => change({ numbered: !table.numbered })}
            >
              <Icon name="Numbered" />
            </IconButton>
            <IconButton
              label={BOUND_TABLE_WORDS.headerColumn}
              pressed={table.headerColumn}
              className={styles['toggle']}
              aria-disabled={!enabled}
              onClick={() => change({ headerColumn: !table.headerColumn })}
            >
              <Icon name="First column heads its row" />
            </IconButton>
            {(['empty', 'note', 'source'] as const).map((part) => (
              <IconButton
                key={part}
                label={BOUND_TABLE_WORDS.parts[part]}
                pressed={table.parts[part]}
                className={styles['toggle']}
                aria-disabled={!enabled}
                onClick={() => {
                  if (enabled)
                    setBoundTablePart(part, !table.parts[part])(view.state, view.dispatch);
                }}
              >
                <Icon name={BOUND_TABLE_WORDS.parts[part]} />
              </IconButton>
            ))}
          </span>
        </div>
      </section>
      <section className={styles['section']} aria-labelledby={`${bandId}-columns`}>
        <div className={styles['sectionHead']}>
          <h3 id={`${bandId}-columns`} className={styles['heading']}>
            {BOUND_TABLE_WORDS.columns}
          </h3>
          <Chip>{table.columns.length}</Chip>
          <span className={styles['spacer']} />
          <IconButton
            label={BOUND_TABLE_WORDS.addColumn}
            tooltip={unshown === undefined ? BOUND_TABLE_WORDS.allShown : undefined}
            className={styles['add']}
            aria-disabled={!enabled || unshown === undefined}
            onClick={() => {
              if (!enabled || unshown === undefined) return;
              const at = table.columns.length;
              if (setColumns([...table.columns, { column: unshown.name, header: unshown.name }]))
                setInHand(at);
            }}
          >
            <Icon name="Add" />
          </IconButton>
        </div>
        {/* A pill per column, in order: the column in hand pressed, a refused one in warn with
            why on hover or focus (ADR-0052; ADR-0051, decision 5). */}
        <div role="group" aria-label={BOUND_TABLE_WORDS.columns} className={styles['pills']}>
          {table.columns.map((column, at) => {
            const name = column.header.trim() === '' ? column.column : column.header;
            const refused = said !== null && said.at === at ? said.text : null;
            return refused === null ? (
              <button
                key={at}
                type="button"
                className={styles['pill']}
                aria-pressed={at === inHand}
                onClick={() => setInHand(at)}
              >
                {name}
              </button>
            ) : (
              <Tooltip
                key={at}
                tip={refused}
                className={`${styles['pill']} ${styles['refused']}`}
                pressed={at === inHand}
                onClick={() => setInHand(at)}
              >
                {name}
              </Tooltip>
            );
          })}
        </div>
      </section>
      <p role="status" className={styles['hidden']}>
        {said?.text ?? ''}
      </p>
      {said !== null && said.at === null && <p className={styles['complaint']}>{said.text}</p>}
      {/* One of Column, Sort and Notes open at a time, the others folded to a count and a summary
          (ADR-0052). */}
      {table.columns[inHand] !== undefined && (
        <Fold
          id={`${bandId}-column`}
          label={
            open === 'column'
              ? `${BOUND_TABLE_WORDS.column} ${inHand + 1} ${BOUND_TABLE_WORDS.of} ${table.columns.length}`
              : BOUND_TABLE_WORDS.column
          }
          summary={`${inHand + 1} ${BOUND_TABLE_WORDS.of} ${table.columns.length}, ${header(
            table.columns[inHand].column,
          )}`}
          open={open === 'column'}
          onToggle={() => setOpen(open === 'column' ? null : 'column')}
          group={`${BOUND_TABLE_WORDS.column} ${inHand + 1}`}
          acts={
            <>
              <IconButton
                label={BOUND_TABLE_WORDS.left}
                className={styles['move']}
                aria-disabled={!enabled || inHand === 0}
                onClick={() => inHand > 0 && enabled && move(inHand, -1)}
              >
                <Icon name="Previous page" />
              </IconButton>
              <IconButton
                label={BOUND_TABLE_WORDS.right}
                className={styles['move']}
                aria-disabled={!enabled || inHand === table.columns.length - 1}
                onClick={() => inHand < table.columns.length - 1 && enabled && move(inHand, 1)}
              >
                <Icon name="Next page" />
              </IconButton>
              <IconButton
                label={BOUND_TABLE_WORDS.remove}
                className={styles['move']}
                aria-disabled={!enabled}
                onClick={() =>
                  enabled &&
                  setColumns(
                    table.columns.filter((_, index) => index !== inHand),
                    false,
                    inHand,
                  )
                }
              >
                <Icon name="Delete" />
              </IconButton>
            </>
          }
        >
          <ColumnFields
            key={inHand}
            column={table.columns[inHand]}
            offered={offered}
            enabled={enabled}
            onColumns={(next, typed) => setColumns(withColumn(inHand, next), typed, inHand)}
            onFormat={(opener) => {
              formatOpener.current = opener;
              setFormatting(inHand);
            }}
          />
        </Fold>
      )}
      <Fold
        id={`${bandId}-sort`}
        label={BOUND_TABLE_WORDS.sort}
        count={table.sort.length}
        summary={
          table.sort.length === 0
            ? BOUND_TABLE_WORDS.none
            : table.sort
                .map(
                  (key) =>
                    `${header(key.column)}${key.direction === 'descending' ? ' descending' : ''}`,
                )
                .join(', then ')
        }
        open={open === 'sort'}
        onToggle={() => setOpen(open === 'sort' ? null : 'sort')}
        acts={
          open === 'sort' ? (
            <button
              type="button"
              className={styles['addWords']}
              aria-disabled={!maySort}
              onClick={addSort}
            >
              <Icon name="Add" />
              {BOUND_TABLE_WORDS.addSort}
            </button>
          ) : (
            <IconButton
              label={BOUND_TABLE_WORDS.addSort}
              className={styles['add']}
              aria-disabled={!maySort}
              onClick={() => {
                setOpen('sort');
                addSort();
              }}
            >
              <Icon name="Add" />
            </IconButton>
          )
        }
      >
        {table.sort.map((key, at) => {
          const set = (next: Partial<SortKey>) =>
            setSort(table.sort.map((each, index) => (index === at ? { ...each, ...next } : each)));
          const label = `${BOUND_TABLE_WORDS.sort} ${at + 1}`;
          return (
            <div key={at} role="group" aria-label={label} className={styles['row']}>
              <span className={styles['index']}>{at + 1}</span>
              <select
                aria-label={BOUND_TABLE_WORDS.column}
                className={styles['columnChoice']}
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
              <Segmented
                label={`Direction of ${label}`}
                value={key.direction}
                disabled={!enabled}
                onChange={(direction) => set({ direction: direction as SortKey['direction'] })}
                options={[
                  {
                    value: 'ascending',
                    name: BOUND_TABLE_WORDS.directions.ascending,
                    icon: 'Move up',
                  },
                  {
                    value: 'descending',
                    name: BOUND_TABLE_WORDS.directions.descending,
                    icon: 'Move down',
                  },
                ]}
              />
              <select
                aria-label={`No value in ${label}`}
                className={styles['nulls']}
                value={key.nulls}
                disabled={!enabled}
                onChange={(event) => set({ nulls: event.target.value as SortKey['nulls'] })}
              >
                {Object.entries(BOUND_TABLE_WORDS.nulls).map(([each, words]) => (
                  <option key={each} value={each}>
                    {words}
                  </option>
                ))}
              </select>
              <IconButton
                label={`${BOUND_TABLE_WORDS.remove} ${label.toLowerCase()}`}
                tooltip={BOUND_TABLE_WORDS.remove}
                className={styles['bin']}
                aria-disabled={!enabled}
                onClick={() => enabled && setSort(table.sort.filter((_, index) => index !== at))}
              >
                <Icon name="Delete" />
              </IconButton>
            </div>
          );
        })}
        <p className={styles['hint']}>{BOUND_TABLE_WORDS.sortHint}</p>
      </Fold>
      <Fold
        id={`${bandId}-notes`}
        label={BOUND_TABLE_WORDS.notes}
        count={table.notes.length}
        summary={
          table.notes.length === 0
            ? BOUND_TABLE_WORDS.none
            : table.notes
                .map((note, at) => {
                  const letter = tableShown?.notes?.[at]?.letter;
                  const on = header(note.anchor.column);
                  return letter ? `${letter} on ${on}` : `On ${on}`;
                })
                .join(', ')
        }
        open={open === 'notes'}
        onToggle={() => setOpen(open === 'notes' ? null : 'notes')}
        acts={
          open !== 'notes' && (
            <IconButton
              label={BOUND_TABLE_WORDS.addNote}
              className={styles['add']}
              aria-disabled={!enabled}
              onClick={() => enabled && setOpen('notes')}
            >
              <Icon name="Add" />
            </IconButton>
          )
        }
      >
        <NotesFields
          view={view}
          table={table}
          enabled={enabled}
          tableKey={key}
          typeOf={typeOf}
          header={header}
          shown={tableShown?.notes ?? []}
          rows={heldTable?.rows ?? null}
        />
      </Fold>
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
              setColumns(
                withColumn(at, format === undefined ? rest : { ...rest, format }),
                false,
                at,
              );
              setFormatting(null);
            }}
            onCancel={() => setFormatting(null)}
          />,
          document.body,
        )}
      <div className={styles['foot']}>
        <button
          type="button"
          className={styles['delete']}
          aria-disabled={!enabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (enabled) deleteBoundTable(view.state, view.dispatch);
          }}
        >
          <Icon name="Delete" />
          {BOUND_TABLE_WORDS.deleteTable}
        </button>
      </div>
    </div>
  );
}

interface NotesFieldsProps {
  readonly view: EditorView;
  readonly table: BoundTablePlace;
  readonly enabled: boolean;
  /** The definition's key, or null where it is not known here. */
  readonly tableKey: readonly string[] | null;
  readonly typeOf: (name: string) => TableColumn['type'] | null;
  readonly header: (name: string) => string;
  /** Each note as the page shows it, in the order they stand. */
  readonly shown: readonly { readonly letter: string | null; readonly said: string | null }[];
  /** The rows the page holds for the table, which a key's values are offered from. */
  readonly rows: {
    readonly columns: readonly (readonly [string, string])[];
    readonly rows: readonly (readonly CanonicalValue[])[];
  } | null;
}

/**
 * **The panel's Notes** (TB3.3; TB3-A): each note listed by its letter and what it stands on, with
 * Edit, which puts the cursor in its words beneath the table, and Remove; and Add note, on a column
 * the table shows or on that column's cell in the row a key names - one field per key column, its
 * values offered from the rows shown or typed, and canonicalised by the column's type.
 */
function NotesFields({
  view,
  table,
  enabled,
  tableKey,
  typeOf,
  header,
  shown,
  rows,
}: NotesFieldsProps) {
  const [on, setOn] = useState<'column' | 'cell'>('column');
  const [noteColumn, setNoteColumn] = useState(table.columns[0]?.column ?? '');
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [said, setSaid] = useState<string | null>(null);
  const listId = useId();
  const keyed = tableKey !== null && tableKey.length > 0;
  const chosen = table.columns.some((each) => each.column === noteColumn)
    ? noteColumn
    : (table.columns[0]?.column ?? '');
  /** The values the rows shown hold for a key column, each once, in their order. */
  const offeredValues = (name: string): string[] => {
    const at = rows?.columns.findIndex(([column]) => column === name) ?? -1;
    if (rows === null || at < 0) return [];
    return [...new Set(rows.rows.map((row) => row[at]).filter((each) => each !== null))].map(
      String,
    );
  };
  const edit = (note: BoundNoteAt) => {
    if (note.id === null || !selectBoundTableNote(note.id)(view.state, view.dispatch)) return;
    view.focus();
    // To the middle of the window: ProseMirror's own scroll stops at its edge, under the status bar.
    const at = view.domAtPos(view.state.selection.from).node;
    (at instanceof Element ? at : at.parentElement)
      ?.closest('[data-bound-table-note]')
      ?.scrollIntoView?.({ block: 'center' });
  };
  const add = () => {
    if (!enabled) return;
    if (table.notes.length >= BOUND_TABLE_NOTES_MAX) {
      setSaid(BOUND_TABLE_WORDS.tooManyNotes);
      return;
    }
    let anchor: BoundNoteAnchor = { kind: 'column', column: chosen };
    if (on === 'cell' && keyed) {
      const key: Record<string, CanonicalValue> = {};
      for (const name of tableKey) {
        const value = canonicalKeyValue(typeOf(name) ?? { base: 'text' }, typed[name] ?? '');
        if (value === null) {
          setSaid(BOUND_TABLE_WORDS.keyNeeded(name));
          return;
        }
        key[name] = value;
      }
      anchor = { kind: 'keyed', key, column: chosen };
    }
    setSaid(null);
    if (addBoundTableNote(anchor)(view.state, view.dispatch)) view.focus();
  };
  return (
    <fieldset className={styles['group']}>
      <legend className={styles['hidden']}>{BOUND_TABLE_WORDS.notes}</legend>
      {table.notes.map((note, at) => {
        const each = shown[at];
        const label = `Note ${each?.letter ?? at + 1}`;
        return (
          <div key={note.id ?? at} role="group" aria-label={label} className={styles['row']}>
            <span className={styles['letter']} aria-hidden="true">
              {each?.letter ?? at + 1}
            </span>
            <span className={styles['words']}>
              <span className={styles['hidden']}>{`${label}: `}</span>
              {noteOnWords(note.anchor, header)}
            </span>
            {each?.said != null && <span className={styles['complaint']}>{each.said}</span>}
            <IconButton
              label={BOUND_TABLE_WORDS.editNote}
              tooltip={`${BOUND_TABLE_WORDS.editNote} ${label.toLowerCase()}`}
              className={styles['bin']}
              aria-disabled={!enabled}
              onClick={() => enabled && edit(note)}
            >
              <Icon name="Edit" />
            </IconButton>
            <IconButton
              label={`${BOUND_TABLE_WORDS.removeNote} ${label.toLowerCase()}`}
              tooltip={BOUND_TABLE_WORDS.removeNote}
              className={styles['bin']}
              aria-disabled={!enabled}
              onClick={() => {
                if (enabled && note.id !== null) {
                  removeBoundTableNote(note.id)(view.state, view.dispatch);
                }
              }}
            >
              <Icon name="Delete" />
            </IconButton>
          </div>
        );
      })}
      <div role="group" aria-label={BOUND_TABLE_WORDS.addNote} className={styles['adding']}>
        <span className={styles['adding-label']}>{BOUND_TABLE_WORDS.newNoteOn}</span>
        <Segmented
          label={BOUND_TABLE_WORDS.noteOn}
          value={keyed ? on : 'column'}
          disabled={!enabled || !keyed}
          onChange={(chosenOn) => setOn(chosenOn as 'column' | 'cell')}
          options={[
            { value: 'column', name: BOUND_TABLE_WORDS.noteOns.column },
            { value: 'cell', name: BOUND_TABLE_WORDS.noteOns.cell },
          ]}
        />
        <label className={styles['inline']}>
          {BOUND_TABLE_WORDS.noteColumn}
          <select
            value={chosen}
            disabled={!enabled}
            onChange={(event) => setNoteColumn(event.target.value)}
          >
            {table.columns
              .filter(
                (each, at) =>
                  table.columns.findIndex((other) => other.column === each.column) === at,
              )
              .map((each) => (
                <option key={each.column} value={each.column}>
                  {each.header}
                </option>
              ))}
          </select>
        </label>
        {keyed &&
          on === 'cell' &&
          tableKey.map((name) => (
            <label key={name} className={styles['inline']}>
              {BOUND_TABLE_WORDS.keyIs(name)}
              <input
                value={typed[name] ?? ''}
                disabled={!enabled}
                list={`${listId}-${name}`}
                size={12}
                onChange={(event) => setTyped({ ...typed, [name]: event.target.value })}
              />
              <datalist id={`${listId}-${name}`}>
                {offeredValues(name).map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </label>
          ))}
        <button type="button" aria-disabled={!enabled} onClick={add}>
          {BOUND_TABLE_WORDS.addNote}
        </button>
      </div>
      {!keyed && (
        <p className={styles['hint']}>
          {tableKey === null ? BOUND_TABLE_WORDS.keyUnknown : BOUND_TABLE_WORDS.noKey}
        </p>
      )}
      {said !== null && (
        <p role="alert" className={styles['complaint']}>
          {said}
        </p>
      )}
    </fieldset>
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
  readonly column: BoundColumn;
  readonly offered: readonly TableColumn[];
  readonly enabled: boolean;
  /** Asks for the column changed, answering whether it was; `typed` joins a keystroke's step. */
  readonly onColumns: (column: BoundColumn, typed: boolean) => boolean;
  readonly onFormat: (opener: HTMLElement) => void;
}

/**
 * **The column in hand** (ADR-0052): its column, header, unit and where the unit stands, alignment,
 * and its text's wrap and Format, under the fold that names it. Its header and unit are typed as
 * drafts, a refused one kept until put right.
 */
function ColumnFields({ column, offered, enabled, onColumns, onFormat }: ColumnFieldsProps) {
  const [header, setHeader] = useState(column.header);
  const [unit, setUnit] = useState(column.unit?.text ?? '');
  // An undo, or another change, puts back what the table holds.
  useEffect(() => setHeader(column.header), [column.header]);
  useEffect(() => setUnit(column.unit?.text ?? ''), [column.unit?.text]);
  const unitId = useId();
  const unitPlace = column.unit?.place ?? 'header';
  const bare = without(column, 'unit');
  const wraps = column.wrap !== false;
  return (
    <div className={styles['inHand']}>
      <p className={styles['hint']}>{BOUND_TABLE_WORDS.follows}</p>
      <div className={styles['fields']}>
        <label>
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
        <label>
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
        <label htmlFor={unitId}>{BOUND_TABLE_WORDS.unit}</label>
        <span className={styles['inline']}>
          <input
            id={unitId}
            className={styles['unit']}
            value={unit}
            disabled={!enabled}
            maxLength={40}
            onChange={(event) => {
              const text = event.target.value;
              setUnit(text);
              onColumns(text === '' ? bare : { ...column, unit: { text, place: unitPlace } }, true);
            }}
          />
          <Segmented
            label={BOUND_TABLE_WORDS.unitPlace}
            value={unitPlace}
            disabled={!enabled || column.unit === undefined}
            onChange={(place) =>
              column.unit !== undefined &&
              onColumns(
                { ...column, unit: { ...column.unit, place: place as 'header' | 'value' } },
                false,
              )
            }
            options={[
              { value: 'header', label: 'Header', name: BOUND_TABLE_WORDS.unitPlaces.header },
              { value: 'value', label: 'Value', name: BOUND_TABLE_WORDS.unitPlaces.value },
            ]}
          />
        </span>
        <span className={styles['label']} aria-hidden="true">
          {BOUND_TABLE_WORDS.align}
        </span>
        <Segmented
          label={BOUND_TABLE_WORDS.align}
          value={column.align ?? 'style'}
          disabled={!enabled}
          onChange={(chosen) => {
            const rest = without(column, 'align');
            onColumns(
              chosen === 'style' ? rest : { ...rest, align: chosen as ColumnAlignment },
              false,
            );
          }}
          options={(['style', ...COLUMN_ALIGNMENTS] as const).map((each) =>
            each === 'style'
              ? { value: each, label: 'Style', name: BOUND_TABLE_WORDS.aligns.style }
              : { value: each, name: BOUND_TABLE_WORDS.aligns[each], icon: ALIGN_ICONS[each] },
          )}
        />
        <span className={styles['label']} aria-hidden="true">
          {BOUND_TABLE_WORDS.text}
        </span>
        <span className={styles['inline']}>
          <IconButton
            label={BOUND_TABLE_WORDS.wrap}
            pressed={wraps}
            className={styles['toggle']}
            aria-disabled={!enabled}
            onClick={() => {
              if (!enabled) return;
              const rest = without(column, 'wrap');
              onColumns(wraps ? { ...rest, wrap: false } : rest, false);
            }}
          >
            <Icon name="Wrap" />
          </IconButton>
          <span className={styles['muted']} aria-hidden="true">
            {wraps ? BOUND_TABLE_WORDS.wraps : BOUND_TABLE_WORDS.noWrap}
          </span>
          <button
            type="button"
            className={styles['format']}
            aria-haspopup="dialog"
            aria-disabled={!enabled}
            onClick={(event) => enabled && onFormat(event.currentTarget)}
          >
            <Icon name="Format" />
            {BOUND_TABLE_WORDS.format}
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * **A fold** (ADR-0052): its heading a button that opens and closes it, with its count, and folded,
 * a summary of what it holds; its acts at the line's end. Open, it holds its fields, named by the
 * fold, or by `group` where one names the thing they set.
 */
export function Fold({
  id,
  label,
  count,
  summary,
  open,
  onToggle,
  acts,
  group,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  summary: string;
  open: boolean;
  onToggle: () => void;
  acts?: ReactNode;
  group?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={styles['fold']}
      data-open={open}
      {...(open && group !== undefined ? { role: 'group', 'aria-label': group } : {})}
    >
      <div className={styles['foldHead']}>
        <h3 className={styles['foldHeading']}>
          <button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>
            <Icon name={open ? 'Move down' : 'Next page'} />
            {label}
            {count !== undefined && <Chip>{count}</Chip>}
          </button>
        </h3>
        {!open && <span className={styles['summary']}>{summary}</span>}
        <span className={styles['spacer']} />
        {acts}
      </div>
      {open && (
        <div id={id} className={styles['foldBody']}>
          {children}
        </div>
      )}
    </section>
  );
}
