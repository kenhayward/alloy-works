import {
  goToCell,
  tableCursor,
  tableGrid,
  type EditorView,
  type TableAt,
} from '@alloy-works/editor';
import type { Ref } from 'react';

import { Chip } from '../parts/Chip.js';
import { IconButton } from '../parts/IconButton.js';
import { usePresentation } from '../theme/presentation.js';
import { tableChoices } from '../theme/StyleChoice.js';
import { Icon } from './Icon.js';
import { GRID_ACTIONS, GRID_ICONS, gridAction, type GridAction } from './tableActions.js';
import { TableMap } from './TableMap.js';
import styles from './TablePanel.module.css';
import { TableSettings } from './TableSettings.js';
import { words } from '../words/words.js';

/** A table style by its name in the theme, or its identifier where the theme has none for it. */
function useStyleName(style: string): string {
  const presentation = usePresentation();
  if (presentation?.state !== 'ready') return style;
  return tableChoices(presentation.theme).find((each) => each.value === style)?.label ?? style;
}

/**
 * **What the Table tab says of a table** (ADR-0079), editing or read only: its caption with its number,
 * then its size, header rows, style and note, each the table's own.
 */
export function TableDetails({
  table,
  caption,
  number,
}: {
  readonly table: TableAt;
  readonly caption: string;
  readonly number?: string | null | undefined;
}) {
  const styleName = useStyleName(table.style);
  return (
    <div className={styles['details']}>
      {caption !== '' && (
        <p className={styles['caption']} data-content>
          {number == null ? caption : words('editor.table-caption', { number, caption })}
        </p>
      )}
      <p className={styles['facts']}>
        <span>{tableSize(table)}</span>
        <span>{words('editor.table-header-rows-count', { count: table.headerRows })}</span>
        <span>{words('editor.table-style-named', { name: styleName })}</span>
        <span>{table.note ? words('editor.table-note-yes') : words('editor.table-note-no')}</span>
      </p>
    </div>
  );
}

/** "5 columns × 8 rows". */
export const tableSize = (table: { readonly columns: number; readonly rows: number }) =>
  words('editor.table-size', { columns: table.columns, rows: table.rows });

/** The tab's heading, and the toolbar's words, for a table: its number, or "Table" where it has none. */
export const tableNamed = (number?: string | null) => number ?? words('editor.table');

/** What the line beneath the map says of where the cursor is. */
function cursorWords(view: EditorView, table: TableAt): string {
  const cursor = tableCursor(view.state);
  if (cursor?.where !== 'cell') {
    return cursor?.where === 'note'
      ? words('editor.table-at-note')
      : words('editor.table-at-caption');
  }
  if (cursor.selected !== null) {
    return words('editor.table-at-selected', { count: cursor.selected.cells });
  }
  const grid = tableGrid(view.state.doc.nodeAt(table.pos)!);
  const heading =
    table.headerRows > 0
      ? grid.cells.find(
          (cell) =>
            cell.row === 0 &&
            cell.column <= cursor.column &&
            cell.column + cell.colSpan > cursor.column,
        )?.words
      : undefined;
  const at = {
    row: cursor.row + 1,
    rows: table.rows,
    column: cursor.column + 1,
    columns: table.columns,
  };
  const place =
    heading === undefined || heading === ''
      ? words('editor.table-at-cell', at)
      : words('editor.table-at-headed', { ...at, heading });
  return cursor.rowSpan * cursor.colSpan > 1 ? words('editor.table-at-merged', { place }) : place;
}

/** A press keeps the surface's selection, which merging needs (ADR-0079). */
function GridButton({
  view,
  action,
  enabled,
  hint,
}: {
  readonly view: EditorView;
  readonly action: GridAction;
  readonly enabled: boolean;
  readonly hint?: string;
}) {
  const { unavailable, tooltip, press } = gridAction(view, action, enabled);
  return (
    <IconButton
      label={GRID_ACTIONS[action].label()}
      tooltip={tooltip}
      className={hint === undefined ? styles['op'] : styles['cellOp']}
      data-danger={action === 'deleteRow' || action === 'deleteColumn'}
      aria-disabled={unavailable}
      onMouseDown={(event) => event.preventDefault()}
      onClick={press}
    >
      <Icon name={GRID_ICONS[action]} size={hint === undefined ? 18 : 16} />
      {hint === undefined ? (
        <span>{GRID_ACTIONS[action].short()}</span>
      ) : (
        <span>
          {GRID_ACTIONS[action].short()}
          <small>{hint}</small>
        </span>
      )}
    </IconButton>
  );
}

export interface TablePanelProps {
  readonly view: EditorView;
  /** The table the cursor stands in, as `tableAt` reads it. */
  readonly table: TableAt;
  readonly enabled: boolean;
  /** Its number in the document, such as "Table 3"; null where it has none here (ADR-0079). */
  readonly number?: string | null | undefined;
  /** The panel's own element: a region `F6` moves between while the cursor is in a table (CNT-077). */
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * **The Table tab as a map of the table** (ADR-0079): its details, the map, what can be done to the
 * row and column the cursor is in, merging and splitting, and every setting. Live: each number is the
 * table's own, whichever control changed it. **Rendered only while the cursor is in a table**.
 */
export function TablePanel({ view, table, enabled, number, ref }: TablePanelProps) {
  const figure = view.state.doc.nodeAt(table.pos)!;
  const cursor = tableCursor(view.state);
  const inCell = cursor?.where === 'cell' ? cursor : null;
  const spans = inCell === null ? 1 : inCell.rowSpan * inCell.colSpan;
  const named = tableNamed(number);
  return (
    <div
      ref={ref}
      role="group"
      aria-label={words('editor.table')}
      tabIndex={-1}
      className={styles['panel']}
    >
      <div className={styles['head']}>
        <h3>{words('editor.table')}</h3>
        {number != null && <Chip tone="accent">{number}</Chip>}
        <IconButton
          label={words('editor.table-go-to')}
          className={styles['goTo']}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            view.dispatch(view.state.tr.scrollIntoView());
            view.focus();
          }}
        >
          <Icon name="Go to the table" />
        </IconButton>
      </div>
      <TableDetails table={table} caption={figure.child(0).textContent} number={number} />
      <div className={styles['mapBox']}>
        <TableMap
          grid={tableGrid(figure)}
          cursor={cursor}
          onChoose={
            enabled
              ? (row, column, extend) =>
                  goToCell(row, column, { extend })(view.state, view.dispatch)
              : undefined
          }
          onEnter={() => view.focus()}
        />
        <p className={styles['where']}>{cursorWords(view, table)}</p>
        <p className={styles['hint']}>{words('editor.table-map-hint')}</p>
      </div>
      <div className={styles['ops']}>
        <section aria-label={words('editor.table-row')}>
          <h4>
            {inCell === null
              ? words('editor.table-row')
              : words('editor.table-row-n', { n: inCell.row + 1 })}
          </h4>
          <div className={styles['opRow']}>
            {(['rowAbove', 'rowBelow', 'deleteRow'] as const).map((action) => (
              <GridButton key={action} view={view} action={action} enabled={enabled} />
            ))}
          </div>
        </section>
        <section aria-label={words('editor.table-column')}>
          <h4>
            {inCell === null
              ? words('editor.table-column')
              : words('editor.table-column-n', { n: inCell.column + 1 })}
          </h4>
          <div className={styles['opRow']}>
            {(['columnBefore', 'columnAfter', 'deleteColumn'] as const).map((action) => (
              <GridButton key={action} view={view} action={action} enabled={enabled} />
            ))}
          </div>
        </section>
      </div>
      <section aria-label={words('editor.table-cells')}>
        <h4>{words('editor.table-cells')}</h4>
        <div className={styles['cellOps']}>
          <GridButton
            view={view}
            action="merge"
            enabled={enabled}
            hint={
              inCell?.selected == null
                ? words('editor.table-merge-hint')
                : words('editor.table-merge-count', { count: inCell.selected.cells })
            }
          />
          <GridButton
            view={view}
            action="split"
            enabled={enabled}
            hint={
              spans > 1
                ? words('editor.table-split-count', { count: spans })
                : words('editor.table-split-hint')
            }
          />
        </div>
      </section>
      <TableSettings
        view={view}
        table={table}
        enabled={enabled}
        lines={{
          numbered: table.numbered
            ? words('editor.table-numbered-line', { named })
            : words('editor.table-unnumbered-line'),
          note: table.note ? words('editor.table-note-yes') : words('editor.table-note-none-yet'),
        }}
      />
    </div>
  );
}
