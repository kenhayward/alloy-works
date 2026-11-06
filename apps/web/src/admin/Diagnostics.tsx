import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { Icon } from '../editor/Icon.js';
import { Chip, type ChipTone } from '../parts/Chip.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { formats, words, type WordKey } from '../words/words.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

/** What `GET /v1/diagnostics` answers (packages/api-contract/src/diagnostics.ts). */
export interface DiagnosticsView {
  readonly at: string;
  readonly capabilities: readonly {
    readonly capability: string;
    readonly health: 'healthy' | 'degraded' | 'failing' | 'idle';
    readonly requests: number;
    readonly errorRate: number | null;
    readonly p95Ms: number | null;
  }[];
  readonly work: readonly {
    readonly work: string;
    readonly health: 'healthy' | 'failing' | 'paused';
    readonly outcome: 'succeeded' | 'failed' | 'paused';
    readonly lastStartedAt: string;
    readonly lastFinishedAt: string;
    readonly nextDueAt: string | null;
    readonly failure: string | null;
    readonly failedAt: string | null;
    readonly failures: number;
  }[];
  readonly jobs: readonly {
    readonly kind: string;
    readonly capability: string;
    readonly state: 'waiting' | 'running' | 'done' | 'failed';
    readonly jobs: number;
    readonly firstAt: string;
    readonly lastAt: string;
    readonly lastError: string | null;
  }[];
  readonly index: {
    readonly serving: string | null;
    readonly pending: {
      readonly model: string;
      readonly missing: number;
      readonly confirmed: boolean;
    } | null;
    readonly p95LagSeconds: number | null;
    readonly maxLagSeconds: number | null;
  };
  readonly webhooks: {
    readonly subscriptions: number;
    readonly failing: number;
    readonly disabledFailing: number;
  };
  readonly mail: {
    readonly enabled: boolean;
    readonly failingSince: string | null;
    readonly waiting: number;
    readonly givenUp: number;
  };
  readonly connections: readonly {
    readonly connection: string;
    readonly name: string | null;
    readonly runs: number;
    readonly failed: number;
    readonly timedOut: number;
    readonly lastRunAt: string;
    readonly down: boolean;
    readonly lastFailure: string | null;
  }[];
  readonly budgets: {
    readonly model: {
      readonly currency: string;
      readonly spentMicros: string;
      readonly limitMicros: string;
    } | null;
    readonly queryRunsAtOnce: number;
  };
}

type Health = 'healthy' | 'degraded' | 'failing' | 'idle' | 'paused';

/** Each health in icon, words and tone together: never colour alone (diagnostics.md, pre-flight 14). */
const SHOWN: Record<Health, { readonly icon: string; readonly tone: ChipTone }> = {
  healthy: { icon: 'Confirmed', tone: 'ok' },
  degraded: { icon: 'Needs attention', tone: 'warn' },
  failing: { icon: 'Close', tone: 'danger' },
  idle: { icon: 'Minus', tone: 'neutral' },
  paused: { icon: 'Minus', tone: 'neutral' },
};

function HealthChip({ health }: { health: Health }) {
  const { icon, tone } = SHOWN[health];
  return (
    <Chip tone={tone}>
      <Icon name={icon} size={12} /> {words(`admin.diag-${health}`)}
    </Chip>
  );
}

/** The work's name as an administrator reads it; one the page does not know, by its own name. */
const WORK_NAMES: Readonly<Record<string, WordKey>> = {
  deliverWebhooks: 'admin.diag-work.deliverWebhooks',
  foldNotificationDigests: 'admin.diag-work.foldNotificationDigests',
  recheckEntries: 'admin.diag-work.recheckEntries',
  sendMail: 'admin.diag-work.sendMail',
  sweepAbandonedGenerationRuns: 'admin.diag-work.sweepAbandonedGenerationRuns',
  sweepClosures: 'admin.diag-work.sweepClosures',
  sweepDates: 'admin.diag-work.sweepDates',
  sweepEmbeddingLagEverywhere: 'admin.diag-work.sweepEmbeddingLagEverywhere',
  sweepExpiredIterations: 'admin.diag-work.sweepExpiredIterations',
  sweepExpiredPreviews: 'admin.diag-work.sweepExpiredPreviews',
  sweepExpiredQueryRuns: 'admin.diag-work.sweepExpiredQueryRuns',
  sweepExpiredRangePreviews: 'admin.diag-work.sweepExpiredRangePreviews',
  sweepExpiredSignIns: 'admin.diag-work.sweepExpiredSignIns',
  sweepExpiredTenantExports: 'admin.diag-work.sweepExpiredTenantExports',
  sweepImportsEverywhere: 'admin.diag-work.sweepImportsEverywhere',
  sweepMailEverywhere: 'admin.diag-work.sweepMailEverywhere',
  sweepMeasurementsEverywhere: 'admin.diag-work.sweepMeasurementsEverywhere',
  sweepOldNotifications: 'admin.diag-work.sweepOldNotifications',
  sweepQueryEmbeddingsEverywhere: 'admin.diag-work.sweepQueryEmbeddingsEverywhere',
  sweepRestorations: 'admin.diag-work.sweepRestorations',
  sweepStalePresence: 'admin.diag-work.sweepStalePresence',
  sweepUncheckedPublications: 'admin.diag-work.sweepUncheckedPublications',
  sweepWebhookDeliveriesEverywhere: 'admin.diag-work.sweepWebhookDeliveriesEverywhere',
};
const workName = (work: string) => {
  const key = WORK_NAMES[work];
  return key === undefined ? work : words(key);
};

const when = (at: string) =>
  `${formats().date(new Date(at), { day: 'numeric', month: 'short' })} ${formats().time(new Date(at))}`;

const money = (micros: string, currency: string) =>
  formats().number(Number(micros) / 1_000_000, { style: 'currency', currency });

/**
 * What failed with nobody told (ADM-037, ADM-021, COL-061; the DG plan, pre-flight 7), each in a
 * sentence: a capability failing or degraded, background work failing, jobs that failed, webhooks and
 * mail not delivering, a data source down. Most pressing kinds first.
 */
export function needsAttention(view: DiagnosticsView): string[] {
  const said: string[] = [];
  for (const each of view.capabilities) {
    if (each.health === 'failing' || each.health === 'degraded') {
      said.push(
        words(`admin.diag-capability-${each.health}`, {
          capability: each.capability,
          rate: each.errorRate ?? 0,
        }),
      );
    }
  }
  for (const each of view.work) {
    if (each.health !== 'failing') continue;
    said.push(
      each.outcome === 'failed'
        ? words('admin.diag-work-failed', {
            work: workName(each.work),
            failures: each.failures,
            failure: each.failure ?? '',
          })
        : words('admin.diag-work-late', { work: workName(each.work) }),
    );
  }
  for (const each of view.jobs) {
    if (each.state !== 'failed') continue;
    said.push(
      words('admin.diag-jobs-failed', {
        jobs: each.jobs,
        capability: each.capability,
        code: each.lastError ?? '',
      }),
    );
  }
  if (view.webhooks.failing > 0) {
    said.push(words('admin.diag-webhooks-failing', { failing: view.webhooks.failing }));
  }
  if (view.webhooks.disabledFailing > 0) {
    said.push(words('admin.diag-webhooks-off', { off: view.webhooks.disabledFailing }));
  }
  if (view.mail.enabled && view.mail.failingSince !== null) {
    said.push(words('admin.diag-mail-failing', { since: when(view.mail.failingSince) }));
  }
  for (const each of view.connections) {
    if (!each.down) continue;
    said.push(
      words('admin.diag-source-down', {
        name: each.name ?? words('admin.diag-source-gone'),
        failure: each.lastFailure ?? '',
      }),
    );
  }
  return said;
}

/** A titled part of the page, found by its heading. */
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

function HealthTable({ view }: { view: DiagnosticsView }) {
  if (view.capabilities.length === 0) {
    return <p className={styles['muted']}>{words('admin.diag-nothing-asked')}</p>;
  }
  const name = words('admin.diag-health');
  return (
    <table aria-label={name} className={styles['table']}>
      <thead>
        <tr>
          <th scope="col">{words('admin.diag-capability')}</th>
          <th scope="col">{words('admin.diag-state')}</th>
          <th scope="col">{words('admin.diag-requests')}</th>
          <th scope="col">{words('admin.diag-errors')}</th>
          <th scope="col">{words('admin.diag-p95')}</th>
        </tr>
      </thead>
      <tbody>
        {view.capabilities.map((each) => (
          <tr key={each.capability}>
            <td className={styles['strong']}>{each.capability}</td>
            <td>
              <HealthChip health={each.health} />
            </td>
            <td>{formats().number(each.requests)}</td>
            <td>
              {each.errorRate === null
                ? words('admin.diag-none')
                : words('admin.diag-rate', { rate: each.errorRate })}
            </td>
            <td>
              {each.p95Ms === null
                ? words('admin.diag-none')
                : words('admin.diag-ms', { ms: each.p95Ms })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WorkTable({ view }: { view: DiagnosticsView }) {
  if (view.work.length === 0)
    return <p className={styles['muted']}>{words('admin.diag-no-work')}</p>;
  const name = words('admin.diag-work');
  return (
    <table aria-label={name} className={styles['table']}>
      <thead>
        <tr>
          <th scope="col">{words('admin.diag-work-name')}</th>
          <th scope="col">{words('admin.diag-state')}</th>
          <th scope="col">{words('admin.diag-last-run')}</th>
          <th scope="col">{words('admin.diag-next-due')}</th>
          <th scope="col">{words('admin.diag-last-failure')}</th>
        </tr>
      </thead>
      <tbody>
        {view.work.map((each) => (
          <tr key={each.work}>
            <td className={styles['strong']}>{workName(each.work)}</td>
            <td>
              <HealthChip health={each.health} />
            </td>
            <td>{when(each.lastStartedAt)}</td>
            <td>{each.nextDueAt === null ? words('admin.diag-none') : when(each.nextDueAt)}</td>
            <td>
              {each.failure === null || each.failedAt === null
                ? words('admin.diag-none')
                : `${each.failure}, ${when(each.failedAt)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STATES = ['waiting', 'running', 'done', 'failed'] as const;

function JobsTable({ view }: { view: DiagnosticsView }) {
  if (view.jobs.length === 0)
    return <p className={styles['muted']}>{words('admin.diag-no-jobs')}</p>;
  const kinds = [...new Set(view.jobs.map((each) => each.capability))].sort(formats().compare);
  const name = words('admin.diag-jobs');
  return (
    <table aria-label={name} className={styles['table']}>
      <thead>
        <tr>
          <th scope="col">{words('admin.diag-kind')}</th>
          {STATES.map((state) => (
            <th key={state} scope="col">
              {words(`admin.diag-${state}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {kinds.map((kind) => (
          <tr key={kind}>
            <td className={styles['strong']}>{kind}</td>
            {STATES.map((state) => (
              <td key={state}>
                {formats().number(
                  view.jobs
                    .filter((each) => each.capability === kind && each.state === state)
                    .reduce((sum, each) => sum + each.jobs, 0),
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourcesTable({ view }: { view: DiagnosticsView }) {
  if (view.connections.length === 0) {
    return <p className={styles['muted']}>{words('admin.diag-no-sources')}</p>;
  }
  const name = words('admin.diag-sources');
  return (
    <table aria-label={name} className={styles['table']}>
      <thead>
        <tr>
          <th scope="col">{words('admin.diag-source')}</th>
          <th scope="col">{words('admin.diag-state')}</th>
          <th scope="col">{words('admin.diag-runs')}</th>
          <th scope="col">{words('admin.diag-failed')}</th>
          <th scope="col">{words('admin.diag-timed-out')}</th>
        </tr>
      </thead>
      <tbody>
        {view.connections.map((each) => (
          <tr key={each.connection}>
            <td
              className={styles['strong']}
              {...(each.name === null ? {} : { 'data-content': '' })}
            >
              {each.name ?? words('admin.diag-source-gone')}
            </td>
            <td>
              <Chip tone={each.down ? 'danger' : 'ok'}>
                <Icon name={each.down ? 'Close' : 'Confirmed'} size={12} />{' '}
                {words(each.down ? 'admin.diag-down' : 'admin.diag-answering')}
              </Chip>
            </td>
            <td>{formats().number(each.runs)}</td>
            <td>{formats().number(each.failed)}</td>
            <td>{formats().number(each.timedOut)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * **Administration's Diagnostics** (ADM-036; diagnostics.md; the DG plan, DG-H): what failed silently
 * first, then health by capability, the search index, deliveries, background work, jobs, data sources
 * and budgets, as `GET /v1/diagnostics` answers them. Read once as the page opens.
 */
export function Diagnostics({ client }: { client: Client }) {
  const [view, setView] = useState<DiagnosticsView | 'failed' | null>(null);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/diagnostics')
      .then(({ data }) => {
        if (current) setView(data ? (data as DiagnosticsView) : 'failed');
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
        <p>{words('admin.diag-failed-load')}</p>
      </Notice>
    );
  }
  const attention = needsAttention(view);
  const { index, webhooks, mail, budgets } = view;
  return (
    <div className={styles['settings']}>
      <p className={styles['muted']}>{words('admin.diag-intro')}</p>
      <Part title={words('admin.diag-attention')}>
        {attention.length === 0 ? (
          <p>{words('admin.diag-nothing-failed')}</p>
        ) : (
          <ul>
            {attention.map((said) => (
              <li key={said}>{said}</li>
            ))}
          </ul>
        )}
      </Part>
      <Part title={words('admin.diag-health')}>
        <p className={styles['muted']}>{words('admin.diag-health-note')}</p>
        <HealthTable view={view} />
      </Part>
      <Part title={words('admin.diag-index')}>
        <p>
          {index.serving === null
            ? words('admin.diag-index-none')
            : words('admin.diag-index-serving', { model: index.serving })}
        </p>
        {index.pending !== null && (
          <p>
            {words('admin.diag-index-pending', {
              model: index.pending.model,
              missing: index.pending.missing,
            })}
          </p>
        )}
        {index.p95LagSeconds !== null && (
          <p>{words('admin.diag-index-lag', { seconds: index.p95LagSeconds })}</p>
        )}
      </Part>
      <Part title={words('admin.diag-deliveries')}>
        <p>
          {webhooks.subscriptions === 0
            ? words('admin.diag-no-webhooks')
            : words('admin.diag-webhooks', {
                failing: webhooks.failing,
                subscriptions: webhooks.subscriptions,
                off: webhooks.disabledFailing,
              })}
        </p>
        <p>
          {!mail.enabled
            ? words('admin.diag-mail-off')
            : mail.failingSince === null
              ? words('admin.diag-mail-on', { waiting: mail.waiting, givenUp: mail.givenUp })
              : words('admin.diag-mail-failing-short', {
                  since: when(mail.failingSince),
                  waiting: mail.waiting,
                  givenUp: mail.givenUp,
                })}
        </p>
      </Part>
      <Part title={words('admin.diag-work')}>
        <WorkTable view={view} />
      </Part>
      <Part title={words('admin.diag-jobs')}>
        <JobsTable view={view} />
      </Part>
      <Part title={words('admin.diag-sources')}>
        <SourcesTable view={view} />
      </Part>
      <Part title={words('admin.diag-budgets')}>
        <p>
          {budgets.model === null
            ? words('admin.diag-model-none')
            : words('admin.diag-model-spend', {
                spent: money(budgets.model.spentMicros, budgets.model.currency),
                limit: money(budgets.model.limitMicros, budgets.model.currency),
                rate: Number(budgets.model.spentMicros) / Number(budgets.model.limitMicros),
              })}
        </p>
        <p>{words('admin.diag-runs-at-once', { runs: budgets.queryRunsAtOnce })}</p>
      </Part>
    </div>
  );
}
