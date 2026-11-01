import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

import styles from './parts.module.css';

/**
 * A small window opened from a button, over what is beside it (a non-modal dialog): its first field or
 * button focused as it opens; Escape closing it and giving the focus back to the button; a press
 * outside it, but for the button's own, closing it where the focus is. The button says
 * `aria-haspopup="dialog"` and `aria-expanded`; where it stands is the caller's `className`.
 */
export function Popup({
  label,
  opener,
  onClose,
  className,
  children,
}: {
  label: string;
  /** The button that opened it, which a press does not count as outside. */
  opener: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string | undefined;
  children: ReactNode;
}) {
  const own = useRef<HTMLDivElement>(null);
  const closing = useRef(onClose);
  closing.current = onClose;

  useEffect(() => {
    own.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!own.current?.contains(target) && !opener.current?.contains(target)) closing.current();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [opener]);

  return (
    <div
      ref={own}
      role="dialog"
      aria-label={label}
      className={`${styles['popup']}${className ? ` ${className}` : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        closing.current();
        opener.current?.focus();
      }}
    >
      {children}
    </div>
  );
}
