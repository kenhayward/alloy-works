import { useEffect, useId, useState, type ReactNode } from 'react';

import { PanelTabs, type PanelTab } from './PanelTabs.js';
import styles from './parts.module.css';
import { StateStrip, type StripCell } from './StateStrip.js';

/**
 * A connection's or a query definition's page (ADR-0050): a header - breadcrumb, title, chips, then
 * its actions - a state strip, and tabs, one panel showing and filling the rest of the window, so the
 * page itself does not scroll. The chosen tab is in the address: choosing another replaces it there
 * rather than adding to the history, so Back leaves the page. A tab the page does not offer, such as
 * Tables on an HTTP connection, opens the first.
 */
export function DetailPage({
  trail,
  title,
  chips,
  actions,
  strip,
  notice,
  label,
  tabs,
  chosen,
  link,
  children,
}: {
  trail: ReactNode;
  title: string;
  chips?: ReactNode;
  /** The primary action, then a more-actions menu. */
  actions?: ReactNode;
  strip: readonly StripCell[];
  /** What an act from the header answered, shown under the strip whichever tab is open. */
  notice?: ReactNode;
  /** The tab list's name: "Connection". */
  label: string;
  tabs: readonly PanelTab[];
  /** The tab the address names, or null for the first. */
  chosen: string | null;
  /** The address of the page at a tab. */
  link: (tab: string) => string;
  /** The chosen tab's panel. */
  children: (tab: string) => ReactNode;
}) {
  const id = useId();
  const [picked, setPicked] = useState(chosen);
  // A link to another tab of the page already open.
  useEffect(() => setPicked(chosen), [chosen]);
  const open = tabs.find((tab) => tab.key === picked && !tab.disabled) ?? tabs[0]!;
  const ids = (key: string) => ({ tab: `${id}-tab-${key}`, panel: `${id}-panel-${key}` });
  return (
    <div className={styles['detail']}>
      <header className={styles['detailHead']}>
        <div className={styles['detailTitle']}>
          {trail !== null && (
            <nav aria-label="Breadcrumb" className={styles['detailTrail']}>
              {trail}
            </nav>
          )}
          <h1>{title}</h1>
          {chips !== undefined && <div className={styles['detailChips']}>{chips}</div>}
        </div>
        {actions !== undefined && <div className={styles['detailActions']}>{actions}</div>}
      </header>
      {strip.length > 0 && <StateStrip cells={strip} />}
      {notice !== undefined && <div className={styles['detailNotice']}>{notice}</div>}
      <PanelTabs
        label={label}
        tabs={tabs}
        chosen={open.key}
        onChoose={(key) => {
          setPicked(key);
          window.location.replace(link(key));
        }}
        ids={ids}
        className={styles['detailTabs']}
        tabClassName={styles['detailTab']}
      />
      <div
        role="tabpanel"
        id={ids(open.key).panel}
        aria-labelledby={ids(open.key).tab}
        className={styles['detailPanel']}
      >
        {children(open.key)}
      </div>
    </div>
  );
}
