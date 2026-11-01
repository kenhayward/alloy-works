import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

type Undeclared = 'warn' | 'refuse';

/** Each policy, in words (AST-053; the AL plan, AL-F). */
const POLICIES: readonly {
  readonly policy: Undeclared;
  readonly label: string;
  readonly hint: string;
}[] = [
  {
    policy: 'warn',
    get label() {
      return words('admin.publish-and-report-them');
    },
    get hint() {
      return words('admin.the-publish-goes-ahead-and');
    },
  },
  {
    policy: 'refuse',
    get label() {
      return words('admin.refuse-the-publish');
    },
    get hint() {
      return words('admin.the-publish-is-refused-naming');
    },
  },
];

/**
 * **Administration's Images** (the AL plan, AL-F): what a publish does with an image whose source and
 * licence were never declared, or whose grant has lapsed, read by anybody and changed by an
 * administrator of the environment.
 */
export function ImagesPolicy({ client, mayChange }: { client: Client; mayChange: boolean }) {
  const [read, setRead] = useState<Undeclared | 'failed' | null>(null);
  const [draft, setDraft] = useState<Undeclared>('warn');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/settings/images')
      .then(({ data }) => {
        if (!current) return;
        setRead(data?.undeclared ?? 'failed');
        if (data) setDraft(data.undeclared);
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
      const { data, error } = await client.PUT('/v1/settings/images', {
        body: { undeclared: draft },
      });
      if (data) {
        setRead(data.undeclared);
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
        <p>{words('admin.the-images-settings-could-not')}</p>
      </Notice>
    );
  }
  return (
    <form className={styles['settings']} onSubmit={(event) => void save(event)}>
      <fieldset>
        <legend className={styles['strong']}>{words('admin.an-image-with-no-licence')}</legend>
        {POLICIES.map((each) => (
          <label key={each.policy} className={styles['setting']}>
            <span>
              <input
                type="radio"
                name="images-policy"
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
      <p className={styles['muted']}>{words('admin.an-image-whose-licence-does')}</p>
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
