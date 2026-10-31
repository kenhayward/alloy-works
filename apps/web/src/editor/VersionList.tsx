import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { componentVersionLink } from '../search/links.js';
import { documentVersionLink } from '../structure/links.js';
import styles from './VersionList.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A version as the list shows it. */
export interface ListedVersion {
  readonly id: string;
  readonly number: string;
  readonly createdAt: string;
  readonly author: string | null;
  readonly note: string | null;
  /** The version's number it was restored from (VER-033), or null. */
  readonly restoredFrom: string | null;
}

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/**
 * A component's versions, or a document's, newest first: each number, who cut it and when, its note, and what it was
 * restored from. The latest `limit` of them, or as many as one page holds.
 */
export function VersionList({
  client,
  id,
  line,
  limit,
  onCompare,
  onRestore,
  opens = false,
  read = 0,
  of = 'component',
}: {
  client: Client;
  id: string;
  /** A component's line whose versions to list (LOC-012); its main line's where absent. */
  line?: string;
  /** Whose versions: a component's, or a document's (the RS plan, RS-H). */
  of?: 'component' | 'document';
  limit?: number;
  /** Offered on each version but the latest: compares it with the latest (CNT-111). */
  onCompare?: (version: ListedVersion, latest: ListedVersion) => void;
  /** Offered on each version but the latest: previews restoring it (the RS plan, RS-H). */
  onRestore?: (version: ListedVersion, latest: ListedVersion) => void;
  /** Whether each version but the latest offers Open, on its own page read only (SCH-058). */
  opens?: boolean;
  /** Read again each time this changes, as after a restore. */
  read?: number;
}) {
  const [versions, setVersions] = useState<readonly ListedVersion[] | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setVersions(undefined);
    const query = limit === undefined ? {} : { limit: String(limit) };
    (of === 'document'
      ? client.GET('/v1/documents/{id}/versions', { params: { path: { id }, query } })
      : client.GET('/v1/components/{id}/versions', {
          params: { path: { id }, query: { ...query, ...(line === undefined ? {} : { line }) } },
        })
    )
      .then(({ data }) => {
        if (!current) return;
        setVersions(
          data
            ? data.items.map((each) => ({
                id: each.id,
                number: each.number,
                createdAt: each.createdAt,
                author: each.author?.name ?? null,
                note: each.note,
                restoredFrom: each.restoredFrom?.number ?? null,
              }))
            : null,
        );
      })
      .catch(() => current && setVersions(null));
    return () => {
      current = false;
    };
  }, [client, id, line, limit, read, of]);

  if (versions === undefined) return null;
  if (versions === null)
    return <p className={styles['muted']}>{words('editor.the-versions-could-not-be')}</p>;
  if (versions.length === 0)
    return <p className={styles['muted']}>{words('editor.no-version-has-been-saved')}</p>;
  return (
    <ul className={styles['versions']} aria-label={words('editor.versions')}>
      {versions.map((version) => (
        <li key={version.number} className={styles['version']}>
          <span className={styles['number']}>{version.number}</span>
          <span className={styles['who']}>
            {`${version.author ?? words('editor.unknown')}, ${day.format(new Date(version.createdAt))}`}
            {version.note !== null && <span className={styles['note']}>{version.note}</span>}
            {version.restoredFrom !== null && (
              <span className={styles['note']}>
                {words('editor.restored-from-version', { restoredFrom: version.restoredFrom })}
              </span>
            )}
          </span>
          {opens && version !== versions[0] && (
            <a
              className={styles['open']}
              aria-label={words('editor.open-2', { number: version.number })}
              href={
                of === 'document'
                  ? documentVersionLink(id, version.id)
                  : componentVersionLink(id, version.id)
              }
            >
              {words('editor.open')}
            </a>
          )}
          {onCompare && version !== versions[0] && (
            <button
              type="button"
              className={styles['compare']}
              aria-label={words('editor.compare-with', {
                number: version.number,
                number2: versions[0]!.number,
              })}
              onClick={() => onCompare(version, versions[0]!)}
            >
              {words('editor.compare')}
            </button>
          )}
          {onRestore && version !== versions[0] && (
            <button
              type="button"
              className={styles['restore']}
              aria-label={words('editor.restore', { number: version.number })}
              onClick={() => onRestore(version, versions[0]!)}
            >
              {words('editor.restore-2')}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
