import { useState } from 'react';

import { Icon } from '../editor/Icon.js';
import { kept, keep, PaneToggle, type Pane } from '../layouts/PaneWidth.js';
import styles from './OutlineTabs.module.css';
import { words } from '../words/words.js';

/** One tab of the outline pane: what it is called and the glyph beside its name. */
export interface OutlineTab {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
}

/**
 * The pane's tabs: Contents, Data where the document holds a binding (BI-H), and its Baselines (the
 * BL plan).
 */
export const OUTLINE_TABS: readonly OutlineTab[] = [
  {
    key: 'contents',
    get label() {
      return words('document.contents');
    },
    get icon() {
      return words('document.contents');
    },
  },
  {
    key: 'data',
    get label() {
      return words('document.data');
    },
    get icon() {
      return words('document.value');
    },
  },
  {
    key: 'baselines',
    get label() {
      return words('document.baselines');
    },
    get icon() {
      return words('document.keep');
    },
  },
];

/** The tabs offered: Data only where the document holds a binding. */
export const offeredTabs = (holdsBinding: boolean): readonly OutlineTab[] =>
  holdsBinding ? OUTLINE_TABS : OUTLINE_TABS.filter((tab) => tab.key !== 'data');

/** The tab shown: the one chosen where it is offered, Contents where it is not. */
export const shownTab = (chosen: string, offered: readonly OutlineTab[]): string =>
  offered.some((tab) => tab.key === chosen) ? chosen : OUTLINE_TABS[0]!.key;

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
 * The top of the outline pane in the side dock (ADR-0075): the panel's name and what hides it, and, on
 * Contents, a filter over the sections.
 */
export function OutlineHead({
  pane,
  label,
  filter,
  onFilter,
}: {
  pane: Pane;
  label: string;
  /** What the filter holds, where this panel offers one. */
  filter?: string | undefined;
  onFilter?: ((text: string) => void) | undefined;
}) {
  return (
    <>
      <div className={styles['panelHead']}>
        <h2 className={styles['panelName']}>{label}</h2>
        <PaneToggle label={words('document.outline-pane-2')} pane={pane} />
      </div>
      {onFilter !== undefined && (
        <input
          type="search"
          className={styles['filter']}
          aria-label={words('document.filter-sections')}
          placeholder={words('document.filter-sections')}
          value={filter ?? ''}
          onChange={(event) => onFilter(event.target.value)}
        />
      )}
    </>
  );
}

/**
 * A pane hidden to a rail: the toggle, and each tab's name on its side, the chosen one marked. The
 * outline's by default; the panels beside the text name themselves and stand at the page's end.
 */
export function OutlineRail({
  pane,
  chosen,
  tabs: offered = OUTLINE_TABS,
  label = words('document.outline-pane-2'),
  edge = 'start',
  className,
}: {
  pane: Pane;
  chosen: string;
  /** Each tab's key and label, marked `content` where the label is the tenant's, a space's name. */
  tabs?: readonly { readonly key: string; readonly label: string; readonly content?: boolean }[];
  label?: string;
  edge?: 'start' | 'end';
  className?: string | undefined;
}) {
  return (
    <div className={`${styles['rail']}${className === undefined ? '' : ` ${className}`}`} data-rail>
      <PaneToggle label={label} pane={pane} edge={edge} />
      {offered.map((tab) => (
        <span
          key={tab.key}
          className={styles['railLabel']}
          // Marked only where there is a choice to mark: one tab's name is just its name.
          data-chosen={offered.length > 1 && tab.key === chosen}
          aria-hidden="true"
          data-content={tab.content === true ? '' : undefined}
        >
          {tab.label}
        </span>
      ))}
    </div>
  );
}
