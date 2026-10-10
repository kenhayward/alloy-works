import { useId, useState, type ReactNode } from 'react';

import styles from './parts.module.css';

/**
 * A value kept out of the way (ADR-0050, decision 7): a button saying what it is, described by the
 * value, which shows beside it on hover or focus and goes on Escape (WCAG 1.4.13). The button may be
 * another part's own - a pill, pressed and chosen by a click - where the value says why of it.
 */
export function Tooltip({
  tip,
  children,
  className,
  pressed,
  onClick,
}: {
  tip: string;
  children: ReactNode;
  className?: string;
  pressed?: boolean;
  onClick?: () => void;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <span className={styles['tipAnchor']}>
      <button
        type="button"
        className={className ?? styles['tipButton']}
        aria-describedby={id}
        {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
        onClick={onClick}
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
