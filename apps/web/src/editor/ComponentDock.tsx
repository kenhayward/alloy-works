import type { createApiClient } from '@alloy-works/api-client';
import { useState } from 'react';

import { ManageAccessLink } from '../access/ManageAccessLink.js';
import { PanelTabs } from '../parts/PanelTabs.js';
import styles from './ComponentDock.module.css';
import { VersionList } from './VersionList.js';

type Client = ReturnType<typeof createApiClient>;

const PANELS = [
  { key: 'attributes', label: 'Attributes' },
  { key: 'versions', label: 'Versions' },
  { key: 'access', label: 'Access' },
] as const;

type PanelKey = (typeof PANELS)[number]['key'];

const ids = (key: string) => ({ tab: `component-tab-${key}`, panel: `component-panel-${key}` });

/**
 * The panels beside an open component, named in words (ADR-0046, decision 6): Attributes, where the
 * editor sets the fields of the component's type (`onFieldsHost`), Versions and Access. Each panel
 * stays mounted while another is shown, so the fields keep what is being typed into them. Used in
 * waits for a route that can say (the LG plan, LG-H).
 */
export function ComponentDock({
  client,
  id,
  onFieldsHost,
}: {
  client: Client;
  id: string;
  onFieldsHost: (host: HTMLElement | null) => void;
}) {
  const [chosen, setChosen] = useState<PanelKey>('attributes');
  return (
    <div className={styles['dock']}>
      <PanelTabs
        label="Component panels"
        tabs={PANELS}
        chosen={chosen}
        onChoose={(key) => setChosen(key as PanelKey)}
        ids={ids}
      />
      <div
        id={ids('attributes').panel}
        role="tabpanel"
        aria-labelledby={ids('attributes').tab}
        className={styles['panel']}
        hidden={chosen !== 'attributes'}
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
        hidden={chosen !== 'versions'}
      >
        {chosen === 'versions' && <VersionList client={client} id={id} />}
      </div>
      <div
        id={ids('access').panel}
        role="tabpanel"
        aria-labelledby={ids('access').tab}
        className={styles['panel']}
        hidden={chosen !== 'access'}
      >
        {chosen === 'access' && (
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
  );
}
