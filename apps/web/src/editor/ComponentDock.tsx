import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { ManageAccessLink } from '../access/ManageAccessLink.js';
import { PaneToggle, type Pane } from '../layouts/PaneWidth.js';
import { PanelTabs } from '../parts/PanelTabs.js';
import styles from './ComponentDock.module.css';
import { VersionList } from './VersionList.js';

type Client = ReturnType<typeof createApiClient>;

export const COMPONENT_PANELS = [
  { key: 'table', label: 'Table' },
  { key: 'attributes', label: 'Attributes' },
  { key: 'versions', label: 'Versions' },
  { key: 'access', label: 'Access' },
] as const;

type PanelKey = (typeof COMPONENT_PANELS)[number]['key'];

const ids = (key: string) => ({ tab: `component-tab-${key}`, panel: `component-panel-${key}` });

/**
 * The panels beside an open component, named in words (ADR-0046, decision 6): Attributes, where the
 * editor sets the fields of the component's type (`onFieldsHost`), Versions and Access. Each panel
 * stays mounted while another is shown, so the fields keep what is being typed into them. Used in
 * waits for a route that can say (the LG plan, LG-H). Table comes first while the component holds a
 * table (ADR-0052): the editor sets its formatting there (`onTableHost`), and it is chosen each time
 * the cursor enters a table, the reader's own choice standing until the next.
 */
export function ComponentDock({
  client,
  id,
  onFieldsHost,
  table = { holds: false, entered: 0 },
  onTableHost = () => {},
  pane,
}: {
  client: Client;
  id: string;
  onFieldsHost: (host: HTMLElement | null) => void;
  /** Whether the component holds a table, and how many times the cursor has entered one. */
  table?: { readonly holds: boolean; readonly entered: number };
  onTableHost?: (host: HTMLElement | null) => void;
  /** Its width and whether it is hidden to a rail, which the page draws; kept mounted while hidden. */
  pane?: Pane;
}) {
  const [chosen, setChosen] = useState<PanelKey>('attributes');
  useEffect(() => {
    if (table.entered > 0) setChosen('table');
  }, [table.entered]);
  const panels = COMPONENT_PANELS.filter((each) => each.key !== 'table' || table.holds);
  const shown: PanelKey = chosen === 'table' && !table.holds ? 'attributes' : chosen;
  return (
    <div className={styles['dock']} hidden={pane?.collapsed}>
      {/* The tabs stay where they are while the body under them scrolls. */}
      <div className={styles['strip']}>
        <PanelTabs
          label="Component panels"
          tabs={panels}
          chosen={shown}
          onChoose={(key) => setChosen(key as PanelKey)}
          ids={ids}
        />
        <span className={styles['spacer']} />
        {pane && <PaneToggle label="component panels" pane={pane} edge="end" />}
      </div>
      <div className={styles['body']}>
        {table.holds && (
          <div
            id={ids('table').panel}
            role="tabpanel"
            aria-labelledby={ids('table').tab}
            className={styles['panel']}
            hidden={shown !== 'table'}
          >
            <div ref={onTableHost} />
          </div>
        )}
        <div
          id={ids('attributes').panel}
          role="tabpanel"
          aria-labelledby={ids('attributes').tab}
          className={styles['panel']}
          hidden={shown !== 'attributes'}
        >
          <div ref={onFieldsHost} />
          <dl className={styles['facts']}>
            <dt>Identifier</dt>
            <dd className={styles['mono']}>{id}</dd>
          </dl>
        </div>
        <div
          id={ids('versions').panel}
          role="tabpanel"
          aria-labelledby={ids('versions').tab}
          className={styles['panel']}
          hidden={shown !== 'versions'}
        >
          {shown === 'versions' && <VersionList client={client} id={id} />}
        </div>
        <div
          id={ids('access').panel}
          role="tabpanel"
          aria-labelledby={ids('access').tab}
          className={styles['panel']}
          hidden={shown !== 'access'}
        >
          {shown === 'access' && (
            <>
              <p className={styles['muted']}>
                Who may read, change and publish this component is set on its access page.
              </p>
              <ManageAccessLink
                client={client}
                target={`artifact:${id}`}
                href={`#/components/${id}/access`}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
