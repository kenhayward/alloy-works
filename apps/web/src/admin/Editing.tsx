import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { words } from '../words/words.js';

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
    get label() {
      return words('admin.a-lock-lasts-once-its');
    },
    min: 5,
    max: 240,
    get hint() {
      return words('admin.after-this-long-with-nothing');
    },
  },
  {
    key: 'lockTakeMinutes',
    get label() {
      return words('admin.a-lock-may-be-taken');
    },
    min: 1,
    max: 239,
    get hint() {
      return words('admin.somebody-may-ask-an-idle');
    },
  },
  {
    key: 'iterationRetentionDays',
    get label() {
      return words('admin.saved-changes-are-kept-after');
    },
    min: 1,
    max: 365,
    get hint() {
      return words('admin.how-long-work-saved-but');
    },
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
      setSaid(words('admin.a-lock-may-be-taken-2'));
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await client.PUT('/v1/settings/editing', {
        body: body as unknown as Settings,
      });
      if (data) {
        setRead(data);
        setSaid(words('admin.saved'));
      } else setSaid(refusal(error, words('admin.the-settings-could-not-be')));
    } catch {
      setSaid(words('admin.the-settings-could-not-be'));
    } finally {
      setBusy(false);
    }
  };

  if (read === null) return <Waiting>{words('admin.loading')}</Waiting>;
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>{words('admin.the-editing-settings-could-not')}</p>
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
            {words('admin.save')}
          </button>
        </div>
      ) : (
        <p className={styles['muted']}>{words('admin.only-an-administrator-of-the')}</p>
      )}
    </form>
  );
}
