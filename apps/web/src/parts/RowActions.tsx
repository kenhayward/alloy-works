import { useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../editor/Icon.js';
import { IconButton } from './IconButton.js';
import styles from './parts.module.css';

export interface RowAction {
  /** The action, as its tooltip says it: "Rename". */
  readonly label: string;
  /** Its name for a screen reader, saying which row: "Rename General". */
  readonly name: string;
  /** Its glyph in `Icon`. */
  readonly icon: string;
  readonly onSelect: () => void;
  /**
   * Which button it is, where two actions take turns in one place - Rename and Restore - so the button,
   * and the focus on it, stays as one becomes the other. Its name otherwise.
   */
  readonly slot?: string;
  /** Why it cannot be taken here, said as its tooltip; it stays reachable but does nothing. */
  readonly unavailable?: string;
}

export interface MenuAction {
  readonly label: string;
  readonly onSelect: () => void;
  /** A removal, drawn in the danger colour. */
  readonly danger?: boolean;
}

/**
 * A row's actions (ADR-0049, decision 4): at most two as icon buttons, each named for its row and
 * titled with what it does, then the rest under More actions, a menu worked by the arrows, Home and
 * End, which Escape or a choice closes, giving the focus back to its button.
 */
export function RowActions({
  subject,
  shown,
  more,
}: {
  /** What the row is, for More actions' name. */
  subject: string;
  shown: readonly RowAction[];
  more: readonly MenuAction[];
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  if (shown.length > 2) throw new Error('A row shows at most two actions as icons');
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    if (!open) return undefined;
    items()[0]?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const moveBy = (step: number | 'first' | 'last') => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next =
      step === 'first'
        ? 0
        : step === 'last'
          ? all.length - 1
          : (at + step + all.length) % all.length;
    all[next]?.focus();
  };

  return (
    <div className={styles['rowActions']}>
      {shown.map((action) => (
        <IconButton
          key={action.slot ?? action.name}
          label={action.name}
          tooltip={action.unavailable ?? action.label}
          className={`${styles['iconButton']} ${styles['rowIcon']}`}
          aria-disabled={action.unavailable === undefined ? undefined : true}
          onClick={() => {
            if (action.unavailable === undefined) action.onSelect();
          }}
        >
          <Icon name={action.icon} />
        </IconButton>
      ))}
      {more.length > 0 && (
        <span className={styles['moreAnchor']}>
          <IconButton
            ref={button}
            label={`More actions for ${subject}`}
            tooltip="More actions"
            className={`${styles['iconButton']} ${styles['rowIcon']}`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen((was) => !was)}
          >
            <Icon name="More actions" />
          </IconButton>
          {open && (
            <div
              ref={menu}
              id={menuId}
              role="menu"
              aria-label={`More actions for ${subject}`}
              className={styles['menu']}
              onKeyDown={(event) => {
                const keys: Record<string, () => void> = {
                  ArrowDown: () => moveBy(1),
                  ArrowUp: () => moveBy(-1),
                  Home: () => moveBy('first'),
                  End: () => moveBy('last'),
                  Escape: close,
                  Tab: () => setOpen(false),
                };
                const act = keys[event.key];
                if (act === undefined) return;
                if (event.key !== 'Tab') event.preventDefault();
                act();
              }}
            >
              {more.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  data-tone={action.danger ? 'danger' : undefined}
                  onClick={() => {
                    close();
                    action.onSelect();
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </span>
      )}
    </div>
  );
}
