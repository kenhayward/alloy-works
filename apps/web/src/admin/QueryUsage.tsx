import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useMemo, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { words } from '../words/words.js';

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
  return rest === 0 ? words('admin.min', { minutes }) : words('admin.min-s', { minutes, rest });
}

/** Bytes as a person reads them. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return words('admin.kb', { value1: (bytes / 1024).toFixed(1) });
  return words('admin.mb', { value1: (bytes / (1024 * 1024)).toFixed(1) });
}

function UsageTable({ name, totals }: { name: string; totals: readonly Total[] }) {
  if (totals.length === 0)
    return <p className={styles['muted']}>{words('admin.none-in-this-period', { name })}</p>;
  return (
    <table aria-label={name} className={styles['table']}>
      <caption className={styles['strong']}>{name}</caption>
      <thead>
        <tr>
          <th scope="col">
            {name === 'By document' ? words('admin.document') : words('admin.query-definition')}
          </th>
          <th scope="col">{words('admin.runs')}</th>
          <th scope="col">{words('admin.not-answered')}</th>
          <th scope="col">{words('admin.time')}</th>
          <th scope="col">{words('admin.rows')}</th>
          <th scope="col">{words('admin.size')}</th>
        </tr>
      </thead>
      <tbody>
        {totals.map((each) => (
          <tr key={each.id}>
            <td className={styles['strong']}>{each.title ?? words('admin.no-longer-here')}</td>
            <td>{each.runs.toLocaleString()}</td>
            <td>
              {words('admin.failed-throttled', { failed: each.failed, throttled: each.throttled })}
            </td>
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
        setSaid(words('admin.saved'));
      } else setSaid(refusal(error, words('admin.the-limit-could-not-be')));
    } catch {
      setSaid(words('admin.the-limit-could-not-be'));
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
            <span className={styles['strong']}>{words('admin.queries-running-at-once')}</span>
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
              {words('admin.how-many-of-this-environment', {
                concurrentRuns: settings.defaults.concurrentRuns,
                concurrentRuns2: settings.ceilings.concurrentRuns,
              })}
            </span>
          </label>
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
      )}
      <div className={styles['toolbar']}>
        <label className={styles['filter']} htmlFor={periodId}>
          {words('admin.period')}
        </label>
        <select
          id={periodId}
          value={String(days)}
          onChange={(change) => setDays(Number(change.target.value))}
        >
          <option value="7">{words('admin.the-last-7-days')}</option>
          <option value="30">{words('admin.the-last-30-days')}</option>
          <option value="90">{words('admin.the-last-90-days')}</option>
          <option value="395">{words('admin.the-last-13-months')}</option>
        </select>
        <a href={csv}>{words('admin.download-every-run-csv')}</a>
      </div>
      {usage === null && <Waiting>{words('admin.loading')}</Waiting>}
      {usage === 'failed' && (
        <Notice tone="failed">
          <p>{words('admin.what-the-queries-cost-could')}</p>
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
