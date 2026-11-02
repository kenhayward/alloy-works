import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

import styles from './NameTip.module.css';

/**
 * A control's name and keys, shown at once on hover and on focus (ADR-0075), not on a delay: on an icon
 * they are all there is to read. Fixed to the window, so a scrolling rail or a dock does not clip it;
 * inside its anchor, so the pointer can move onto it; Escape takes it away (WCAG 1.4.13). It repeats the
 * control's accessible name, so assistive technology is told once.
 */
export function NameTip({
  name,
  keys,
  children,
  className,
  below = false,
}: {
  name: string;
  keys?: string | undefined;
  /** Under its control, for one in a row: beside it, a tip would stand over the next one. */
  below?: boolean;
  children: ReactNode;
  className?: string | undefined;
}) {
  const [at, setAt] = useState<CSSProperties | null>(null);
  const show = (anchor: HTMLElement) => {
    const { top, bottom, left, right } = anchor.getBoundingClientRect();
    if (below) {
      setAt({ top: bottom + 4, left: (left + right) / 2 });
      return;
    }
    const rtl = getComputedStyle(anchor).direction === 'rtl';
    setAt({
      top: (top + bottom) / 2,
      ...(rtl ? { right: window.innerWidth - left + 4 } : { left: right + 4 }),
    });
  };
  return (
    <span
      className={className === undefined ? styles['anchor'] : `${styles['anchor']} ${className}`}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setAt(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setAt(null)}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Escape' && at !== null) {
          event.stopPropagation();
          setAt(null);
        }
      }}
    >
      {children}
      {at !== null && (
        <span
          className={styles['tip']}
          style={at}
          aria-hidden="true"
          data-name-tip=""
          data-below={below}
        >
          {name}
          {keys !== undefined && <kbd className={styles['keys']}>{keys}</kbd>}
        </span>
      )}
    </span>
  );
}
