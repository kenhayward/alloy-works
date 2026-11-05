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
  hint,
  children,
  className,
  below = false,
  align = 'center',
}: {
  name: string;
  keys?: string | undefined;
  /** A line under the name saying what the control does. The control describes itself with the same. */
  hint?: string | undefined;
  /** Under its control, for one in a row: beside it, a tip would stand over the next one. */
  below?: boolean;
  /** Below, at the end of its control rather than centred, for icons at the end of a header. */
  align?: 'center' | 'end';
  children: ReactNode;
  className?: string | undefined;
}) {
  const [at, setAt] = useState<CSSProperties | null>(null);
  const show = (anchor: HTMLElement) => {
    const { top, bottom, left, right } = anchor.getBoundingClientRect();
    const rtl = getComputedStyle(anchor).direction === 'rtl';
    if (below && align === 'end') {
      setAt({
        top: bottom + 4,
        ...(rtl ? { left } : { right: window.innerWidth - right }),
      });
      return;
    }
    if (below) {
      setAt({ top: bottom + 4, left: (left + right) / 2 });
      return;
    }
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
          data-align={align}
          data-hinted={hint !== undefined}
        >
          <span>{name}</span>
          {keys !== undefined && <kbd className={styles['keys']}>{keys}</kbd>}
          {hint !== undefined && (
            <span className={styles['hint']} data-name-tip-hint="">
              {hint}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
