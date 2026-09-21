import { useState } from 'react';

import styles from './ListLayout.module.css';

const COLLAPSED = 'aw.filter.collapsed';

/** Whether this person last hid the filter; a convenience, so a browser that will not say is "no". */
function remembered(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED) === 'true';
  } catch {
    return false;
  }
}

function remember(collapsed: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSED, String(collapsed));
  } catch {
    // Not remembered, which costs one click next time.
  }
}

/**
 * Layout A: a filter pane that collapses to a rail, then the list at nearly full width. Components,
 * Documents, Publications and search results are all this shape (docs/interface/README.md).
 */
export function ListLayout({
  filter,
  children,
}: {
  filter: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(remembered);
  const toggle = (next: boolean) => {
    setCollapsed(next);
    remember(next);
  };
  return (
    <div className={styles['layout']} data-collapsed={collapsed}>
      {collapsed ? (
        <div className={styles['rail']}>
          <button
            type="button"
            className={styles['railButton']}
            aria-label="Show the filter"
            title="Show the filter"
            onClick={() => toggle(false)}
          >
            <span aria-hidden="true">&gt;</span>
          </button>
          <span className={styles['railLabel']} aria-hidden="true">
            Filter
          </span>
        </div>
      ) : (
        <aside className={styles['filter']} aria-label="Filter">
          <button
            type="button"
            className={styles['hide']}
            aria-label="Hide the filter"
            title="Hide the filter"
            onClick={() => toggle(true)}
          >
            <span aria-hidden="true">&lt;</span>
          </button>
          {filter}
        </aside>
      )}
      <div className={styles['list']}>{children}</div>
    </div>
  );
}
