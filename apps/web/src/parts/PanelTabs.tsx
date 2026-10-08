import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import styles from './parts.module.css';

export interface PanelTab {
  readonly key: string;
  /** The panel's name, in words (ADR-0046, decision 6). */
  readonly label: string;
  /** Drawn before the name, never in its place. */
  readonly icon?: ReactNode;
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
    const from = tabs.findIndex((tab) => tab.key === chosen);
    const count = tabs.length;
    const to =
      event.key === 'ArrowRight'
        ? (from + 1) % count
        : event.key === 'ArrowLeft'
          ? (from - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (to === null) return;
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
          onClick={() => onChoose(tab.key)}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
