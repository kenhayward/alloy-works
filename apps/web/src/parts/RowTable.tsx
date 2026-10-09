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
  /** The bin's name, which names its row: "Remove segment 1". */
  readonly remove: string;
  readonly onRemove: () => void;
}

/**
 * A list edited in place, a row a line (the query file handoff): its number, a cell under each head
 * at its drawn width, and a bin. The table is fixed in layout, so a row never pushes its neighbours.
 */
export function RowTable({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: readonly RowTableColumn[];
  rows: readonly RowTableRow[];
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
          <th className={styles['rowBin']}>
            <Icon name="Delete" />
            <span className={styles['hiddenText']}>Remove</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, at) => (
          <tr key={row.key}>
            <td className={styles['rowNumber']}>{at + 1}</td>
            {row.cells.map((cell, place) => (
              <td key={place}>{cell}</td>
            ))}
            <td className={styles['rowBin']}>
              <IconButton label={row.remove} className={styles['rowIcon']} onClick={row.onRemove}>
                <Icon name="Delete" />
              </IconButton>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
