import { useEffect, useRef } from 'react';

import { Icon } from '../editor/Icon.js';
import styles from './Modal.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * A modal over the screen that asked for it, never a route (docs/interface/README.md): 40px from the
 * top, named by the heading inside it, closed by Escape or its close button. Focus starts on its
 * first field - or on the dialog, until content that loads late brings one - stays inside while it
 * is open, and goes back to whatever opened it.
 */
export function Modal({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = dialog.current;
    if (!box) return undefined;
    const first = () => box.querySelector<HTMLElement>(FIELD);
    (first() ?? box).focus();
    // A form that reads what it offers after it mounts brings its first field late: focus it then,
    // unless the person has already moved on.
    const waiting = new MutationObserver(() => {
      const field = first();
      if (field && document.activeElement === box) field.focus();
      if (field) waiting.disconnect();
    });
    waiting.observe(box, { childList: true, subtree: true });
    return () => {
      waiting.disconnect();
      opener?.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    const stops = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const firstStop = stops[0];
    const lastStop = stops[stops.length - 1];
    if (!firstStop || !lastStop) return;
    if (event.shiftKey && document.activeElement === firstStop) {
      event.preventDefault();
      lastStop.focus();
    } else if (!event.shiftKey && document.activeElement === lastStop) {
      event.preventDefault();
      firstStop.focus();
    }
  };

  return (
    <div className={styles['scrim']}>
      <div
        ref={dialog}
        className={styles['dialog']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className={styles['body']}>{children}</div>
        <button
          type="button"
          className={styles['close']}
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
    </div>
  );
}
