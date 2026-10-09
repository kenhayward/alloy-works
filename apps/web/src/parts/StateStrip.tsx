import type { ReactNode } from 'react';

import { Icon } from '../editor/Icon.js';
import styles from './parts.module.css';

export interface StripCell {
  readonly key: string;
  /** Its glyph in `Icon`, in a square of its tone. */
  readonly icon: string;
  readonly tone: 'ok' | 'warn' | 'muted';
  readonly label: string;
  /** What it is, in weight: "Set", "3 of 5 confirmed", a link to the connection. */
  readonly value: ReactNode;
  /** Said after it, quieter: "by Ada on 2 October 2026". */
  readonly detail?: ReactNode;
}

/**
 * What a detail page depends on, never anything new (ADR-0050, decision 4): a cell each, side by side,
 * a square of its tone, its name, and its value.
 */
export function StateStrip({ cells }: { cells: readonly StripCell[] }) {
  return (
    <div role="group" aria-label="State" className={styles['strip']}>
      <ul>
        {cells.map((cell) => (
          <li key={cell.key} data-tone={cell.tone}>
            <span className={styles['stripIcon']}>
              <Icon name={cell.icon} />
            </span>
            <span className={styles['stripText']}>
              <span className={styles['stripLabel']}>{cell.label}</span>
              <span className={styles['stripValue']}>{cell.value}</span>
              {cell.detail !== undefined && (
                <>
                  {' '}
                  <span className={styles['stripDetail']}>{cell.detail}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
