import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Settings {
  readonly iterationRetentionDays: number;
  readonly lockReleaseMinutes: number;
  readonly lockTakeMinutes: number;
}

/** Each setting: its field's words, its bounds and what it means. */
const FIELDS = [
  {
    key: 'lockReleaseMinutes',
    label: 'A lock lasts, once its holder stops (minutes)',
    min: 5,
    max: 240,
    hint: 'After this long with nothing saved, a component being edited is free for anybody to edit.',
  },
  {
    key: 'lockTakeMinutes',
    label: 'A lock may be taken over after (minutes)',
    min: 1,
    max: 239,
    hint: 'Somebody may ask an idle holder for the component after this long; always less than the time above.',
  },
  {
    key: 'iterationRetentionDays',
    label: 'Saved changes are kept after the next version (days)',
    min: 1,
    max: 365,
    hint: 'How long work saved but never made a version can still be recovered once someone saves a newer version.',
  },
] as const;

/**
 * **Administration's Editing** (COL-008, COL-046; collaboration.md, Settings): how long a lock lasts,
 * how soon an idle holder's may be taken, and how long saved changes are kept, read by anybody and
 * changed by an administrator of the environment.
 */
export function Editing({ client, mayChange }: { client: Client; mayChange: boolean }) {
  const [read, setRead] = useState<Settings | 'failed' | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/settings/editing')
      .then(({ data }) => {
        if (!current) return;
        setRead(data ?? 'failed');
        if (data) setDraft(Object.fromEntries(FIELDS.map(({ key }) => [key, String(data[key])])));
      })
      .catch(() => current && setRead('failed'));
    return () => {
      current = false;
    };
  }, [client]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const body = Object.fromEntries(FIELDS.map(({ key }) => [key, Number(draft[key])]));
    if (Number(body['lockTakeMinutes']) >= Number(body['lockReleaseMinutes'])) {
      setSaid('A lock may be taken over only before it would be free: make that time shorter.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await client.PUT('/v1/settings/editing', {
        body: body as unknown as Settings,
      });
      if (data) {
        setRead(data);
        setSaid('Saved.');
      } else setSaid(refusal(error, 'The settings could not be saved.'));
    } catch {
      setSaid('The settings could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (read === null) return <Waiting>Loading...</Waiting>;
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>The editing settings could not be read.</p>
      </Notice>
    );
  }
  return (
    <form className={styles['settings']} onSubmit={(event) => void save(event)}>
      {FIELDS.map((field) => (
        <label key={field.key} className={styles['setting']}>
          <span className={styles['strong']}>{field.label}</span>
          <input
            type="number"
            min={field.min}
            max={field.max}
            step={1}
            required
            disabled={!mayChange}
            value={draft[field.key] ?? ''}
            onChange={(change) => setDraft((was) => ({ ...was, [field.key]: change.target.value }))}
          />
          <span className={styles['muted']}>{field.hint}</span>
        </label>
      ))}
      <p role="status">{said}</p>
      {mayChange ? (
        <div>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      ) : (
        <p className={styles['muted']}>
          Only an administrator of the environment may change these.
        </p>
      )}
    </form>
  );
}
