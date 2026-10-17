import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useMemo, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

const DAY = 86_400_000;

interface Total {
  readonly id: string;
  readonly title: string | null;
  readonly runs: number;
  readonly failed: number;
  readonly throttled: number;
  readonly durationMs: number;
  readonly rows: number;
  readonly bytes: number;
}

interface Usage {
  readonly byQueryDefinition: readonly Total[];
  readonly byDocument: readonly Total[];
}

interface DataSettings {
  readonly rows: number | null;
  readonly bytes: number | null;
  readonly seconds: number | null;
  readonly concurrentRuns: number | null;
  readonly defaults: { readonly concurrentRuns: number };
  readonly ceilings: { readonly concurrentRuns: number };
}

/** A run's time in minutes and seconds, as a person reads it. */
function took(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** Bytes as a person reads them. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UsageTable({ name, totals }: { name: string; totals: readonly Total[] }) {
  if (totals.length === 0)
    return <p className={styles['muted']}>{`${name}: none in this period.`}</p>;
  return (
    <table aria-label={name} className={styles['table']}>
      <caption className={styles['strong']}>{name}</caption>
      <thead>
        <tr>
          <th scope="col">{name === 'By document' ? 'Document' : 'Query definition'}</th>
          <th scope="col">Runs</th>
          <th scope="col">Not answered</th>
          <th scope="col">Time</th>
          <th scope="col">Rows</th>
          <th scope="col">Size</th>
        </tr>
      </thead>
      <tbody>
        {totals.map((each) => (
          <tr key={each.id}>
            <td className={styles['strong']}>{each.title ?? 'No longer here'}</td>
            <td>{each.runs.toLocaleString()}</td>
            <td>{`${each.failed} failed, ${each.throttled} throttled`}</td>
            <td>{took(each.durationMs)}</td>
            <td>{each.rows.toLocaleString()}</td>
            <td>{size(each.bytes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * **Administration's Query usage** (DAT-053, DAT-071; the R18 plan): how many of the environment's
 * query runs may be in flight at once, which an administrator lowers; and what its runs cost over a
 * period, by query definition and by document, with every run to download as CSV.
 */
export function QueryUsage({ client, mayChange }: { client: Client; mayChange: boolean }) {
  const periodId = useId();
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState<Usage | 'failed' | null>(null);
  const [settings, setSettings] = useState<DataSettings | null>(null);
  const [draft, setDraft] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const period = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - days * DAY).toISOString(), to: to.toISOString() };
  }, [days]);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/settings/data')
      .then(({ data }) => {
        if (!current || !data) return;
        setSettings(data as DataSettings);
        setDraft(data.concurrentRuns === null ? '' : String(data.concurrentRuns));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  useEffect(() => {
    let current = true;
    setUsage(null);
    client
      .GET('/v1/data/usage', { params: { query: period } })
      .then(({ data }) => {
        if (current) setUsage(data ? (data as Usage) : 'failed');
      })
      .catch(() => current && setUsage('failed'));
    return () => {
      current = false;
    };
  }, [client, period]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    try {
      // The run limits as they stand, and the runs at once as typed: blank for the default.
      const { data, error } = await client.PUT('/v1/settings/data', {
        body: {
          rows: settings.rows,
          bytes: settings.bytes,
          seconds: settings.seconds,
          concurrentRuns: draft.trim() === '' ? null : Number(draft),
        },
      });
      if (data) {
        setSettings(data as DataSettings);
        setSaid('Saved.');
      } else setSaid(refusal(error, 'The limit could not be saved.'));
    } catch {
      setSaid('The limit could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  // From the period's start to now, whenever it is followed (the final review).
  const csv = `/v1/data/usage/runs.csv?from=${encodeURIComponent(period.from)}`;
  return (
    <div className={styles['settings']}>
      {settings !== null && (
        <form className={styles['settings']} onSubmit={(event) => void save(event)}>
          <label className={styles['setting']}>
            <span className={styles['strong']}>Queries running at once</span>
            <input
              type="number"
              min={1}
              max={settings.ceilings.concurrentRuns}
              step={1}
              placeholder={String(settings.defaults.concurrentRuns)}
              disabled={!mayChange}
              value={draft}
              onChange={(change) => setDraft(change.target.value)}
            />
            <span className={styles['muted']}>
              {`How many of this environment's queries may run at the same time, across documents, checks and samples: ${settings.defaults.concurrentRuns} unless lowered, at most ${settings.ceilings.concurrentRuns}. One more waits a few seconds, then is refused, to be tried again.`}
            </span>
          </label>
          <p role="status">{said}</p>
          {mayChange ? (
            <div>
              <button type="submit" className="primary" disabled={busy}>
                Save
              </button>
            </div>
          ) : (
            <p className={styles['muted']}>
              Only an administrator of the environment may change this.
            </p>
          )}
        </form>
      )}
      <div className={styles['toolbar']}>
        <label className={styles['filter']} htmlFor={periodId}>
          Period
        </label>
        <select
          id={periodId}
          value={String(days)}
          onChange={(change) => setDays(Number(change.target.value))}
        >
          <option value="7">The last 7 days</option>
          <option value="30">The last 30 days</option>
          <option value="90">The last 90 days</option>
          <option value="395">The last 13 months</option>
        </select>
        <a href={csv}>Download every run (CSV)</a>
      </div>
      {usage === null && <Waiting>Loading...</Waiting>}
      {usage === 'failed' && (
        <Notice tone="failed">
          <p>What the queries cost could not be read.</p>
        </Notice>
      )}
      {usage !== null && usage !== 'failed' && (
        <>
          <UsageTable name="By query definition" totals={usage.byQueryDefinition} />
          <UsageTable name="By document" totals={usage.byDocument} />
        </>
      )}
    </div>
  );
}
