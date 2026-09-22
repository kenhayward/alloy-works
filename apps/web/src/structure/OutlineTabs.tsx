import { useRef, useState, type KeyboardEvent } from 'react';

import { Icon } from '../editor/Icon.js';
import { kept, keep, PaneToggle, type Pane } from '../layouts/PaneWidth.js';
import styles from './OutlineTabs.module.css';

/** One tab of the outline pane: what it is called and the glyph beside its name. */
export interface OutlineTab {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
}

/** The pane's tabs. One today; the strip is a real tablist so a second is a row here, not a rework. */
export const OUTLINE_TABS: readonly OutlineTab[] = [
  { key: 'contents', label: 'Contents', icon: 'Contents' },
];

/** The ids that tie a tab to its panel, so the panel is named by the tab that shows it. */
export const tabIds = (key: string) => ({
  tab: `outline-tab-${key}`,
  panel: `outline-panel-${key}`,
});

/** The chosen tab, remembered by this browser beside the pane's width and whether it is hidden. */
export function useOutlineTab(storageKey: string): [string, (key: string) => void] {
  const [chosen, setChosen] = useState(() => {
    const stored = kept(`${storageKey}.tab`);
    return OUTLINE_TABS.some((tab) => tab.key === stored) ? stored! : OUTLINE_TABS[0]!.key;
  });
  const choose = (key: string) => {
    setChosen(key);
    keep(`${storageKey}.tab`, key);
  };
  return [chosen, choose];
}

/**
 * The top of the outline pane (interface slice 15): back to the documents, the tabs, and the toggle
 * that hides the pane to a rail. The tabs are WAI-ARIA's pattern - one stop, the arrow keys, Home and
 * End moving between them and choosing as they go - with the panel beneath rendered by the outline.
 */
export function OutlineTabs({
  pane,
  chosen,
  onChoose,
}: {
  pane: Pane;
  chosen: string;
  onChoose: (key: string) => void;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = OUTLINE_TABS.findIndex((tab) => tab.key === chosen);
    const count = OUTLINE_TABS.length;
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
    onChoose(OUTLINE_TABS[to]!.key);
    tabs.current[to]?.focus();
  };
  return (
    <div className={styles['strip']}>
      <a
        className={styles['back']}
        href="#/documents"
        aria-label="Back to documents"
        title="Back to documents"
      >
        <Icon name="Back" size={15} />
      </a>
      <div
        className={styles['tabs']}
        role="tablist"
        aria-label="Outline pane"
        onKeyDown={onKeyDown}
      >
        {OUTLINE_TABS.map((tab, index) => (
          <button
            key={tab.key}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={tabIds(tab.key).tab}
            className={styles['tab']}
            aria-selected={tab.key === chosen}
            aria-controls={tabIds(tab.key).panel}
            tabIndex={tab.key === chosen ? 0 : -1}
            onClick={() => onChoose(tab.key)}
          >
            <Icon name={tab.icon} size={14} />
            {tab.label}
          </button>
        ))}
      </div>
      <span className={styles['spacer']} />
      <PaneToggle label="outline pane" pane={pane} />
    </div>
  );
}

/** The pane hidden to a rail: the toggle, and each tab's name on its side, the chosen one marked. */
export function OutlineRail({ pane, chosen }: { pane: Pane; chosen: string }) {
  return (
    <div className={styles['rail']} data-rail>
      <PaneToggle label="outline pane" pane={pane} />
      {OUTLINE_TABS.map((tab) => (
        <span
          key={tab.key}
          className={styles['railLabel']}
          // Marked only where there is a choice to mark: one tab's name is just its name.
          data-chosen={OUTLINE_TABS.length > 1 && tab.key === chosen}
          aria-hidden="true"
        >
          {tab.label}
        </span>
      ))}
    </div>
  );
}
