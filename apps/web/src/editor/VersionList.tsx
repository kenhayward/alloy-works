import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import styles from './VersionList.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Version {
  readonly number: string;
  readonly createdAt: string;
  readonly author: string | null;
  readonly note: string | null;
}

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/**
 * A component's versions, newest first: each number, who cut it and when, and its note. The latest
 * `limit` of them, or as many as one page holds.
 */
export function VersionList({ client, id, limit }: { client: Client; id: string; limit?: number }) {
  const [versions, setVersions] = useState<readonly Version[] | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setVersions(undefined);
    client
      .GET('/v1/components/{id}/versions', {
        params: { path: { id }, query: limit === undefined ? {} : { limit: String(limit) } },
      })
      .then(({ data }) => {
        if (!current) return;
        setVersions(
          data
            ? data.items.map((each) => ({
                number: each.number,
                createdAt: each.createdAt,
                author: each.author?.name ?? null,
                note: each.note,
              }))
            : null,
        );
      })
      .catch(() => current && setVersions(null));
    return () => {
      current = false;
    };
  }, [client, id, limit]);

  if (versions === undefined) return null;
  if (versions === null) return <p className={styles['muted']}>The versions could not be read.</p>;
  if (versions.length === 0)
    return <p className={styles['muted']}>No version has been saved yet.</p>;
  return (
    <ul className={styles['versions']} aria-label="Versions">
      {versions.map((version) => (
        <li key={version.number} className={styles['version']}>
          <span className={styles['number']}>{version.number}</span>
          <span className={styles['who']}>
            {`${version.author ?? 'Unknown'}, ${day.format(new Date(version.createdAt))}`}
            {version.note !== null && <span className={styles['note']}>{version.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
