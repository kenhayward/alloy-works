import type { createApiClient } from '@alloy-works/api-client';
import { indexLagging } from '@alloy-works/domain';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { Icon } from '../editor/Icon.js';
import { Chip, type ChipTone } from '../parts/Chip.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { formats, words, type WordKey } from '../words/words.js';
import styles from './Administration.module.css';
import diagnostics from './Diagnostics.module.css';
import { amountOf } from './Usage.js';

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
    /** How long the oldest version waiting to be findable by meaning has waited (DGe4). */
    readonly waitingSeconds?: number | null;
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
  readonly objectives: {
    readonly availability: {
      readonly objective: number;
      readonly since: string;
      readonly measured: number | null;
      readonly verdict: ObjectiveVerdict;
    };
    readonly recoveryPoint: {
      readonly objectiveHours: number;
      readonly hours: number | null;
      readonly verdict: ObjectiveVerdict;
    };
    readonly recoveryTime: {
      readonly objectiveHours: number;
      readonly hours: number | null;
      readonly drilledAt: string | null;
      readonly verdict: ObjectiveVerdict;
    };
    readonly backups: readonly {
      readonly class: 'databases' | 'objects';
      readonly act: 'backup' | 'drill';
      readonly lastStartedAt: string;
      readonly lastSeconds: number;
      readonly lastOutcome: 'succeeded' | 'failed';
      readonly succeededAt: string | null;
    }[];
  };
  readonly performance: readonly {
    readonly budget: string;
    readonly requirement: string;
    readonly owner: string;
    readonly reference: string;
    readonly percentile: number | null;
    readonly withinMs: number | null;
    readonly neverAboveMs: number | null;
    readonly provisional: boolean;
    readonly confirmedBy: string;
    readonly measuredAs: 'request' | 'job' | 'lag' | 'immediate' | 'unmeasured';
    readonly capability: string | null;
    readonly verdict: Verdict;
    readonly atMs: number | null;
    readonly largestMs: number | null;
    readonly why: string | null;
  }[];
  readonly budgets: {
    readonly model: {
      readonly currency: string;
      readonly spentMicros: string;
      readonly limitMicros: string;
    } | null;
    readonly queryRunsAtOnce: number;
  };
  readonly integrity: {
    readonly periodDays: number;
    readonly classes: readonly {
      readonly class: IntegrityClass;
      readonly items: number;
      readonly checkedInPeriod: number;
      readonly failing: number;
      readonly lastFailure: {
        readonly item: string;
        readonly failure: string;
        readonly at: string;
      } | null;
    }[];
  };
}

type IntegrityClass = 'asset' | 'version' | 'audit_export' | 'tenant_export';

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
  sweepUsageEverywhere: 'admin.diag-work.sweepUsageEverywhere',
  sweepIntegrityEverywhere: 'admin.diag-work.sweepIntegrityEverywhere',
  sweepSilentFailuresEverywhere: 'admin.diag-work.sweepSilentFailuresEverywhere',
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

type Verdict = 'met' | 'missed' | 'nothing' | 'immediate' | 'unmeasured';

/** Each verdict in icon, words and tone together. */
const VERDICTS: Record<Verdict, { readonly icon: string; readonly tone: ChipTone }> = {
  met: { icon: 'Confirmed', tone: 'ok' },
  missed: { icon: 'Needs attention', tone: 'warn' },
  nothing: { icon: 'Minus', tone: 'neutral' },
  immediate: { icon: 'Confirmed', tone: 'ok' },
  unmeasured: { icon: 'Minus', tone: 'neutral' },
};

/** What each budget times, as an administrator reads it; one the page does not know, by its name. */
const BUDGET_NAMES: Readonly<Record<string, WordKey>> = {
  'API-036': 'admin.perf.API-036',
  'CNT-180-open': 'admin.perf.CNT-180-open',
  'CNT-180-jump': 'admin.perf.CNT-180-jump',
  'CNT-186': 'admin.perf.CNT-186',
  'PUB-102': 'admin.perf.PUB-102',
  'REL-031': 'admin.perf.REL-031',
  'REU-049': 'admin.perf.REU-049',
  'SCH-033': 'admin.perf.SCH-033',
  'SCH-036': 'admin.perf.SCH-036',
  'SCH-066': 'admin.perf.SCH-066',
  'SCH-067': 'admin.perf.SCH-067',
  'STR-063': 'admin.perf.STR-063',
  'STR-073': 'admin.perf.STR-073',
  'VER-051': 'admin.perf.VER-051',
};

/** Why a budget is met as built or not measured, in the reader's language where the page knows it. */
const BUDGET_WHY: Readonly<Record<string, WordKey>> = {
  'API-036': 'admin.perf-why.API-036',
  'CNT-180-open': 'admin.perf-why.client',
  'CNT-180-jump': 'admin.perf-why.client',
  'REU-049': 'admin.perf-why.REU-049',
  'SCH-036': 'admin.perf-why.SCH-036',
  'SCH-066': 'admin.perf-why.SCH-066',
  'STR-073': 'admin.perf-why.client',
  'VER-051': 'admin.perf-why.VER-051',
};

const duration = (ms: number) => amountOf(ms, 'ms');

type ObjectiveVerdict = 'met' | 'missed' | 'unrecorded' | 'unrehearsed';

const OBJECTIVE_VERDICTS: Record<
  ObjectiveVerdict,
  { readonly icon: string; readonly tone: ChipTone; readonly word: WordKey }
> = {
  met: { icon: 'Confirmed', tone: 'ok', word: 'admin.obj-verdict.met' },
  missed: { icon: 'Needs attention', tone: 'warn', word: 'admin.obj-verdict.missed' },
  unrecorded: { icon: 'Minus', tone: 'neutral', word: 'admin.obj-verdict.unrecorded' },
  unrehearsed: { icon: 'Needs attention', tone: 'warn', word: 'admin.obj-verdict.unrehearsed' },
};

const percent = (fraction: number) =>
  formats().number(fraction, { style: 'percent', maximumFractionDigits: 2 });
const hours = (count: number) => duration(count * 3_600_000);

function ObjectiveRow({
  name,
  promised,
  measured,
  verdict,
}: {
  name: string;
  promised: string;
  measured: string;
  verdict: ObjectiveVerdict;
}) {
  const { icon, tone, word } = OBJECTIVE_VERDICTS[verdict];
  return (
    <tr>
      <td className={styles['strong']}>{name}</td>
      <td className={styles['wraps']}>{promised}</td>
      <td className={styles['wraps']}>{measured}</td>
      <td className={styles['wraps']}>
        <Chip tone={tone}>
          <Icon name={icon} size={12} /> {words(word)}
        </Chip>
      </td>
    </tr>
  );
}

/** Availability, recovery point and recovery time against the operator's objectives (ADM-020). */
function ObjectivesTable({ view }: { view: DiagnosticsView }) {
  const { availability, recoveryPoint, recoveryTime, backups } = view.objectives;
  const unrecorded = words('admin.obj-unrecorded');
  return (
    <>
      <table aria-label={words('admin.diag-objectives')} className={styles['table']}>
        <thead>
          <tr>
            <th scope="col">{words('admin.obj-objective')}</th>
            <th scope="col">{words('admin.obj-promised')}</th>
            <th scope="col">{words('admin.perf-measured')}</th>
            <th scope="col">{words('admin.perf-state')}</th>
          </tr>
        </thead>
        <tbody>
          <ObjectiveRow
            name={words('admin.obj-availability')}
            promised={words('admin.obj-availability-promised', {
              percent: percent(availability.objective),
            })}
            measured={
              availability.measured === null
                ? words('admin.obj-not-probed')
                : words('admin.obj-availability-measured', {
                    percent: percent(availability.measured),
                    since: when(availability.since),
                  })
            }
            verdict={availability.verdict}
          />
          <ObjectiveRow
            name={words('admin.obj-recovery-point')}
            promised={words('admin.obj-within', { hours: hours(recoveryPoint.objectiveHours) })}
            measured={
              recoveryPoint.verdict === 'unrecorded'
                ? unrecorded
                : recoveryPoint.hours === null
                  ? words('admin.obj-no-good-backup')
                  : words('admin.obj-backup-age', { hours: hours(recoveryPoint.hours) })
            }
            verdict={recoveryPoint.verdict}
          />
          <ObjectiveRow
            name={words('admin.obj-recovery-time')}
            promised={words('admin.obj-within', { hours: hours(recoveryTime.objectiveHours) })}
            measured={
              recoveryTime.verdict === 'unrecorded'
                ? unrecorded
                : recoveryTime.hours === null || recoveryTime.drilledAt === null
                  ? words('admin.obj-not-drilled')
                  : words('admin.obj-drilled', {
                      hours: hours(recoveryTime.hours),
                      at: when(recoveryTime.drilledAt),
                    })
            }
            verdict={recoveryTime.verdict}
          />
        </tbody>
      </table>
      {backups.length === 0 && (
        <p className={styles['muted']}>{words('admin.obj-backups-elsewhere')}</p>
      )}
    </>
  );
}

type Reading = DiagnosticsView['performance'][number];

function heldTo(budget: Reading): string {
  if (budget.withinMs === null) return words('admin.perf-no-time');
  const within = duration(budget.withinMs);
  if (budget.percentile === null) return words('admin.perf-within', { within });
  return budget.neverAboveMs === null
    ? words('admin.perf-held', { percent: budget.percentile, within })
    : words('admin.perf-held-ceiling', {
        percent: budget.percentile,
        within,
        above: duration(budget.neverAboveMs),
      });
}

function measuredAt(budget: Reading): string {
  if (budget.atMs === null) return words('admin.diag-none');
  const percent = budget.percentile ?? 0.95;
  return budget.largestMs === null
    ? words('admin.perf-at-past', { percent, at: duration(budget.atMs) })
    : words('admin.perf-at', {
        percent,
        at: duration(budget.atMs),
        largest: duration(budget.largestMs),
      });
}

function PerformanceTable({ view }: { view: DiagnosticsView }) {
  const name = words('admin.diag-performance');
  return (
    <table aria-label={name} className={`${styles['table']} ${diagnostics['budgets']}`}>
      <thead>
        <tr>
          <th scope="col">{words('admin.perf-budget')}</th>
          <th scope="col">{words('admin.perf-times')}</th>
          <th scope="col">{words('admin.perf-held-heading')}</th>
          <th scope="col">{words('admin.perf-measured')}</th>
          <th scope="col">{words('admin.perf-state')}</th>
        </tr>
      </thead>
      <tbody>
        {view.performance.map((each) => {
          const { icon, tone } = VERDICTS[each.verdict];
          const named = BUDGET_NAMES[each.budget];
          const why = BUDGET_WHY[each.budget];
          return (
            <tr key={each.budget}>
              <td className={styles['strong']}>{each.requirement}</td>
              <td className={styles['wraps']}>
                {named === undefined ? each.budget : words(named)}
              </td>
              <td className={styles['wraps']}>
                {heldTo(each)}
                {each.provisional && (
                  <span className={styles['muted']}> {words('admin.perf-provisional')}</span>
                )}
              </td>
              <td className={styles['wraps']}>{measuredAt(each)}</td>
              <td className={styles['wraps']}>
                <Chip tone={tone}>
                  <Icon name={icon} size={12} /> {words(`admin.perf-verdict.${each.verdict}`)}
                </Chip>
                {(why !== undefined || each.why !== null) && (
                  <p className={styles['muted']}>{why === undefined ? each.why : words(why)}</p>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

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
  if (indexLagging(view.index.waitingSeconds ?? null)) said.push(words('admin.diag-index-lagging'));
  for (const each of view.integrity.classes) {
    if (each.failing === 0) continue;
    said.push(
      words('admin.diag-integrity-failed', {
        name: words(`admin.diag-integrity.${each.class}`),
        failing: each.failing,
        failure: each.lastFailure?.failure ?? '',
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

/** Each class of stored item, as its re-verification last found it (ADM-044; the DG plan, DG-K). */
function IntegrityTable({ view }: { view: DiagnosticsView }) {
  const name = words('admin.diag-integrity');
  return (
    <table aria-label={name} className={styles['table']}>
      <thead>
        <tr>
          <th scope="col">{words('admin.diag-integrity-class')}</th>
          <th scope="col">{words('admin.diag-integrity-items')}</th>
          <th scope="col">
            {words('admin.diag-integrity-checked', { days: view.integrity.periodDays })}
          </th>
          <th scope="col">{words('admin.diag-integrity-failing')}</th>
          <th scope="col">{words('admin.diag-state')}</th>
        </tr>
      </thead>
      <tbody>
        {view.integrity.classes.map((each) => {
          const state = each.failing > 0 ? 'failing' : each.items === 0 ? 'empty' : 'intact';
          const { icon, tone } = INTEGRITY_SHOWN[state];
          return (
            <tr key={each.class}>
              <td className={`${styles['strong']} ${styles['wraps']}`}>
                {words(`admin.diag-integrity.${each.class}`)}
              </td>
              <td>{formats().number(each.items)}</td>
              <td>{formats().number(each.checkedInPeriod)}</td>
              <td>{formats().number(each.failing)}</td>
              <td className={styles['wraps']}>
                <Chip tone={tone}>
                  <Icon name={icon} size={12} /> {words(`admin.diag-integrity-${state}`)}
                </Chip>
                {each.lastFailure !== null && (
                  <p className={styles['muted']}>
                    {`${each.lastFailure.failure}, ${when(each.lastFailure.at)}`}
                  </p>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Each class's state in icon, words and tone together. */
const INTEGRITY_SHOWN = {
  intact: { icon: 'Confirmed', tone: 'ok' },
  failing: { icon: 'Close', tone: 'danger' },
  empty: { icon: 'Minus', tone: 'neutral' },
} as const satisfies Record<string, { readonly icon: string; readonly tone: ChipTone }>;

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
      <Part title={words('admin.diag-objectives')}>
        <ObjectivesTable view={view} />
      </Part>
      <Part title={words('admin.diag-performance')}>
        <p className={styles['muted']}>{words('admin.diag-performance-note')}</p>
        <PerformanceTable view={view} />
      </Part>
      <Part title={words('admin.diag-integrity')}>
        <p className={styles['muted']}>
          {words('admin.diag-integrity-note', { days: view.integrity.periodDays })}
        </p>
        <IntegrityTable view={view} />
      </Part>
    </div>
  );
}
