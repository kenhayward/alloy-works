import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { everyPage } from '../paging.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';

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

const KINDS: Readonly<Record<Kind, string>> = { component: 'Components', document: 'Documents' };
const BOTH = 'Components and documents';
const MAX_DAYS = 36_500;

const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** What a keep keeps, in words: "components in Clinical", "documents in every space". */
const keptWords = (kind: Kind | null, space: string | null) =>
  `${(kind === null ? BOTH : KINDS[kind]).toLowerCase()} in ${space ?? 'every space'}`;

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
            ? `Cleared the keep on ${words}.`
            : `${sentence(words)} are kept for at least ${body.days} days.`,
        );
        setGeneration((count) => count + 1);
      } else setSaid(refusal(error, 'The keep could not be changed.'));
    } catch {
      setSaid('The keep could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (kind === '' && space === '') {
      setSaid('Choose a kind, a space or both.');
      return;
    }
    const count = Number(days);
    if (!/^\d+$/.test(days.trim()) || count < 1 || count > MAX_DAYS) {
      setSaid(`Give whole days, from 1 to ${MAX_DAYS}.`);
      return;
    }
    void put({ kind: kind === '' ? null : kind, space: space === '' ? null : space, days: count });
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>
          A keep is the least time a component or document is kept before it may be deleted, counted
          from its latest version. Every keep that reaches it applies, and the longest wins. A legal
          hold still stands, whatever the keep.
        </p>
      </div>
      <form className={styles['toolbar']} onSubmit={submit} aria-label="Set a keep" noValidate>
        <label className={styles['filter']}>
          Kind
          <select value={kind} onChange={(change) => setKind(change.target.value as Kind | '')}>
            <option value="">{BOTH}</option>
            <option value="component">{KINDS.component}</option>
            <option value="document">{KINDS.document}</option>
          </select>
        </label>
        <label className={styles['filter']}>
          Space
          <select value={space} onChange={(change) => setSpace(change.target.value)}>
            <option value="">Every space</option>
            {spaces.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles['filter']}>
          Days
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
          Set keep
        </button>
      </form>
      <p role="status">{said}</p>
      <Shown read={read} failed="The keeps could not be loaded.">
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>
              No keep is set: anything nothing depends on may be deleted.
            </p>
          ) : (
            <table aria-label="Retention keeps" className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Space</th>
                  <th scope="col">Kept for at least</th>
                  <th scope="col">Set</th>
                  <th scope="col">
                    <span className={styles['hidden']}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((keep) => (
                  <tr key={`${keep.kind ?? ''} ${keep.space?.id ?? ''}`}>
                    <td className={styles['strong']}>
                      {keep.kind === null ? BOTH : KINDS[keep.kind]}
                    </td>
                    <td>{keep.space?.name ?? 'Every space'}</td>
                    <td>{`${keep.days} ${keep.days === 1 ? 'day' : 'days'}`}</td>
                    <td>
                      {keep.by.name ?? 'Somebody'}
                      <br />
                      <span className={styles['muted']}>{when.format(new Date(keep.at))}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Clear the keep on ${keptWords(keep.kind, keep.space?.name ?? null)}`}
                        onClick={() =>
                          void put({ kind: keep.kind, space: keep.space?.id ?? null, days: null })
                        }
                      >
                        Clear
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
