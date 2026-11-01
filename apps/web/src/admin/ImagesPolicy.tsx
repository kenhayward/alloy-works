import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

type Undeclared = 'warn' | 'refuse';

/** The formats whose largest image an environment may lower, by name (AST-004; AL-I). */
const FORMATS = [
  { format: 'png', name: 'PNG' },
  { format: 'jpeg', name: 'JPEG' },
] as const;
type Format = (typeof FORMATS)[number]['format'];
type Limits = Record<Format, number | null>;

/** Bytes as the megabytes typed, or blank for the product's own. */
const megabytes = (bytes: number | null) => (bytes === null ? '' : String(bytes / 1_000_000));
const bytesOf = (typed: string) =>
  typed.trim() === '' ? null : Math.round(Number(typed) * 1_000_000);

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
  const id = useId();
  const [read, setRead] = useState<Undeclared | 'failed' | null>(null);
  const [draft, setDraft] = useState<Undeclared>('warn');
  const [limits, setLimits] = useState<Record<Format, string>>({ png: '', jpeg: '' });
  const showLimits = (each: Limits) =>
    setLimits({ png: megabytes(each.png), jpeg: megabytes(each.jpeg) });
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/settings/images')
      .then(({ data }) => {
        if (!current) return;
        setRead(data?.undeclared ?? 'failed');
        if (data) {
          setDraft(data.undeclared);
          showLimits(data.limits);
        }
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
        body: { undeclared: draft, limits: { png: bytesOf(limits.png), jpeg: bytesOf(limits.jpeg) } },
      });
      if (data) {
        setRead(data.undeclared);
        showLimits(data.limits);
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
      <fieldset>
        <legend className={styles['strong']}>{words('admin.the-largest-image')}</legend>
        {FORMATS.map((each) => (
          <div key={each.format} className={styles['setting']}>
            <label htmlFor={`${id}-${each.format}`}>
              {words('admin.largest-format-in-mb', { format: each.name })}
            </label>
            <input
              id={`${id}-${each.format}`}
              type="number"
              min={0.1}
              max={25}
              step={0.1}
              value={limits[each.format]}
              disabled={!mayChange}
              aria-describedby={`${id}-${each.format}-hint`}
              onChange={(event) => setLimits({ ...limits, [each.format]: event.target.value })}
            />
            <span id={`${id}-${each.format}-hint`} className={styles['muted']}>
              {words('admin.blank-for-the-most-the')}
            </span>
          </div>
        ))}
      </fieldset>
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
