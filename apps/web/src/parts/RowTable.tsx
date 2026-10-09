import type { ReactNode } from 'react';

import { Icon } from '../editor/Icon.js';
import { IconButton } from './IconButton.js';
import styles from './parts.module.css';

export interface RowTableColumn {
  readonly head: string;
  /** Its width in pixels, as drawn; left out, it takes the rest. */
  readonly width?: number;
}

export interface RowTableRow {
  readonly key: string | number;
  /** A cell under each column, in order. */
  readonly cells: readonly ReactNode[];
  /** The bin's name, which names its row: "Remove segment 1". Left out where the table has no bins. */
  readonly remove?: string;
  readonly onRemove?: () => void;
  /** A row still waiting on the person, in warn: a column not yet confirmed. */
  readonly held?: boolean;
}

/**
 * A list edited in place, a row a line (the query file handoff): its number, a cell under each head
 * at its drawn width, and a bin where its rows may be removed. The table is fixed in layout, so a row
 * never pushes its neighbours.
 */
export function RowTable({
  label,
  columns,
  rows,
  bins = true,
}: {
  label: string;
  columns: readonly RowTableColumn[];
  rows: readonly RowTableRow[];
  /** Whether a row may be removed: the Columns tab's rows are the query's, and may not. */
  bins?: boolean;
}) {
  return (
    <table className={styles['rowTable']} aria-label={label}>
      <thead>
        <tr>
          <th className={styles['rowNumber']}>#</th>
          {columns.map((column) => (
            <th
              key={column.head}
              {...(column.width === undefined ? {} : { style: { width: column.width } })}
            >
              {column.head}
            </th>
          ))}
          {bins && (
            <th className={styles['rowBin']}>
              <Icon name="Delete" />
              <span className={styles['hiddenText']}>Remove</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, at) => (
          <tr key={row.key} {...(row.held === true ? { 'data-held': 'true' } : {})}>
            <td className={styles['rowNumber']}>{at + 1}</td>
            {row.cells.map((cell, place) => (
              <td key={place}>{cell}</td>
            ))}
            {bins && (
              <td className={styles['rowBin']}>
                <IconButton
                  label={row.remove ?? `Remove ${at + 1}`}
                  className={styles['rowIcon']}
                  onClick={row.onRemove}
                >
                  <Icon name="Delete" />
                </IconButton>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
