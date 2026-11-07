import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { formats, words, type WordKey } from '../words/words.js';
import styles from './Administration.module.css';
import usage from './Usage.module.css';

type Client = ReturnType<typeof createApiClient>;

/** What `GET /v1/usage` answers (packages/api-contract/src/diagnostics.ts; ADR-0100). */
export interface UsageView {
  readonly from: string;
  readonly to: string;
  readonly measures: readonly {
    readonly measure: string;
    readonly kind: 'count' | 'sample';
    readonly unit: 'count' | 'bytes' | 'ms';
    readonly days: readonly { readonly day: string; readonly amount: number }[];
  }[];
}

type Measure = UsageView['measures'][number];

/** Each measure by the name an administrator reads; one the service adds later shows its own. */
const MEASURE_NAMES: Readonly<Record<string, WordKey>> = {
  databaseBytes: 'admin.usage-measure.databaseBytes',
  publicationBytes: 'admin.usage-measure.publicationBytes',
  assetBytes: 'admin.usage-measure.assetBytes',
  importBytes: 'admin.usage-measure.importBytes',
  exportBytes: 'admin.usage-measure.exportBytes',
  publications: 'admin.usage-measure.publications',
  assets: 'admin.usage-measure.assets',
  mail: 'admin.usage-measure.mail',
  webhooks: 'admin.usage-measure.webhooks',
  translationJobs: 'admin.usage-measure.translationJobs',
  referenceSearches: 'admin.usage-measure.referenceSearches',
  embeddingRuns: 'admin.usage-measure.embeddingRuns',
  queryMs: 'admin.usage-measure.queryMs',
};

const nameOf = (measure: string) => {
  const key = MEASURE_NAMES[measure];
  return key === undefined ? measure : words(key);
};

const BYTE_UNITS = [
  [1e12, 'terabyte'],
  [1e9, 'gigabyte'],
  [1e6, 'megabyte'],
  [1e3, 'kilobyte'],
] as const;

const TIME_UNITS = [
  [3_600_000, 'hour'],
  [60_000, 'minute'],
  [1000, 'second'],
] as const;

/** An amount in its unit, in the reader's language: bytes and time in the largest unit that fits. */
export function amountOf(amount: number, unit: Measure['unit']): string {
  const scaled = (units: readonly (readonly [number, string])[], least: string) => {
    const fit = units.find(([size]) => amount >= size);
    return formats().number(fit ? amount / fit[0] : amount, {
      style: 'unit',
      unit: fit ? fit[1] : least,
      unitDisplay: 'short',
      maximumFractionDigits: 1,
    });
  };
  if (unit === 'bytes') return scaled(BYTE_UNITS, 'byte');
  if (unit === 'ms') return scaled(TIME_UNITS, 'millisecond');
  return formats().number(amount);
}

const monthOf = (day: string) => day.slice(0, 7);

/** The 13 months ending with `to`'s, oldest first. */
function monthsEnding(to: string): string[] {
  const year = Number(to.slice(0, 4));
  const month = Number(to.slice(5, 7)) - 1;
  return Array.from({ length: 13 }, (_, at) => {
    const date = new Date(Date.UTC(year, month - 12 + at, 1));
    return date.toISOString().slice(0, 7);
  });
}

/**
 * A measure's amount in each month: a count summed, a sample as held at the month's last count, and
 * null for a month with none.
 */
function byMonth(measure: Measure, months: readonly string[]): (number | null)[] {
  return months.map((month) => {
    const days = measure.days.filter((each) => monthOf(each.day) === month);
    if (days.length === 0) return measure.kind === 'count' ? 0 : null;
    if (measure.kind === 'sample') return days.at(-1)!.amount;
    return days.reduce((sum, each) => sum + each.amount, 0);
  });
}

const monthName = (month: string) =>
  formats().date(new Date(`${month}-01T00:00:00Z`), {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const dayName = (day: string) =>
  formats().date(new Date(`${day}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });

/** Thirteen bars, each month's share of the largest; read as numbers in the table beside it. */
function Trend({ amounts }: { amounts: readonly (number | null)[] }) {
  const most = Math.max(1, ...amounts.map((each) => each ?? 0));
  const width = 6;
  const gap = 2;
  const height = 20;
  return (
    <svg
      role="img"
      aria-label={words('admin.usage-trend')}
      className={usage['trend']}
      viewBox={`0 0 ${amounts.length * (width + gap) - gap} ${height}`}
      width={amounts.length * (width + gap) - gap}
      height={height}
    >
      {amounts.map((amount, at) => {
        const tall = amount === null ? 0 : Math.max(amount > 0 ? 2 : 1, (amount / most) * height);
        return (
          <rect
            key={at}
            x={at * (width + gap)}
            y={height - tall}
            width={width}
            height={tall}
            data-none={amount === null || undefined}
          />
        );
      })}
    </svg>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles['settings']} aria-labelledby={id}>
      <h3 id={id} className={styles['strong']}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One measure by month or by day, newest first. */
function ByPeriod({ view, months }: { view: UsageView; months: readonly string[] }) {
  const [chosen, setChosen] = useState(view.measures[0]?.measure ?? '');
  const [period, setPeriod] = useState<'month' | 'day'>('month');
  const measure = view.measures.find((each) => each.measure === chosen);
  const name = measure === undefined ? '' : nameOf(measure.measure);
  const shown = (amount: number | null) =>
    amount === null || measure === undefined
      ? words('admin.usage-not-counted')
      : amountOf(amount, measure.unit);
  const rows =
    measure === undefined
      ? []
      : period === 'month'
        ? months
            .map((month, at) => ({
              key: month,
              when: monthName(month),
              amount: byMonth(measure, months)[at] ?? null,
            }))
            .reverse()
        : [...measure.days]
            .reverse()
            .map((each) => ({ key: each.day, when: dayName(each.day), amount: each.amount }));
  return (
    <>
      <div className={styles['toolbar']}>
        <label className={styles['filter']}>
          {words('admin.usage-measure')}
          <select value={chosen} onChange={(change) => setChosen(change.target.value)}>
            {view.measures.map((each) => (
              <option key={each.measure} value={each.measure}>
                {nameOf(each.measure)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className={usage['periods']}>
          <legend className={usage['hidden']}>{words('admin.usage-period')}</legend>
          {(['month', 'day'] as const).map((each) => (
            <label key={each} className={styles['choice']}>
              <input
                type="radio"
                name="usage-period"
                checked={period === each}
                onChange={() => setPeriod(each)}
              />
              {words(each === 'month' ? 'admin.usage-by-month' : 'admin.usage-by-day')}
            </label>
          ))}
        </fieldset>
      </div>
      {measure !== undefined && (
        <table
          aria-label={words(
            period === 'month' ? 'admin.usage-measure-by-month' : 'admin.usage-measure-by-day',
            { name },
          )}
          className={styles['table']}
        >
          <thead>
            <tr>
              <th scope="col">
                {words(period === 'month' ? 'admin.usage-month' : 'admin.usage-day')}
              </th>
              <th scope="col">{name}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2}>{words('admin.usage-no-days')}</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.when}</td>
                  <td>{shown(row.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * Administration's Usage (diagnostics.md; ADR-0100; the DG plan, DGd2): what the environment has used,
 * counted each night, as a trend of 13 months (ADM-033), and any one measure by month or by day.
 */
export function Usage({ client }: { client: Client }) {
  const [view, setView] = useState<UsageView | 'failed' | null>(null);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/usage')
      .then(({ data }) => {
        if (current) setView(data ? (data as UsageView) : 'failed');
      })
      .catch(() => current && setView('failed'));
    return () => {
      current = false;
    };
  }, [client]);

  if (view === null) return <Waiting>{words('admin.loading')}</Waiting>;
  if (view === 'failed') {
    return (
      <Notice tone="failed">
        <p>{words('admin.usage-failed-load')}</p>
      </Notice>
    );
  }
  const months = monthsEnding(view.to);
  const nothing = view.measures.every((each) => each.days.length === 0);
  const shown = (amount: number | null | undefined, unit: Measure['unit']) =>
    amount === null || amount === undefined
      ? words('admin.usage-not-counted')
      : amountOf(amount, unit);
  return (
    <div className={styles['settings']}>
      <p className={styles['muted']}>{words('admin.usage-intro')}</p>
      {nothing ? (
        <p>{words('admin.usage-nothing-yet')}</p>
      ) : (
        <>
          <Part title={words('admin.usage-thirteen-months')}>
            <table aria-label={words('admin.usage-by-month-table')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.usage-measure')}</th>
                  <th scope="col">{words('admin.usage-trend-heading')}</th>
                  <th scope="col">{words('admin.usage-this-month')}</th>
                  <th scope="col">{words('admin.usage-last-month')}</th>
                  <th scope="col">{words('admin.usage-year-before')}</th>
                </tr>
              </thead>
              <tbody>
                {view.measures.map((measure) => {
                  const amounts = byMonth(measure, months);
                  return (
                    <tr key={measure.measure}>
                      <th scope="row" className={usage['name']}>
                        {nameOf(measure.measure)}
                      </th>
                      <td>
                        <Trend amounts={amounts} />
                      </td>
                      <td>{shown(amounts[12], measure.unit)}</td>
                      <td>{shown(amounts[11], measure.unit)}</td>
                      <td>{shown(amounts[0], measure.unit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className={styles['muted']}>{words('admin.usage-bytes-note')}</p>
          </Part>
          <Part title={words('admin.usage-by-period')}>
            <ByPeriod view={view} months={months} />
          </Part>
        </>
      )}
    </div>
  );
}
