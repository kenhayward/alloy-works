import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { words } from '../words/words.js';

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
    get label() {
      return words('admin.match-to-members');
    },
    get hint() {
      return words('admin.each-name-is-kept-as');
    },
  },
  {
    policy: 'keep',
    get label() {
      return words('admin.keep-as-text');
    },
    get hint() {
      return words('admin.each-name-is-kept-as-2');
    },
  },
  {
    policy: 'discard',
    get label() {
      return words('admin.discard');
    },
    get hint() {
      return words('admin.no-name-the-file-carries');
    },
  },
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
        setSaid(words('admin.saved'));
      } else setSaid(refusal(error, words('admin.the-policy-could-not-be')));
    } catch {
      setSaid(words('admin.the-policy-could-not-be'));
    } finally {
      setBusy(false);
    }
  };

  if (read === null) return <Waiting>{words('admin.loading')}</Waiting>;
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>{words('admin.the-import-settings-could-not')}</p>
      </Notice>
    );
  }
  return (
    <form className={styles['settings']} onSubmit={(event) => void save(event)}>
      <fieldset>
        <legend className={styles['strong']}>{words('admin.the-names-an-imported-word')}</legend>
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
      <p className={styles['muted']}>{words('admin.suggestions-and-comments-from-a')}</p>
      <p role="status">{said}</p>
      {mayChange ? (
        <div>
          <button type="submit" className="primary" disabled={busy}>
            {words('admin.save')}
          </button>
        </div>
      ) : (
        <p className={styles['muted']}>{words('admin.only-an-administrator-of-the-2')}</p>
      )}
    </form>
  );
}
