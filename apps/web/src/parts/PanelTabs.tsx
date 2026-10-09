import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import styles from './parts.module.css';

export interface PanelTab {
  readonly key: string;
  /** The panel's name, in words (ADR-0046, decision 6). */
  readonly label: string;
  /** Drawn before the name, never in its place. */
  readonly icon?: ReactNode;
  /** Its name where the label says less, such as `Columns, 2 to confirm`. */
  readonly name?: string;
  /** `warn` where it holds the page back (ADR-0050, decision 3). */
  readonly tone?: 'warn';
  /** How many it lists, drawn after the label and named after it. */
  readonly count?: number;
  /** Not available yet: marked so, passed over by the arrows, and a click does nothing. */
  readonly disabled?: boolean;
}

/**
 * The tabs over a set of panels (WAI-ARIA's tabs, choosing as they go): one stop, the arrow keys,
 * Home and End moving between them, each tab controlling the panel `ids` names, which the caller
 * renders as a `tabpanel` labelled by its tab.
 */
export function PanelTabs({
  label,
  tabs,
  chosen,
  onChoose,
  ids,
  className,
  tabClassName,
}: {
  label: string;
  tabs: readonly PanelTab[];
  chosen: string;
  onChoose: (key: string) => void;
  ids: (key: string) => { tab: string; panel: string };
  className?: string | undefined;
  tabClassName?: string | undefined;
}) {
  const elements = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const open = tabs.flatMap((tab, index) => (tab.disabled ? [] : [index]));
    const from = open.indexOf(tabs.findIndex((tab) => tab.key === chosen));
    const count = open.length;
    const at =
      event.key === 'ArrowRight'
        ? (from + 1) % count
        : event.key === 'ArrowLeft'
          ? (from - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (at === null || count === 0) return;
    const to = open[at]!;
    event.preventDefault();
    onChoose(tabs[to]!.key);
    elements.current[to]?.focus();
  };
  return (
    <div
      className={className ?? styles['tabs']}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.key}
          ref={(element) => {
            elements.current[index] = element;
          }}
          type="button"
          role="tab"
          id={ids(tab.key).tab}
          className={tabClassName ?? styles['tab']}
          aria-selected={tab.key === chosen}
          aria-controls={ids(tab.key).panel}
          tabIndex={tab.key === chosen ? 0 : -1}
          {...(tab.disabled ? { 'aria-disabled': true } : {})}
          {...(tab.tone ? { 'data-tone': tab.tone } : {})}
          {...(tab.name !== undefined || tab.count !== undefined
            ? { 'aria-label': tab.name ?? `${tab.label}, ${tab.count}` }
            : {})}
          onClick={() => {
            if (!tab.disabled) onChoose(tab.key);
          }}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && <span className={styles['tabCount']}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
