import type { createApiClient } from '@alloy-works/api-client';
import {
  compareContent,
  unitTexts,
  type ContentDocument,
  type UnitChange,
} from '@alloy-works/domain';
import { useRef, useState } from 'react';

import { Redline, redlineHtml, saveHtml } from '../compare/Redline.js';
import type { Mine } from './ComponentEditor.js';
import { VersionList, type ListedVersion } from './VersionList.js';
import styles from './VersionList.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Shown {
  readonly title: string;
  readonly changes: readonly UnitChange[];
  readonly older: ContentDocument;
  readonly newer: ContentDocument;
}

/**
 * The Versions panel (CNT-111, CNT-112, CNT-113): each version, who cut it and when, with **Compare**
 * against the latest; and **My changes**, what this editor holds now against the version it opened,
 * compared in the browser (CP-E), so it needs no lock and lags no save. The redline beneath, and its
 * export.
 */
export function VersionsPanel({
  client,
  id,
  mine,
}: {
  client: Client;
  id: string;
  /** The version the editor opened and what it shows now, or null where nothing is open to compare. */
  mine?: () => Mine | null;
}) {
  const [shown, setShown] = useState<Shown | 'failed' | 'nothing' | null>(null);
  const drawn = useRef<HTMLDivElement>(null);
  // The comparison last asked for: an answer to an earlier one, arriving later, is not shown.
  const asked = useRef(0);

  const compare = async (version: ListedVersion, latest: ListedVersion) => {
    const mine = (asked.current += 1);
    const answer = await client
      .GET('/v1/components/{id}/comparison', {
        params: { path: { id }, query: { from: version.id, to: latest.id } },
      })
      .catch(() => undefined);
    if (mine !== asked.current) return;
    const data = answer?.data;
    if (!data) return setShown('failed');
    setShown({
      title: `Changes from ${data.from.number} to ${data.to.number}`,
      changes: data.changes as readonly UnitChange[],
      older: data.older as unknown as ContentDocument,
      newer: data.newer as unknown as ContentDocument,
    });
  };

  const myChanges = () => {
    asked.current += 1;
    const pair = mine?.();
    if (!pair) return setShown('nothing');
    setShown({
      title: 'My changes',
      changes: compareContent(pair.older, pair.newer).changes,
      older: pair.older,
      newer: pair.newer,
    });
  };

  return (
    <div className={styles['panel']}>
      {mine && (
        <button type="button" onClick={myChanges}>
          My changes
        </button>
      )}
      <VersionList
        client={client}
        id={id}
        onCompare={(version, latest) => void compare(version, latest)}
      />
      {shown === 'failed' && <p className={styles['muted']}>The comparison could not be read.</p>}
      {shown === 'nothing' && (
        <p className={styles['muted']}>Nothing is open for editing to compare yet.</p>
      )}
      {shown !== null && shown !== 'failed' && shown !== 'nothing' && (
        <section aria-label={shown.title} className={styles['compared']}>
          <h3 className={styles['heading']}>{shown.title}</h3>
          <div ref={drawn}>
            <Redline
              changes={shown.changes}
              texts={{ older: unitTexts(shown.older), newer: unitTexts(shown.newer) }}
              label={shown.title}
            />
          </div>
          <button
            type="button"
            onClick={() =>
              drawn.current &&
              saveHtml(
                `${shown.newer.title} - ${shown.title}.html`,
                redlineHtml(`${shown.newer.title}: ${shown.title}`, drawn.current),
              )
            }
          >
            Export
          </button>
        </section>
      )}
    </div>
  );
}
