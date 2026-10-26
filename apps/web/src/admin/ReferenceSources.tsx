import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Source {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly enabled: boolean;
}

/**
 * **Administration's Reference sources** (the XR plan, XR-C): each declared source, on by default, and
 * the host it is reached at; an administrator of the environment switches one off, and it is then
 * neither searched nor made an entry from.
 */
export function ReferenceSources({ client, mayChange }: { client: Client; mayChange: boolean }) {
  const [read, setRead] = useState<readonly Source[] | 'failed' | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/reference-sources')
      .then(({ data }) => current && setRead(data?.items ?? 'failed'))
      .catch(() => current && setRead('failed'));
    return () => {
      current = false;
    };
  }, [client]);

  const change = async (source: Source, enabled: boolean) => {
    setBusy(true);
    try {
      const { data, error } = await client.PUT('/v1/reference-sources', {
        body: { source: source.id, enabled },
      });
      if (data) {
        setRead((was) =>
          Array.isArray(was) ? was.map((each) => (each.id === data.id ? data : each)) : was,
        );
        setSaid(words('admin.is', { name: data.name, state: data.enabled ? 'on' : 'off' }));
      } else setSaid(refusal(error, words('admin.the-source-could-not-be')));
    } catch {
      setSaid(words('admin.the-source-could-not-be'));
    } finally {
      setBusy(false);
    }
  };

  if (read === null) return <Waiting>{words('admin.loading')}</Waiting>;
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>{words('admin.the-reference-sources-could-not')}</p>
      </Notice>
    );
  }
  return (
    <div className={styles['settings']}>
      <p className={styles['muted']}>{words('admin.authors-search-a-source-that')}</p>
      {read.map((source) => (
        <label key={source.id} className={styles['setting']}>
          <span>
            <input
              type="checkbox"
              checked={source.enabled}
              disabled={!mayChange || busy}
              onChange={(event) => void change(source, event.target.checked)}
            />{' '}
            <span className={styles['strong']} data-content>
              {source.name}
            </span>
          </span>
          <span className={styles['muted']}>
            {words('admin.reached-at', { host: source.host })}
          </span>
        </label>
      ))}
      <p role="status">{said}</p>
      {!mayChange && (
        <p className={styles['muted']}>{words('admin.only-an-administrator-of-the-3')}</p>
      )}
    </div>
  );
}
