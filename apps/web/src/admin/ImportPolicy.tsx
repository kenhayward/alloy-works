import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

type Policy = 'map' | 'keep' | 'discard';

/** Each policy, in words (IM-I; IMP-010). */
const POLICIES: readonly {
  readonly policy: Policy;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    policy: 'map',
    label: 'Match to members',
    hint: 'Each name is kept as text, with the member its email matches, or a name match the importer confirms.',
  },
  { policy: 'keep', label: 'Keep as text', hint: 'Each name is kept as the file gives it.' },
  { policy: 'discard', label: 'Discard', hint: 'No name the file carries is kept.' },
];

/**
 * **Administration's Imports** (the IM plan, IM-I): what an accepted import keeps of the names a Word
 * file carries, read by anybody and changed by an administrator of the environment.
 */
export function ImportPolicy({ client, mayChange }: { client: Client; mayChange: boolean }) {
  const [read, setRead] = useState<Policy | 'failed' | null>(null);
  const [draft, setDraft] = useState<Policy>('map');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/settings/import')
      .then(({ data }) => {
        if (!current) return;
        setRead(data?.policy ?? 'failed');
        if (data) setDraft(data.policy);
      })
      .catch(() => current && setRead('failed'));
    return () => {
      current = false;
    };
  }, [client]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await client.PUT('/v1/settings/import', { body: { policy: draft } });
      if (data) {
        setRead(data.policy);
        setSaid('Saved.');
      } else setSaid(refusal(error, 'The policy could not be saved.'));
    } catch {
      setSaid('The policy could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (read === null) return <Waiting>Loading...</Waiting>;
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>The import settings could not be read.</p>
      </Notice>
    );
  }
  return (
    <form className={styles['settings']} onSubmit={(event) => void save(event)}>
      <fieldset>
        <legend className={styles['strong']}>The names an imported Word file carries</legend>
        {POLICIES.map((each) => (
          <label key={each.policy} className={styles['setting']}>
            <span>
              <input
                type="radio"
                name="import-policy"
                value={each.policy}
                checked={draft === each.policy}
                disabled={!mayChange}
                onChange={() => setDraft(each.policy)}
              />{' '}
              {each.label}
            </span>
            <span className={styles['muted']}>{each.hint}</span>
          </label>
        ))}
      </fieldset>
      <p className={styles['muted']}>
        Suggestions and comments from a file are always made by whoever accepts the import. A name
        is only ever recorded beside them.
      </p>
      <p role="status">{said}</p>
      {mayChange ? (
        <div>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      ) : (
        <p className={styles['muted']}>Only an administrator of the environment may change this.</p>
      )}
    </form>
  );
}
