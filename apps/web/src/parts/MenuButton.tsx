import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import styles from './parts.module.css';

export interface MenuItem {
  readonly key: string;
  readonly label: string;
  /** A second, quieter line: where an endpoint runs, when a conversation was kept. */
  readonly detail?: string;
  /** Set on every item of a menu choosing one: each is then a `menuitemradio`. */
  readonly checked?: boolean;
  readonly onSelect: () => void;
}

/**
 * A button opening a menu (WAI-ARIA's menu button, as `RowActions`' More actions works): its first
 * item focused, the arrows, Home and End moving and wrapping, Escape or a choice closing it and giving
 * the focus back to the button. An item that is `checked` or not makes it a menu of one choice.
 */
export function MenuButton({
  label,
  face,
  items,
  empty,
  className,
  align = 'start',
  disabled = false,
  title,
}: {
  /** The button's and the menu's name. */
  label: string;
  /** What the button shows: its words, or an icon. */
  face: ReactNode;
  items: readonly MenuItem[];
  /** Said in the menu where it offers nothing. */
  empty?: string;
  className?: string | undefined;
  /** Which edge of the button the menu lines up with. */
  align?: 'start' | 'end';
  disabled?: boolean;
  title?: string;
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const role = items.some((each) => each.checked !== undefined) ? 'menuitemradio' : 'menuitem';
  const all = () => [...(menu.current?.querySelectorAll<HTMLElement>(`[role="${role}"]`) ?? [])];

  useEffect(() => {
    if (!open) return undefined;
    (all().find((each) => each.getAttribute('aria-checked') === 'true') ?? all()[0])?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
    // Focused once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const moveBy = (step: number | 'first' | 'last') => {
    const found = all();
    const at = found.indexOf(document.activeElement as HTMLElement);
    const next =
      step === 'first'
        ? 0
        : step === 'last'
          ? found.length - 1
          : (at + step + found.length) % found.length;
    found[next]?.focus();
  };

  return (
    <span className={styles['moreAnchor']}>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
      >
        {face}
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          className={styles['menu']}
          data-align={align}
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
            // Its own keys, never a toolbar's around it as well.
            event.stopPropagation();
            if (event.key !== 'Tab') event.preventDefault();
            act();
          }}
        >
          {items.length === 0 && empty !== undefined && (
            <p className={styles['menuEmpty']}>{empty}</p>
          )}
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role={role}
              tabIndex={-1}
              aria-labelledby={`${menuId}-${item.key}`}
              {...(item.detail === undefined
                ? {}
                : { 'aria-describedby': `${menuId}-${item.key}-detail` })}
              {...(item.checked === undefined ? {} : { 'aria-checked': item.checked })}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              <span id={`${menuId}-${item.key}`} className={styles['menuLabel']}>
                {item.label}
              </span>
              {item.detail !== undefined && (
                <span id={`${menuId}-${item.key}-detail`} className={styles['menuDetail']}>
                  {item.detail}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
