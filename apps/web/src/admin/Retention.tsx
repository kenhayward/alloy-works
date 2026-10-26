import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { everyPage } from '../paging.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';
import { words as say } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

type Kind = 'component' | 'document';

/** A keep in force, as the service lists it (lifecycle.md, "Retention"). */
export interface KeepRow {
  readonly kind: Kind | null;
  readonly space: { readonly id: string; readonly name: string } | null;
  readonly days: number;
  readonly by: { readonly id: string; readonly name: string | null };
  readonly at: string;
}

const KINDS: Readonly<Record<Kind, string>> = {
  get component() {
    return say('admin.components');
  },
  get document() {
    return say('admin.documents');
  },
};
const BOTH = (): string => say('admin.components-and-documents');
const MAX_DAYS = 36_500;

const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** What a keep keeps, in words: "components in Clinical", "documents in every space". */
const keptWords = (kind: Kind | null, space: string | null) =>
  say('admin.in-2', {
    value1: (kind === null ? BOTH : KINDS[kind]).toLowerCase(),
    value2: space ?? 'every space',
  });

const sentence = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/**
 * Administration's Retention (the DL plan, DL-G): the keeps in force, each the least time content is
 * kept before it may be deleted, by kind, by space or both, with **Set keep** and **Clear**. Each change
 * is audited by the service.
 */
export function Retention({ client }: { client: Client }) {
  const [load] = useState(() => async () => {
    const { data, response } = await client.GET('/v1/retention');
    return data ? { items: data.keeps } : { status: response.status };
  });
  const [generation, setGeneration] = useState(0);
  const read = useListing<KeepRow>(load, true, generation);
  const [spaces, setSpaces] = useState<readonly { id: string; name: string }[]>([]);
  const [kind, setKind] = useState<Kind | ''>('');
  const [space, setSpace] = useState('');
  const [days, setDays] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    everyPage<{ id: string; name: string }>((cursor) =>
      client.GET('/v1/spaces', {
        params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
      }),
    )
      .then((answer) => {
        if (current && 'items' in answer) setSpaces(answer.items);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  const put = async (body: { kind: Kind | null; space: string | null; days: number | null }) => {
    setBusy(true);
    try {
      const { data, error } = await client.PUT('/v1/retention', { body });
      const words = keptWords(
        body.kind,
        spaces.find((each) => each.id === body.space)?.name ?? null,
      );
      if (data) {
        setSaid(
          body.days === null
            ? say('admin.cleared-the-keep-on', { words })
            : say('admin.are-kept-for-at-least', { value1: sentence(words), days: body.days }),
        );
        setGeneration((count) => count + 1);
      } else setSaid(refusal(error, say('admin.the-keep-could-not-be')));
    } catch {
      setSaid(say('admin.the-keep-could-not-be'));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (kind === '' && space === '') {
      setSaid(say('admin.choose-a-kind-a-space'));
      return;
    }
    const count = Number(days);
    if (!/^\d+$/.test(days.trim()) || count < 1 || count > MAX_DAYS) {
      setSaid(say('admin.give-whole-days-from-1', { MAX_DAYS }));
      return;
    }
    void put({ kind: kind === '' ? null : kind, space: space === '' ? null : space, days: count });
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>{say('admin.a-keep-is-the-least')}</p>
      </div>
      <form
        className={styles['toolbar']}
        onSubmit={submit}
        aria-label={say('admin.set-a-keep')}
        noValidate
      >
        <label className={styles['filter']}>
          {say('admin.kind')}
          <select value={kind} onChange={(change) => setKind(change.target.value as Kind | '')}>
            <option value="">{BOTH()}</option>
            <option value="component">{KINDS.component}</option>
            <option value="document">{KINDS.document}</option>
          </select>
        </label>
        <label className={styles['filter']}>
          {say('admin.space')}
          <select value={space} onChange={(change) => setSpace(change.target.value)}>
            <option value="">{say('admin.every-space')}</option>
            {spaces.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['filter']}>
          {say('admin.days')}
          <input
            type="number"
            min={1}
            max={MAX_DAYS}
            step={1}
            value={days}
            onChange={(change) => setDays(change.target.value)}
          />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {say('admin.set-keep')}
        </button>
      </form>
      <p role="status">{said}</p>
      <Shown read={read} failed={say('admin.the-keeps-could-not-be-loaded')}>
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>{say('admin.no-keep-is-set-anything')}</p>
          ) : (
            <table aria-label={say('admin.retention-keeps')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{say('admin.kind')}</th>
                  <th scope="col">{say('admin.space')}</th>
                  <th scope="col">{say('admin.kept-for-at-least')}</th>
                  <th scope="col">{say('admin.set')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{say('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((keep) => (
                  <tr key={`${keep.kind ?? ''} ${keep.space?.id ?? ''}`}>
                    <td className={styles['strong']}>
                      {keep.kind === null ? BOTH() : KINDS[keep.kind]}
                    </td>
                    <td>{keep.space?.name ?? say('admin.every-space')}</td>
                    <td>{`${keep.days} ${say('admin.days-2', { count: keep.days })}`}</td>
                    <td>
                      {keep.by.name ?? say('admin.somebody')}
                      <br />
                      <span className={styles['muted']}>{when.format(new Date(keep.at))}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={say('admin.clear-the-keep-on', {
                          value1: keptWords(keep.kind, keep.space?.name ?? null),
                        })}
                        onClick={() =>
                          void put({ kind: keep.kind, space: keep.space?.id ?? null, days: null })
                        }
                      >
                        {say('admin.clear')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Shown>
    </>
  );
}
