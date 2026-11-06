import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type CSSProperties,
} from 'react';

import { Icon } from '../editor/Icon.js';
import { modalOpen } from '../shell/Status.js';
import styles from './MenuBar.module.css';
import { inlineKey } from './inline.js';

/** One row of a menu: what it says, its keys as words and as `aria-keyshortcuts`, and what it does. */
export interface MenuCommandItem {
  readonly kind: 'item';
  readonly key: string;
  readonly label: string;
  readonly icon?: string;
  readonly keys?: string;
  readonly ariaKeys?: string;
  readonly enabled: boolean;
  readonly role?: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  readonly checked?: boolean;
  readonly danger?: boolean;
  /** Where the label is the tenant's, a workflow's or a theme's. */
  readonly content?: boolean;
  readonly run: () => void;
}

export interface MenuSubmenu {
  readonly kind: 'submenu';
  readonly key: string;
  readonly label: string;
  readonly icon?: string;
  readonly enabled: boolean;
  readonly entries: readonly MenuEntry[];
}

export type MenuEntry =
  MenuCommandItem | MenuSubmenu | { readonly kind: 'divider'; readonly key: string };

export interface MenuSpec {
  readonly key: string;
  readonly label: string;
  /** The access letter, as it stands in the label: underlined there, opened with Alt. */
  readonly letter: string;
  readonly entries: readonly MenuEntry[];
}

const isApple = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** The label with its access letter underlined. */
function Lettered({ label, letter }: { label: string; letter: string }): ReactNode {
  const at = label.toLowerCase().indexOf(letter.toLowerCase());
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <span className={styles['letter']}>{label.slice(at, at + 1)}</span>
      {label.slice(at + 1)}
    </>
  );
}

const focusables = (menu: HTMLElement): HTMLElement[] =>
  [...menu.children].flatMap((child) => {
    const row = child.matches('[role^="menuitem"]')
      ? (child as HTMLElement)
      : child.querySelector<HTMLElement>(':scope > [role^="menuitem"]');
    return row === null ? [] : [row];
  });

/** A menu of `entries`: the arrows, Home and End along it; Right into a submenu, and Left out. */
function Menu({
  label,
  entries,
  onChosen,
  onClose,
  onAlong,
  focusLast = false,
  nested = false,
  under = false,
}: {
  label: string;
  entries: readonly MenuEntry[];
  onChosen: (item: MenuCommandItem) => void;
  /** Escape, or Left out of a submenu. */
  onClose: () => void;
  /** Left or Right past this menu, to the bar's next. */
  onAlong?: (by: 1 | -1) => void;
  focusLast?: boolean;
  nested?: boolean;
  /** Nested, and still under what opened it rather than beside: a row's flyout. */
  under?: boolean;
}) {
  const own = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [at, setAt] = useState<CSSProperties>({ visibility: 'hidden' });

  // Fixed to the window, placed from what opened it, so a sticky dock or a scrolled menu clips none of
  // it; held inside the window, its rows scrolling where it is too tall (WCAG 1.4.10).
  useLayoutEffect(() => {
    const menu = own.current;
    const anchor = menu?.parentElement;
    if (!menu || !anchor) return;
    const room = 8;
    const box = anchor.getBoundingClientRect();
    const rtl = getComputedStyle(menu).direction === 'rtl';
    const { offsetWidth: width, scrollHeight: height } = menu;
    const most = Math.max(window.innerHeight - 2 * room, 0);
    const aside = nested && !under;
    const wanted = aside ? box.top - 7 : box.bottom + 4;
    const top = Math.max(
      room,
      Math.min(wanted, window.innerHeight - room - Math.min(height, most)),
    );
    const beside = rtl ? box.left - width - 2 : box.right + 2;
    const flipped = rtl ? box.right + 2 : box.left - width - 2;
    const below = rtl ? box.right - width : box.left;
    const fits = (left: number) => left >= 0 && left + width <= window.innerWidth;
    const left = aside ? (fits(beside) || !fits(flipped) ? beside : flipped) : below;
    setAt({
      top,
      left: Math.max(room, Math.min(left, window.innerWidth - room - width)),
      maxHeight: most,
    });
  }, [nested, under]);

  // Once, as it opens and only when placed: a hidden element takes no focus, and the menu's rows
  // change as a page's state does, and the focus stays.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || at.visibility === 'hidden') return;
    focused.current = true;
    const rows = own.current === null ? [] : focusables(own.current);
    (focusLast ? rows.at(-1) : rows[0])?.focus();
  }, [at, focusLast]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = inlineKey(event.key);
    const rows = own.current === null ? [] : focusables(own.current);
    const from = rows.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      event.stopPropagation();
      rows[(to + rows.length) % rows.length]?.focus();
    };
    if (key === 'ArrowDown') move(from + 1);
    else if (key === 'ArrowUp') move(from - 1);
    else if (key === 'Home') move(0);
    else if (key === 'End') move(rows.length - 1);
    else if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (key === 'Tab') {
      // Out of every menu open, the focus given back: a submenu's parent hears it as it bubbles.
      event.preventDefault();
      onClose();
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      if (nested) onClose();
      else onAlong?.(-1);
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      const row = rows[from];
      if (row?.getAttribute('aria-haspopup') === 'menu') row.click();
      else onAlong?.(1);
    }
  };

  return (
    <div
      ref={own}
      role="menu"
      aria-label={label}
      className={nested ? `${styles['menu']} ${styles['nested']}` : styles['menu']}
      style={at}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry) => {
        if (entry.kind === 'divider') {
          return <div key={entry.key} role="separator" className={styles['divider']} />;
        }
        if (entry.kind === 'submenu') {
          return (
            <div key={entry.key} role="none" className={styles['holder']}>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={styles['row']}
                aria-haspopup="menu"
                aria-expanded={opened === entry.key}
                aria-disabled={!entry.enabled}
                onMouseEnter={() => {
                  if (entry.enabled) setOpened(entry.key);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (entry.enabled) setOpened(entry.key);
                }}
              >
                <span className={styles['glyph']}>
                  {entry.icon !== undefined && <Icon name={entry.icon} size={14} />}
                </span>
                <span className={styles['words']}>{entry.label}</span>
                <span className={styles['chevron']} aria-hidden="true" data-mirrored="">
                  ›
                </span>
              </button>
              {opened === entry.key && (
                <Menu
                  label={entry.label}
                  entries={entry.entries}
                  onChosen={onChosen}
                  nested
                  onClose={() => {
                    setOpened(null);
                    own.current?.querySelector<HTMLElement>(`[aria-expanded="true"]`)?.focus();
                  }}
                />
              )}
            </div>
          );
        }
        const { role = 'menuitem' } = entry;
        return (
          <button
            key={entry.key}
            type="button"
            role={role}
            tabIndex={-1}
            className={styles['row']}
            data-danger={entry.danger === true ? '' : undefined}
            aria-disabled={!entry.enabled}
            {...(role === 'menuitem' ? {} : { 'aria-checked': entry.checked === true })}
            {...(entry.ariaKeys === undefined ? {} : { 'aria-keyshortcuts': entry.ariaKeys })}
            onMouseEnter={() => setOpened(null)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (entry.enabled) onChosen(entry);
            }}
          >
            <span className={styles['glyph']}>
              {role !== 'menuitem' && entry.checked === true ? (
                <Icon name="Done editing" size={14} />
              ) : (
                entry.icon !== undefined && <Icon name={entry.icon} size={14} />
              )}
            </span>
            <span
              className={styles['words']}
              {...(entry.content === true ? { 'data-content': '' } : {})}
            >
              {entry.label}
            </span>
            {entry.keys !== undefined && (
              <kbd className={styles['keys']} aria-hidden="true">
                {entry.keys}
              </kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A button opening a menu of the same rows beside it, its corner marked (the dock's flyouts, ADR-0075).
 * What it holds runs as a menu's does, the focus back first on what had it, the text as a rule, so that
 * typing goes on where it was.
 */
export function Flyout({
  label,
  entries,
  children,
  className,
  disabled = false,
  under = false,
  onOpen,
}: {
  label: string;
  entries: readonly MenuEntry[];
  children: ReactNode;
  className?: string | undefined;
  disabled?: boolean;
  /** Opens under its button, for one in a row; beside it otherwise. */
  under?: boolean;
  /** Told as it opens, for rows read only then: a row's permissions. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLElement | null>(null);
  const giveBack = () => {
    const was = before.current;
    before.current = null;
    (was?.isConnected === true ? was : button.current)?.focus();
  };
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [open]);
  return (
    <div ref={holder} className={styles['holder']}>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled}
        data-corner=""
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (disabled) return;
          if (!open) {
            before.current = document.activeElement as HTMLElement | null;
            onOpen?.();
          }
          setOpen((was) => !was);
        }}
      >
        {children}
      </button>
      {open && (
        <Menu
          label={label}
          entries={entries}
          nested
          under={under}
          onChosen={(item) => {
            setOpen(false);
            giveBack();
            item.run();
          }}
          onClose={() => {
            setOpen(false);
            giveBack();
          }}
        />
      )}
    </div>
  );
}

/**
 * The menu bar (ADR-0075, WAI-ARIA's menubar): `F10`, or `Alt` alone, reaches it, and `Alt` and a
 * menu's letter opens that menu; the arrows move along it and within; Enter, Space and Down open;
 * Escape closes and gives the focus back to what had it. Once one is open, pointing at another opens
 * it. Drawn by the renderer, so a tab and a window are the same. On a Mac, Option and a letter type a
 * character, so there `F10` alone is the way in.
 */
export function MenuBar({
  label,
  menus: given,
}: {
  label: string;
  /** A function where what they say must be read as one opens, at each render of the bar. */
  menus: readonly MenuSpec[] | (() => readonly MenuSpec[]);
}) {
  const menus = typeof given === 'function' ? given() : given;
  const bar = useRef<HTMLDivElement>(null);
  const names = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState<{ index: number; last?: boolean } | null>(null);
  const [stop, setStop] = useState(0);
  // What had the focus before the bar: where Escape and a choice give it back.
  const before = useRef<HTMLElement | null>(null);

  const rememberFocus = () => {
    const active = document.activeElement as HTMLElement | null;
    if (active !== null && !bar.current?.contains(active) && active !== document.body) {
      before.current = active;
    }
  };

  const giveBack = () => {
    const was = before.current;
    before.current = null;
    if (was?.isConnected === true) was.focus();
    else names.current[open?.index ?? stop]?.focus();
  };

  const focusName = (index: number) => {
    setStop(index);
    names.current[index]?.focus();
  };

  useEffect(() => {
    let altAlone = false;
    const onDown = (event: KeyboardEvent) => {
      altAlone = event.key === 'Alt' && !isApple();
      if (event.defaultPrevented || modalOpen()) return;
      if (event.key === 'F10' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        rememberFocus();
        focusName(stop);
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey || isApple()) return;
      if (event.getModifierState('AltGraph')) return;
      const at = menus.findIndex((each) => each.letter.toLowerCase() === event.key.toLowerCase());
      if (at < 0) return;
      event.preventDefault();
      rememberFocus();
      setStop(at);
      setOpen({ index: at });
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key !== 'Alt' || !altAlone || modalOpen()) return;
      altAlone = false;
      event.preventDefault();
      rememberFocus();
      focusName(stop);
    };
    const onPointer = (event: PointerEvent) => {
      if (!bar.current?.contains(event.target as Node)) setOpen(null);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('pointerdown', onPointer);
    };
    // The letters are fixed for a bar: read afresh here would add and remove a listener at each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop, menus.length]);

  const along = (from: number, by: 1 | -1) => (from + by + menus.length) % menus.length;

  const onNameKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const key = inlineKey(event.key);
    const opening = key === 'ArrowDown' || key === 'Enter' || key === ' ';
    if (opening || key === 'ArrowUp') {
      event.preventDefault();
      setOpen(key === 'ArrowUp' ? { index, last: true } : { index });
    } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
      event.preventDefault();
      focusName(along(index, key === 'ArrowRight' ? 1 : -1));
    } else if (key === 'Home' || key === 'End') {
      event.preventDefault();
      focusName(key === 'Home' ? 0 : menus.length - 1);
    } else if (key === 'Escape') {
      event.preventDefault();
      giveBack();
    }
  };

  return (
    <div ref={bar} role="menubar" aria-label={label} className={styles['bar']}>
      {menus.map((menu, index) => (
        <div key={menu.key} role="none" className={styles['holder']}>
          <button
            ref={(element) => {
              names.current[index] = element;
            }}
            type="button"
            role="menuitem"
            className={styles['name']}
            tabIndex={index === stop ? 0 : -1}
            aria-haspopup="menu"
            aria-expanded={open?.index === index}
            onFocus={rememberFocus}
            onMouseDown={(event) => {
              // Keeps the text's selection, which what the menu holds acts on.
              event.preventDefault();
              rememberFocus();
            }}
            onMouseEnter={() => {
              if (open !== null && open.index !== index) {
                setStop(index);
                setOpen({ index });
              }
            }}
            onClick={() => {
              setStop(index);
              setOpen((was) => (was?.index === index ? null : { index }));
            }}
            onKeyDown={(event) => onNameKey(event, index)}
          >
            <Lettered label={menu.label} letter={menu.letter} />
          </button>
          {open?.index === index && (
            <Menu
              key={menu.key}
              label={menu.label}
              entries={menu.entries}
              focusLast={open.last === true}
              onChosen={(item) => {
                setOpen(null);
                giveBack();
                item.run();
              }}
              onClose={() => {
                setOpen(null);
                giveBack();
              }}
              onAlong={(by) => {
                const to = along(index, by);
                setStop(to);
                setOpen({ index: to });
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
