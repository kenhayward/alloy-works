import {
  setTableHeaders,
  tableCommand,
  type EditorView,
  type TableAction,
  type TableAt,
} from '@alloy-works/editor';
import type { Ref } from 'react';

import styles from './TablePanel.module.css';

/** What the panel offers, in the order it shows them (tables 1, ruling R4). */
const ACTIONS: readonly { readonly action: TableAction; readonly label: string }[] = [
  { action: 'rowAbove', label: 'Row above' },
  { action: 'rowBelow', label: 'Row below' },
  { action: 'columnBefore', label: 'Column before' },
  { action: 'columnAfter', label: 'Column after' },
  { action: 'deleteRow', label: 'Delete row' },
  { action: 'deleteColumn', label: 'Delete column' },
  { action: 'merge', label: 'Merge cells' },
  { action: 'split', label: 'Split cell' },
  { action: 'deleteTable', label: 'Delete table' },
];

export interface TablePanelProps {
  readonly view: EditorView;
  /** The table the cursor stands in, as `tableAt` reads it. */
  readonly table: TableAt;
  readonly enabled: boolean;
  /** The panel's own element: a region `F6` moves between while the cursor is in a table (CNT-077). */
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * What a table carries beside its cells, and what can be done to its grid (tables 1, ruling R4):
 * how many rows and columns are headers, and rows and columns added, deleted, merged and split.
 *
 * **Rendered only while the cursor is in a table**, as the list panel is only in a list. The counts
 * are the table's own and are shown as it holds them, clamped to the table by the command, so a box
 * never says one number while the table holds another.
 *
 * **Each button is `aria-disabled` exactly where its command would do nothing**, asked of the command
 * itself with no dispatch - the question the toolbar asks - so **Merge cells** says so until cells are
 * selected, and **Delete row** in a table of one row. It stays reachable, as the toolbar's buttons
 * do, and a press of an unavailable one does nothing. A press keeps the surface's selection, which
 * merging needs, rather than taking the focus from it on `mousedown`.
 */
export function TablePanel({ view, table, enabled, ref }: TablePanelProps) {
  const setCount = (which: 'rows' | 'columns', typed: string) => {
    const value = Number(typed);
    if (!enabled || typed === '' || !Number.isInteger(value) || value < 0) return;
    setTableHeaders({ [which]: value })(view.state, view.dispatch);
  };

  return (
    <div ref={ref} role="group" aria-label="Table" tabIndex={-1} className={styles['panel']}>
      <label className={styles['count']}>
        Header rows
        <input
          type="number"
          min={0}
          max={table.rows}
          value={table.headerRows}
          disabled={!enabled}
          onChange={(event) => setCount('rows', event.target.value)}
        />
      </label>
      <label className={styles['count']}>
        Header columns
        <input
          type="number"
          min={0}
          max={table.columns}
          value={table.headerColumns}
          disabled={!enabled}
          onChange={(event) => setCount('columns', event.target.value)}
        />
      </label>
      {ACTIONS.map(({ action, label }) => {
        const unavailable = !enabled || !tableCommand(action)(view.state);
        return (
          <button
            key={action}
            type="button"
            className={action === 'deleteTable' ? 'danger' : undefined}
            aria-disabled={unavailable}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!unavailable) tableCommand(action)(view.state, view.dispatch);
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
