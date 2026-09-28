import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import own from './SymbolPalette.module.css';
import { SYMBOL_GROUPS } from './symbols.js';

/** How many symbols stand in a row, which the up and down arrows move by. */
export const PALETTE_COLUMNS = 12;

export interface SymbolPaletteProps {
  /** The character chosen, for the caller to insert where the cursor was. */
  readonly onChoose: (character: string) => void;
  /** Closed with nothing chosen: Escape or Close. */
  readonly onCancel: () => void;
}

/** A group's symbols in rows of `PALETTE_COLUMNS`, as the grid's rows hold them. */
const rowsOf = <T,>(items: readonly T[]): T[][] => {
  const rows: T[][] = [];
  for (let at = 0; at < items.length; at += PALETTE_COLUMNS) {
    rows.push(items.slice(at, at + PALETTE_COLUMNS));
  }
  return rows;
};

/**
 * **The symbol palette** (CNT-057, W-L): a dialog of three groups - mathematical, Greek, and
 * scientific and technical - each a grid of buttons, one a character, named by its Unicode name in
 * plain words (`symbols.ts`). Choosing one answers it to the caller, which inserts it where the cursor
 * was and gives the focus back there; Escape and Close answer nothing.
 *
 * **One tab stop in each group**, as the toolbar is one: the arrow keys move within a group - left and
 * right by one, up and down by a row - and stop at its edges, Home and End reach its first and last,
 * and Tab moves on to the next group, where the stop is wherever it was left, then to Close, and
 * round again. The keyboard is held inside, as every dialog here holds it.
 */
export function SymbolPalette({ onChoose, onCancel }: SymbolPaletteProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  // Which symbol of each group holds that group's one tab stop.
  const [stops, setStops] = useState<readonly number[]>(() => SYMBOL_GROUPS.map(() => 0));
  const buttons = useRef<(HTMLButtonElement | null)[][]>(SYMBOL_GROUPS.map(() => []));

  // The first symbol takes the focus as the palette opens.
  useEffect(() => {
    buttons.current[0]?.[0]?.focus();
  }, []);

  const moveTo = (group: number, index: number) => {
    setStops((now) => now.map((stop, at) => (at === group ? index : stop)));
    buttons.current[group]?.[index]?.focus();
  };

  /** The arrows, Home and End, within one group; read off the key's own target, as the toolbar does. */
  const onGridKeyDown = (group: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const inGroup = buttons.current[group] ?? [];
    const from = inGroup.indexOf(event.target as HTMLButtonElement);
    if (from < 0) return;
    const last = (SYMBOL_GROUPS[group]?.symbols.length ?? 1) - 1;
    const to = (() => {
      switch (event.key) {
        case 'ArrowRight':
          return Math.min(from + 1, last);
        case 'ArrowLeft':
          return Math.max(from - 1, 0);
        case 'ArrowDown':
          return from + PALETTE_COLUMNS <= last ? from + PALETTE_COLUMNS : from;
        case 'ArrowUp':
          return from - PALETTE_COLUMNS >= 0 ? from - PALETTE_COLUMNS : from;
        case 'Home':
          return 0;
        case 'End':
          return last;
        default:
          return null;
      }
    })();
    if (to === null) return;
    event.preventDefault();
    moveTo(group, to);
  };

  /**
   * Escape closes; Tab is held inside, wrapping at the ends over the stops the browser takes - each
   * group's one, then Close - and left to the browser everywhere else.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const tabStops = [
      ...(dialog.current?.querySelectorAll<HTMLElement>('button:not([tabindex="-1"])') ?? []),
    ];
    if (tabStops.length === 0) return;
    const at = tabStops.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? at - 1 : at + 1;
    if (at >= 0 && next >= 0 && next < tabStops.length) return;
    event.preventDefault();
    tabStops[event.shiftKey ? tabStops.length - 1 : 0]?.focus();
  };

  return (
    <div className={shell['scrim']}>
      <div
        ref={dialog}
        className={shell['dialog']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        onKeyDown={onKeyDown}
      >
        <div className={styles['form']}>
          {/* The same drawing as the toolbar button that opened it. */}
          <h2 id={`${id}-heading`} className={styles['heading']}>
            <span className={styles['tile']} aria-hidden="true">
              <Icon name="Symbols" size={22} />
            </span>
            Symbols
          </h2>
          {SYMBOL_GROUPS.map((group, g) => (
            <section key={group.name} className={own['group']}>
              <h3 id={`${id}-group-${g}`} className={own['name']}>
                {group.name}
              </h3>
              <div
                role="grid"
                aria-labelledby={`${id}-group-${g}`}
                className={own['grid']}
                onKeyDown={onGridKeyDown(g)}
              >
                {rowsOf(group.symbols).map((row, r) => (
                  <div role="row" key={r} className={own['row']}>
                    {row.map((symbol, c) => {
                      const index = r * PALETTE_COLUMNS + c;
                      return (
                        <div role="gridcell" key={symbol.codePoint}>
                          <button
                            type="button"
                            className={own['symbol']}
                            ref={(element) => {
                              (buttons.current[g] ??= [])[index] = element;
                            }}
                            aria-label={symbol.name}
                            title={symbol.name}
                            tabIndex={stops[g] === index ? 0 : -1}
                            // A click moves the stop too, so Tab comes back to where the author was.
                            onFocus={() =>
                              setStops((now) => now.map((stop, at) => (at === g ? index : stop)))
                            }
                            onClick={() => onChoose(symbol.character)}
                          >
                            {symbol.character}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <button
          type="button"
          className={shell['close']}
          aria-label="Close"
          title="Close"
          onClick={onCancel}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
    </div>
  );
}
