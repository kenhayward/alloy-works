import { tableCursor, type EditorView, type TableAt } from '@alloy-works/editor';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

import { IconButton } from '../parts/IconButton.js';
import { inlineKey } from '../parts/inline.js';
import { Icon } from './Icon.js';
import { GRID_ACTIONS, GRID_ICONS, gridAction, type GridAction } from './tableActions.js';
import { tableNamed, tableSize } from './TablePanel.js';
import { TableSettings } from './TableSettings.js';
import { NameTip } from '../parts/NameTip.js';
import styles from './PartToolbar.module.css';
import { words } from '../words/words.js';

/** What it offers after the table's name, grouped by a rule (ADR-0079, Ken's D4). */
const GROUPS: readonly (readonly GridAction[])[] = [
  ['rowAbove', 'rowBelow', 'columnBefore', 'columnAfter'],
  ['deleteRow', 'deleteColumn'],
  ['merge', 'split'],
];

/** Its height and the gap it keeps above what it stands over, as its stylesheet draws them. */
export const TABLE_TOOLBAR_HEIGHT = 44;
const GAP = 8;

/** The nearest ancestor that scrolls up and down, or null where the window does. */
function scrollerOf(from: Element): Element | null {
  for (let at = from.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight) {
      return at;
    }
  }
  return null;
}

/** Where a table's scrolling ancestor, or the page's header, leaves the desk's top. */
function deskTop(from: Element): number {
  const scroller = scrollerOf(from);
  if (scroller !== null) return scroller.getBoundingClientRect().top;
  const header = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
  return Number.parseFloat(header) || 0;
}

/**
 * **Where the toolbar stands, from where the table is drawn** (ADR-0079): above the table's top edge,
 * whichever of its caption and cells comes first, at the table's left; stuck at the desk's top while
 * the table's top has scrolled away, and gone once the table has. It may sit over what is above the
 * table: it moves no text. Set on the element itself as the page scrolls, so nothing renders for it.
 */
export function placeToolbar(
  table: { readonly top: number; readonly bottom: number; readonly left: number },
  desk: number,
): { readonly top: number; readonly left: number; readonly hidden: boolean } {
  const wanted = table.top - GAP - TABLE_TOOLBAR_HEIGHT;
  const top = Math.max(wanted, desk + GAP);
  return {
    top,
    left: Math.max(table.left, GAP),
    // A table not laid out, with no height, has not gone anywhere.
    hidden: table.bottom > table.top && table.bottom < desk + GAP + TABLE_TOOLBAR_HEIGHT,
  };
}

/**
 * **Where it stands over a part of a document** (the EP plan, ruling 4): above the part, heading and
 * all, at its end; stuck at the top of the desk while the part's top has scrolled away, gone once the
 * part has. Clamped to the desk, which the part can overhang when zoomed and scrolled sideways. Its
 * end is the start of the next line's reading: right in a left to right page, left in a right to left.
 */
export function placeOverPart(
  part: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  },
  desk: { readonly top: number; readonly left: number; readonly right: number },
  own: { readonly width: number; readonly height: number },
  direction: 'ltr' | 'rtl' = 'ltr',
): { readonly top: number; readonly left: number; readonly hidden: boolean } {
  const least = desk.left + GAP;
  const most = desk.right - GAP - own.width;
  const wanted = direction === 'rtl' ? part.left : part.right - own.width;
  return {
    top: Math.max(part.top - GAP - own.height, desk.top + GAP),
    left: Math.max(least, Math.min(wanted, most)),
    hidden: part.bottom > part.top && part.bottom < desk.top + GAP + own.height,
  };
}

/** What the desk leaves it, sideways: the whole window where a page has no desk. */
function deskSides(from: Element): { readonly left: number; readonly right: number } {
  const desk = from.closest('.aw-desk');
  if (desk === null) return { left: 0, right: window.innerWidth };
  const { left, right } = desk.getBoundingClientRect();
  return { left, right };
}

function useFollow(
  view: EditorView | null,
  table: TableAt | null,
  part: (() => Element | null) | undefined,
) {
  const element = useRef<HTMLDivElement | null>(null);
  // Whether the caret last moved by a key: a click under it is the reader's own, and moves no text.
  const byKey = useRef(false);
  useEffect(() => {
    if (view === null) return undefined;
    const key = (event: globalThis.KeyboardEvent) => {
      // Moving the focus away moves no caret.
      if (event.key !== 'F6' && event.key !== 'Tab' && event.key !== 'Shift') byKey.current = true;
    };
    const pointer = () => {
      byKey.current = false;
    };
    view.dom.addEventListener('keydown', key);
    view.dom.addEventListener('pointerdown', pointer);
    return () => {
      view.dom.removeEventListener('keydown', key);
      view.dom.removeEventListener('pointerdown', pointer);
    };
  }, [view]);
  useLayoutEffect(() => {
    const place = () => {
      const own = element.current;
      if (own === null) return;
      const whole = part?.() ?? null;
      if (whole !== null) {
        // Never wider than the desk, or it stands over the panels: it wraps instead.
        const sides = deskSides(whole);
        own.style.maxWidth = `${sides.right - sides.left - 2 * GAP}px`;
        const at = placeOverPart(
          whole.getBoundingClientRect(),
          { top: deskTop(whole), ...sides },
          { width: own.offsetWidth, height: own.offsetHeight },
          getComputedStyle(whole).direction === 'rtl' ? 'rtl' : 'ltr',
        );
        own.style.top = `${at.top}px`;
        own.style.left = `${at.left}px`;
        own.hidden = at.hidden;
        return;
      }
      if (view === null || table === null) return;
      const figure = view.nodeDOM(table.pos);
      if (!(figure instanceof Element)) return;
      const at = placeToolbar(figure.getBoundingClientRect(), deskTop(figure));
      own.style.top = `${at.top}px`;
      own.style.left = `${at.left}px`;
      own.hidden = at.hidden;
    };
    place();
    window.addEventListener('resize', place);
    // Capturing, since the desk that scrolls is not the window, and a scroll does not bubble.
    window.addEventListener('scroll', place, { capture: true, passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => place());
    if (view !== null) observer?.observe(view.dom);
    if (element.current !== null) observer?.observe(element.current);
    // The Part panel opening narrows the desk and moves the sheet: no scroll, and the text the same size.
    const whole = part?.() ?? null;
    if (whole !== null) {
      observer?.observe(whole);
      const desk = whole.closest('.aw-desk');
      if (desk !== null) observer?.observe(desk);
    }
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, { capture: true });
      observer?.disconnect();
    };
    // Again with each change of the text, which can move the table without resizing anything.
  }, [view, table?.pos, view?.state.doc, part]);
  // **The caret is never under it** (WCAG 2.4.11): an arrow moves the caret natively, which knows nothing
  // of the toolbar, so each move of the selection that lands beneath it scrolls clear. A scroll by hand
  // is the reader's own, and left alone.
  useLayoutEffect(() => {
    const own = element.current;
    if (view === null || own === null || own.hidden) return;
    const whole = part?.() ?? null;
    if (whole !== null && !byKey.current) return;
    const figure = whole ?? (table === null ? null : view.nodeDOM(table.pos));
    if (!(figure instanceof Element)) return;
    if (figure.getBoundingClientRect().height === 0) return;
    const bar = own.getBoundingClientRect();
    const caret = view.coordsAtPos(view.state.selection.head);
    // Over a part it stands at one end: a caret beside it is not under it.
    if (whole !== null && (caret.right < bar.left || caret.left > bar.right)) return;
    const under = bar.bottom + GAP - caret.top;
    if (under <= 0) return;
    const scroller = scrollerOf(figure);
    if (scroller !== null) scroller.scrollBy(0, -under);
    else window.scrollBy(0, -under);
  }, [view, table?.pos, view?.state.selection, part]);
  return element;
}

/** What stands on it for a part of a document, whatever the cursor is in. */
export interface PartActs {
  /** The part it stands over. */
  readonly element: () => Element | null;
  readonly name: string;
  readonly acts: readonly {
    readonly label: string;
    readonly icon: string;
    readonly disabled: boolean;
    readonly onPress: () => void;
  }[];
  /** What the reader should know before acting here, on a line of its own under the buttons. */
  readonly note?: string | undefined;
  /** The values it says and changes, each an icon and its value: its language and its direction. */
  readonly values: readonly {
    /** Which it is, kept as its icon and words change, so a press leaves the focus on it. */
    readonly id: string;
    readonly icon: string;
    readonly text: string;
    /** Its name, saying the value in full; what a press does, where the name does not. */
    readonly name: string;
    readonly hint?: string;
    /** Whether a press opens a dialog, rather than changing it there and then. */
    readonly asks?: boolean;
    readonly disabled: boolean;
    readonly onPress: () => void;
  }[];
}

export interface PartToolbarProps {
  /** The surface, once there is one, and the table the cursor is in, if any. */
  readonly view: EditorView | null;
  readonly table: TableAt | null;
  readonly enabled: boolean;
  /** Its number in the document, such as "Table 3"; null where it has none here. */
  readonly number?: string | null | undefined;
  /** In a document, the part's own acts; on a component's own page, where its header has them, none. */
  readonly part?: PartActs | undefined;
  /** A page kept while another shows, and a dialog over it: there still, and out of reach. */
  readonly away?: boolean;
  readonly behind?: boolean;
  /** Its own element: a region `F6` moves between (CNT-077). */
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * **The one floating toolbar** (the EP plan, EP3; ADR-0079): on the page's layer, in the reader's theme
 * rather than the paper's, so it stands outside the sheet. Each group says when it applies: the table's
 * while the cursor is in one, the part's in a document. The part's stands last, at the end the toolbar
 * is aligned to, so its buttons never move when another group comes. It never takes the focus on
 * appearing. One tab stop, the ARIA toolbar pattern; `F6` reaches it, and `Esc` goes back to the text.
 * **The table's name opens its settings**, which never move the panel.
 */
export function PartToolbar({
  view,
  table,
  enabled,
  number,
  part,
  away = false,
  behind = false,
  ref,
}: PartToolbarProps) {
  const element = useFollow(view, table, part?.element);
  const nameButton = useRef<HTMLButtonElement | null>(null);
  const popover = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [stop, setStop] = useState(0);
  const noted = useId();
  const cursor = view === null ? null : tableCursor(view.state);

  useEffect(() => {
    if (!open) return undefined;
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popover.current?.contains(target) || nameButton.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (open) {
        setOpen(false);
        nameButton.current?.focus();
      } else {
        view?.focus();
      }
      return;
    }
    if (popover.current?.contains(event.target as Node)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-stop]')];
    const at = buttons.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    const key = inlineKey(event.key);
    const to =
      key === 'ArrowRight'
        ? (at + 1) % buttons.length
        : key === 'ArrowLeft'
          ? (at - 1 + buttons.length) % buttons.length
          : key === 'Home'
            ? 0
            : key === 'End'
              ? buttons.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    setStop(to);
    buttons[to]?.focus();
  };

  // One tab stop: the first by default, each button the next, in order.
  let next = -1;
  const stopNext = () => {
    next += 1;
    return stop === next ? 0 : -1;
  };
  return createPortal(
    <div hidden={away} inert={behind}>
      <div
        ref={(own) => {
          element.current = own;
          if (typeof ref === 'function') ref(own);
          else if (ref) ref.current = own;
        }}
        role="toolbar"
        aria-label={
          part === undefined ? words('editor.table-toolbar') : words('editor.part-toolbar')
        }
        {...(part?.note === undefined ? {} : { 'aria-describedby': noted })}
        tabIndex={-1}
        className={styles['toolbar']}
        onKeyDown={onKeyDown}
      >
        {view !== null && table !== null && (
          <span className={styles['group']} data-group="table">
            <button
              ref={nameButton}
              type="button"
              data-stop
              tabIndex={stopNext()}
              className={styles['name']}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label={words('editor.table-settings-of', { named: tableNamed(number) })}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setOpen((was) => !was)}
            >
              <Icon name="Table" size={16} />
              <span>{tableNamed(number)}</span>
              <Icon name="Chevron down" size={14} />
            </button>
            {GROUPS.map((group) => (
              <span key={group[0]} className={styles['group']}>
                <span className={styles['rule']} aria-hidden="true" />
                {group.map((action) => {
                  const state = gridAction(view, action, enabled);
                  return (
                    <IconButton
                      key={action}
                      data-stop
                      label={GRID_ACTIONS[action].label()}
                      tooltip={state.tooltip}
                      tabIndex={stopNext()}
                      className={styles['button']}
                      data-danger={action === 'deleteRow' || action === 'deleteColumn'}
                      aria-disabled={state.unavailable}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={state.press}
                    >
                      <Icon name={GRID_ICONS[action]} size={18} />
                    </IconButton>
                  );
                })}
              </span>
            ))}
            {open && (
              <div
                ref={popover}
                role="dialog"
                aria-label={words('editor.table-settings')}
                className={styles['popover']}
              >
                <p className={styles['facts']}>
                  {cursor?.where === 'cell'
                    ? words('editor.table-size-at', {
                        size: tableSize(table),
                        row: cursor.row + 1,
                        column: cursor.column + 1,
                      })
                    : tableSize(table)}
                </p>
                <TableSettings view={view} table={table} enabled={enabled} />
              </div>
            )}
            {part !== undefined && <span className={styles['rule']} aria-hidden="true" />}
          </span>
        )}
        {part !== undefined && (
          <span className={styles['group']} role="group" aria-label={part.name}>
            {part.acts.map((act) => {
              const tabIndex = stopNext();
              return (
                <NameTip key={act.label} name={act.label} below>
                  <button
                    type="button"
                    data-stop
                    tabIndex={tabIndex}
                    className={styles['button']}
                    aria-label={act.label}
                    aria-disabled={act.disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!act.disabled) act.onPress();
                    }}
                  >
                    <Icon name={act.icon} size={18} />
                  </button>
                </NameTip>
              );
            })}
            {part.values.length > 0 && <span className={styles['rule']} aria-hidden="true" />}
            {part.values.map((value) => {
              const tabIndex = stopNext();
              return (
                <NameTip key={value.id} name={value.name} hint={value.hint} below>
                  <button
                    type="button"
                    data-stop
                    tabIndex={tabIndex}
                    className={styles['value']}
                    aria-label={value.name}
                    {...(value.hint === undefined ? {} : { 'aria-description': value.hint })}
                    {...(value.asks === true ? { 'aria-haspopup': 'dialog' as const } : {})}
                    aria-disabled={value.disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!value.disabled) value.onPress();
                    }}
                  >
                    <Icon name={value.icon} size={16} />
                    <span data-content>{value.text}</span>
                  </button>
                </NameTip>
              );
            })}
          </span>
        )}
        {part?.note !== undefined && (
          <p id={noted} className={styles['note']}>
            {part.note}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
