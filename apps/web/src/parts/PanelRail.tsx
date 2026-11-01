import { useRef, useState, type KeyboardEvent } from 'react';

import styles from './PanelRail.module.css';
import { Icon } from '../editor/Icon.js';
import type { Pane } from '../layouts/PaneWidth.js';
import { formats, words } from '../words/words.js';
import { inlineKey } from './inline.js';
import type { PanelTab } from './PanelTabs.js';

/** A panel's tab on the rail: its icon by name (ADR-0074), never drawn in place of its name. */
export type RailTab = Omit<PanelTab, 'icon'> & { readonly icon: string };

/**
 * The panels beside a document's text, chosen from a vertical rail of icons on the panel's end edge
 * (ADR-0074): the hide and show toggle first, then WAI-ARIA's tabs, choosing as they go, Up and Down
 * moving between them. Each tab is named in words, and shows its name beside it on hover and focus,
 * which Escape takes away (WCAG 1.4.13). The rail stands while the pane is hidden; a tab chosen then
 * shows it again.
 */
export function PanelRail({
  label,
  listLabel,
  tabs,
  chosen,
  onChoose,
  ids,
  pane,
}: {
  /** The panels, in a sentence: `Hide the {label}`. */
  label: string;
  /** The tab list's own name. */
  listLabel: string;
  tabs: readonly RailTab[];
  chosen: string;
  onChoose: (key: string) => void;
  ids: (key: string) => { tab: string; panel: string };
  pane: Pane;
}) {
  const elements = useRef<(HTMLButtonElement | null)[]>([]);
  const [named, setNamed] = useState<string | null>(null);
  const choose = (key: string) => {
    onChoose(key);
    if (pane.collapsed) pane.setCollapsed(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && named !== null) {
      event.preventDefault();
      setNamed(null);
      return;
    }
    const open = tabs.flatMap((tab, index) => (tab.disabled ? [] : [index]));
    const from = open.indexOf(tabs.findIndex((tab) => tab.key === chosen));
    const count = open.length;
    const key = inlineKey(event.key);
    const at =
      key === 'ArrowDown'
        ? (from + 1) % count
        : key === 'ArrowUp'
          ? (from - 1 + count) % count
          : key === 'Home'
            ? 0
            : key === 'End'
              ? count - 1
              : null;
    if (at === null || count === 0) return;
    const to = open[at]!;
    event.preventDefault();
    choose(tabs[to]!.key);
    setNamed(tabs[to]!.key);
    elements.current[to]?.focus();
  };
  const toggle = pane.collapsed
    ? words('layouts.show-the', { label })
    : words('layouts.hide-the', { label });
  return (
    <nav className={styles['rail']} aria-label={listLabel}>
      <button
        type="button"
        className={styles['button']}
        aria-label={toggle}
        aria-expanded={!pane.collapsed}
        title={toggle}
        onClick={() => pane.setCollapsed(!pane.collapsed)}
      >
        {/* On the end edge, hidden, the arrow points back into the page (as `PaneToggle`'s). */}
        <Icon name={pane.collapsed ? 'Hide pane' : 'Show pane'} size={18} />
      </button>
      <span className={styles['rule']} />
      <div
        className={styles['tabs']}
        role="tablist"
        aria-label={listLabel}
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, index) => {
          const name =
            tab.name ??
            (tab.count === undefined
              ? tab.label
              : words('parts.tab-count', { label: tab.label, count: tab.count }));
          return (
            <button
              key={tab.key}
              ref={(element) => {
                elements.current[index] = element;
              }}
              type="button"
              role="tab"
              id={ids(tab.key).tab}
              className={styles['button']}
              aria-label={name}
              aria-selected={tab.key === chosen}
              aria-controls={ids(tab.key).panel}
              tabIndex={tab.key === chosen ? 0 : -1}
              data-chosen={tab.key === chosen && !pane.collapsed}
              {...(tab.disabled ? { 'aria-disabled': true } : {})}
              {...(tab.tone ? { 'data-tone': tab.tone } : {})}
              onClick={() => {
                if (!tab.disabled) choose(tab.key);
              }}
              onMouseEnter={() => setNamed(tab.key)}
              onMouseLeave={() => setNamed(null)}
              onFocus={() => setNamed(tab.key)}
              onBlur={() => setNamed(null)}
            >
              <Icon name={tab.icon} size={18} />
              {tab.count !== undefined && (
                <span className={styles['badge']} aria-hidden="true">
                  {formats().number(tab.count)}
                </span>
              )}
              {tab.tone === 'warn' && tab.count === undefined && (
                <span className={styles['dot']} aria-hidden="true" />
              )}
              <span
                className={styles['name']}
                data-rail-name=""
                aria-hidden="true"
                hidden={named !== tab.key}
              >
                {name}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
