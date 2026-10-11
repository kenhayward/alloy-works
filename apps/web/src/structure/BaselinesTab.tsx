import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import styles from './BaselinesTab.module.css';

type Client = ReturnType<typeof createApiClient>;

interface Baseline {
  readonly id: string;
  readonly name: string;
  readonly madeBy: { readonly name: string | null };
  readonly madeAt: string;
  readonly superseded: { readonly by: string } | null;
}

type Show = 'all' | 'current' | 'superseded';

const SHOWN: Record<Show, string> = { all: 'All', current: 'Current', superseded: 'Superseded' };

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** What a refusal says, from the service's own words, or a sentence of ours where it sent none. */
const refusalOf = (error: unknown, fallback: string) =>
  typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : fallback;

/**
 * The document's baselines (baselines.md; the BL plan, Task 2): made of the version the page shows
 * under a name, listed newest first and filtered by state, and one marked superseded by a later one.
 * Somebody who may not publish sees them, and nothing to make or mark.
 */
export function BaselinesTab({
  client,
  document,
  version,
  mayPublish,
}: {
  client: Client;
  document: string;
  version: string;
  mayPublish: boolean;
}) {
  const [show, setShow] = useState<Show>('all');
  const [baselines, setBaselines] = useState<readonly Baseline[] | null | undefined>(undefined);
  // Every baseline, whatever is shown, so a superseding one is named and offered.
  const [every, setEvery] = useState<readonly Baseline[]>([]);
  const [name, setName] = useState('');
  const [said, setSaid] = useState('');
  const [refused, setRefused] = useState('');
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState<string | null>(null);
  const [by, setBy] = useState('');
  const ids = useId();

  const read = useCallback(async () => {
    const asked = (state?: 'current' | 'superseded') =>
      client.GET('/v1/documents/{id}/baselines', {
        params: { path: { id: document }, query: state ? { state } : {} },
      });
    const [shown, all] = await Promise.all([
      asked(show === 'all' ? undefined : show),
      show === 'all' ? null : asked(),
    ]);
    if (!shown.data) return setBaselines(null);
    setBaselines(shown.data.baselines);
    setEvery(all?.data?.baselines ?? shown.data.baselines);
  }, [client, document, show]);

  useEffect(() => {
    void read().catch(() => setBaselines(null));
  }, [read]);

  const make = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setSaid('');
    setRefused('');
    const answer = await client.POST('/v1/documents/{id}/baselines', {
      params: { path: { id: document } },
      body: { version, name },
    });
    setBusy(false);
    if (!answer.data) {
      setRefused(refusalOf(answer.error, 'The baseline could not be made.'));
      return;
    }
    setSaid(`Made ${answer.data.name}.`);
    setName('');
    await read();
  };

  const mark = async (baseline: string) => {
    setRefused('');
    const answer = await client.POST('/v1/baselines/{id}/supersession', {
      params: { path: { id: baseline } },
      body: { by },
    });
    if (!answer.data) {
      setRefused(refusalOf(answer.error, 'It could not be marked superseded.'));
      return;
    }
    setMarking(null);
    await read();
  };

  const nameOf = (id: string) => every.find((each) => each.id === id)?.name ?? 'a later baseline';
  const laterThan = (baseline: Baseline) =>
    every.filter((each) => each.id !== baseline.id && each.madeAt > baseline.madeAt);

  return (
    <div className={styles['tab']}>
      {mayPublish && (
        <form className={styles['make']} onSubmit={(event) => void make(event)}>
          <label htmlFor={`${ids}-name`}>Name</label>
          <input
            id={`${ids}-name`}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" disabled={busy || name.trim() === ''}>
            Make baseline
          </button>
        </form>
      )}
      <p role="status" className={styles['note']}>
        {said}
      </p>
      {refused !== '' && (
        <p role="alert" className={styles['refused']}>
          {refused}
        </p>
      )}
      <div className={styles['controls']}>
        <label htmlFor={`${ids}-show`}>Show</label>
        <select
          id={`${ids}-show`}
          value={show}
          onChange={(event) => setShow(event.target.value as Show)}
        >
          {(Object.keys(SHOWN) as Show[]).map((each) => (
            <option key={each} value={each}>
              {SHOWN[each]}
            </option>
          ))}
        </select>
      </div>
      {baselines === null && <p className={styles['note']}>The baselines could not be read.</p>}
      {baselines?.length === 0 && <p className={styles['note']}>No baseline yet.</p>}
      {baselines !== undefined && baselines !== null && baselines.length > 0 && (
        <ul className={styles['rows']}>
          {baselines.map((baseline) => {
            const later = laterThan(baseline);
            const heading = `${ids}-${baseline.id}`;
            return (
              <li key={baseline.id} className={styles['row']} aria-labelledby={heading}>
                <h3 id={heading} className={styles['name']}>
                  {baseline.name}
                </h3>
                <span className={styles['note']}>
                  {`${baseline.madeBy.name ?? 'Somebody'}, ${when.format(new Date(baseline.madeAt))}`}
                </span>
                <span className={styles['note']}>
                  {baseline.superseded === null
                    ? 'Current'
                    : `Superseded by ${nameOf(baseline.superseded.by)}`}
                </span>
                {mayPublish &&
                  baseline.superseded === null &&
                  later.length > 0 &&
                  (marking === baseline.id ? (
                    <div className={styles['controls']}>
                      <label htmlFor={`${heading}-by`}>Superseded by</label>
                      <select
                        id={`${heading}-by`}
                        value={by}
                        onChange={(event) => setBy(event.target.value)}
                      >
                        {later.map((each) => (
                          <option key={each.id} value={each.id}>
                            {each.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => void mark(baseline.id)}>
                        Mark
                      </button>
                      <button type="button" onClick={() => setMarking(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles['act']}
                      onClick={() => {
                        setMarking(baseline.id);
                        setBy(later[later.length - 1]!.id);
                      }}
                    >
                      Mark superseded
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
