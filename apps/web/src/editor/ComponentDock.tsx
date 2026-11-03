import type { createApiClient } from '@alloy-works/api-client';
import { useState } from 'react';

import { ManageAccessLink } from '../access/ManageAccessLink.js';
import { PaneToggle, type Pane } from '../layouts/PaneWidth.js';
import { PanelTabs } from '../parts/PanelTabs.js';
import styles from './ComponentDock.module.css';
import type { Mine } from './ComponentEditor.js';
import { VersionsPanel } from './VersionsPanel.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

export const COMPONENT_PANELS = [
  {
    key: 'table',
    get label() {
      return words('editor.table');
    },
  },
  {
    key: 'attributes',
    get label() {
      return words('editor.attributes');
    },
  },
  {
    key: 'versions',
    get label() {
      return words('editor.versions');
    },
  },
  {
    key: 'access',
    get label() {
      return words('editor.access');
    },
  },
] as const;

type PanelKey = (typeof COMPONENT_PANELS)[number]['key'];

const ids = (key: string) => ({ tab: `component-tab-${key}`, panel: `component-panel-${key}` });

/**
 * The panels beside an open component, named in words (ADR-0046, decision 6): Attributes, where the
 * editor sets the fields of the component's type (`onFieldsHost`), Versions and Access. Each panel
 * stays mounted while another is shown, so the fields keep what is being typed into them. Used in
 * waits for a route that can say (the LG plan, LG-H). Table comes first while the component holds a
 * table (ADR-0052): the editor sets its formatting there (`onTableHost`). It is never chosen for the
 * reader, and shows a dot while the cursor is in a table and it is not showing (ADR-0079).
 */
export function ComponentDock({
  client,
  id,
  line,
  onFieldsHost,
  table = { holds: false, inHand: false },
  onTableHost = () => {},
  pane,
  mine,
  mayEdit = false,
  onRestored,
}: {
  client: Client;
  id: string;
  /** The line open, whose history the Versions panel shows and restores on (LOC-012). */
  line?: string | undefined;
  onFieldsHost: (host: HTMLElement | null) => void;
  /** Whether the component holds a table, and whether the cursor is in one. */
  table?: { readonly holds: boolean; readonly inHand: boolean };
  onTableHost?: (host: HTMLElement | null) => void;
  /** Its width and whether it is hidden to a rail, which the page draws; kept mounted while hidden. */
  pane?: Pane;
  /** What the editor opened and shows now, for My changes (CNT-113). */
  mine?: () => Mine | null;
  /** Whether the caller may edit the component, and so restore an earlier version. */
  mayEdit?: boolean;
  /** Told once an earlier version is restored, so the editor opens the new latest. */
  onRestored?: () => void;
}) {
  const [chosen, setChosen] = useState<PanelKey>('attributes');
  const shown: PanelKey = chosen === 'table' && !table.holds ? 'attributes' : chosen;
  const panels = COMPONENT_PANELS.filter((each) => each.key !== 'table' || table.holds).map(
    (each) =>
      each.key === 'table' && table.inHand && shown !== 'table'
        ? { key: each.key, label: each.label, dot: true, name: words('editor.table-in-hand') }
        : each,
  );
  return (
    <div className={styles['dock']} hidden={pane?.collapsed}>
      {/* The tabs stay where they are while the body under them scrolls. */}
      <div className={styles['strip']}>
        <PanelTabs
          label={words('editor.component-panels')}
          tabs={panels}
          chosen={shown}
          onChoose={(key) => setChosen(key as PanelKey)}
          ids={ids}
        />
        <span className={styles['spacer']} />
        {pane && <PaneToggle label={words('editor.component-panels-2')} pane={pane} edge="end" />}
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
            <dt>{words('editor.identifier')}</dt>
            <dd className={styles['mono']} data-content>
              {id}
            </dd>
          </dl>
        </div>
        <div
          id={ids('versions').panel}
          role="tabpanel"
          aria-labelledby={ids('versions').tab}
          className={styles['panel']}
          hidden={shown !== 'versions'}
        >
          {shown === 'versions' && (
            <VersionsPanel
              // Another line is another history: nothing previewed on one is shown on the next.
              key={line ?? ''}
              client={client}
              id={id}
              line={line}
              {...(mine ? { mine } : {})}
              mayEdit={mayEdit}
              {...(onRestored ? { onRestored } : {})}
            />
          )}
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
              <p className={styles['muted']}>{words('editor.who-may-read-change-and')}</p>
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
