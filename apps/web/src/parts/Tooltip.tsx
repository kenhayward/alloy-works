import { useId, useState, type ReactNode } from 'react';

import styles from './parts.module.css';

/**
 * A value kept out of the way (ADR-0050, decision 7): a button saying what it is, described by the
 * value, which shows beside it on hover or focus and goes on Escape (WCAG 1.4.13).
 */
export function Tooltip({ tip, children }: { tip: string; children: ReactNode }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <span className={styles['tipAnchor']}>
      <button
        type="button"
        className={styles['tipButton']}
        aria-describedby={id}
        onMouseEnter={() => setShown(true)}
        onMouseLeave={() => setShown(false)}
        onFocus={() => setShown(true)}
        onBlur={() => setShown(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !shown) return;
          event.preventDefault();
          setShown(false);
        }}
      >
        {children}
      </button>
      <span id={id} role="tooltip" className={styles['tip']} hidden={!shown}>
        {tip}
      </span>
    </span>
  );
}
