import type { DiagnosticsView, UsageQuery, UsageView } from '@alloy-works/api-contract';
import {
  backgroundWork,
  backupRecord,
  capabilityTotals,
  capabilityUsage,
  connectionRunsSince,
  dataPolicy,
  embeddingFreshness,
  embeddingStatus,
  mailChannel,
  mailCounts,
  ownJobs,
  readBudget,
  serviceAvailability,
  spendThisMonth,
  usageDays,
  webhookCounts,
  type CapabilityUsage,
} from '@alloy-works/db';
import {
  addBuckets,
  budgetVerdict,
  capabilityHealth,
  emptyBuckets,
  HEALTH_WINDOW_MS,
  JOB_CAPABILITIES,
  objectiveReadings,
  type Objectives,
  PERFORMANCE_BUDGETS,
  runsAtOnce,
  USAGE_KEPT_DAYS,
  USAGE_MEASURES,
  workHealth,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';
import { AppError } from './errors.js';

const DAY = 86_400_000;
const iso = (date: Date | null) => (date === null ? null : date.toISOString());

/** A capability's request budget: the tightest a registered budget holds it to (DG-F). */
const budgetOf = (capability: string) => {
  const held = PERFORMANCE_BUDGETS.flatMap((each) =>
    each.production.kind === 'request' &&
    each.production.capability === capability &&
    each.withinMs !== null
      ? [each.withinMs]
      : [],
  );
  return held.length === 0 ? undefined : Math.min(...held);
};

const finite = (ms: number | undefined) => (ms === undefined || !Number.isFinite(ms) ? null : ms);

/** Each registered budget against the last 7 days of production (DG-J). */
function performance(
  totals: readonly { capability: string; buckets: readonly number[] }[],
  lag: { p95Seconds: number | null; maxSeconds: number | null },
): DiagnosticsView['performance'] {
  return PERFORMANCE_BUDGETS.map((budget) => {
    const { production } = budget;
    const capability =
      production.kind === 'request' || production.kind === 'job' ? production.capability : null;
    const reading = budgetVerdict(budget, {
      buckets: totals.find((each) => each.capability === capability)?.buckets ?? [],
      lag,
    });
    return {
      budget: budget.id,
      requirement: budget.requirement,
      owner: budget.owner,
      reference: budget.reference,
      percentile: budget.percentile,
      withinMs: budget.withinMs,
      neverAboveMs: budget.neverAboveMs,
      provisional: budget.provisional,
      confirmedBy: budget.confirmedBy,
      measuredAs: production.kind,
      capability,
      verdict: reading.verdict,
      atMs: finite(reading.atMs),
      largestMs: finite(reading.largestMs),
      why:
        production.kind === 'unmeasured' || production.kind === 'immediate' ? production.why : null,
    };
  });
}

/** A capability's minutes in the window, added up; only the current bucket version adds. */
function summed(minutes: readonly CapabilityUsage[]) {
  const by = new Map<string, CapabilityUsage[]>();
  for (const minute of minutes)
    by.set(minute.capability, [...(by.get(minute.capability) ?? []), minute]);
  return [...by].map(([capability, rows]) => ({
    capability,
    counts: rows.reduce(
      (sum, row) => ({
        requests: sum.requests + row.requests,
        clientErrors: sum.clientErrors + row.clientErrors,
        serverErrors: sum.serverErrors + row.serverErrors,
        refused: sum.refused + row.refused,
        buckets: addBuckets(sum.buckets, row.buckets),
      }),
      { requests: 0, clientErrors: 0, serverErrors: 0, refused: 0, buckets: emptyBuckets() },
    ),
  }));
}

/**
 * Diagnostics (diagnostics.md; the DG plan, DG-H): everything an administrator needs to tell "us" from
 * "you", read in one transaction under the environment's role. Codes and counts, never content.
 */
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The days asked for (ADR-0100): the last 13 months unless named, never one ending first or longer. */
function daysOf(query: UsageQuery): { readonly from: string; readonly to: string } {
  const to = query.to ?? dayOf(Date.now());
  const from = query.from ?? dayOf(Date.parse(to) - (USAGE_KEPT_DAYS - 1) * DAY);
  const span = (Date.parse(to) - Date.parse(from)) / DAY;
  if (span < 0 || span >= USAGE_KEPT_DAYS) {
    throw new AppError(
      400,
      'invalid_request',
      'Choose days that end after they start and span no more than 13 months.',
    );
  }
  return { from, to };
}

export function diagnosticsHandlers(objectives: Objectives) {
  return {
    getUsage: async (request: FastifyRequest, { trx }: Authorised): Promise<UsageView> => {
      const { from, to } = daysOf(request.query as UsageQuery);
      const counted = await usageDays(trx, from, to);
      return {
        from,
        to,
        measures: USAGE_MEASURES.map(({ measure, kind, unit }) => ({
          measure,
          kind,
          unit,
          days: counted
            .filter((each) => each.measure === measure)
            .map(({ day, amount }) => ({ day, amount })),
        })),
      };
    },
    getDiagnostics: async (_request: unknown, { trx }: Authorised): Promise<DiagnosticsView> => {
      const now = new Date();
      const minutes = await capabilityUsage(
        trx,
        'minute',
        new Date(now.getTime() - HEALTH_WINDOW_MS),
      );
      const capabilities = summed(minutes)
        .map(({ capability, counts }) => ({
          capability,
          ...capabilityHealth(counts, budgetOf(capability)),
        }))
        .sort((a, b) => a.capability.localeCompare(b.capability));
      const work = (await backgroundWork(trx)).map((run) => ({
        work: run.work,
        health: workHealth(run, now),
        outcome: run.outcome,
        lastStartedAt: run.lastStartedAt.toISOString(),
        lastFinishedAt: run.lastFinishedAt.toISOString(),
        nextDueAt: iso(run.nextDueAt),
        failure: run.failure,
        failedAt: iso(run.failedAt),
        failures: run.failures,
      }));
      const jobs = (await ownJobs(trx, new Date(now.getTime() - DAY))).map((each) => ({
        kind: each.kind,
        capability:
          (JOB_CAPABILITIES as Readonly<Record<string, string>>)[each.kind] ?? 'Other work',
        state: each.state,
        jobs: each.jobs,
        firstAt: each.firstAt.toISOString(),
        lastAt: each.lastAt.toISOString(),
        lastError: each.lastError,
      }));
      const status = await embeddingStatus(trx);
      const freshness = await embeddingFreshness(trx);
      const channel = await mailChannel(trx);
      const mail = await mailCounts(trx);
      const connections = (await connectionRunsSince(trx, new Date(now.getTime() - DAY))).map(
        (each) => ({
          connection: each.connection,
          name: each.name,
          runs: each.runs,
          failed: each.failed,
          timedOut: each.timedOut,
          lastRunAt: each.lastRunAt.toISOString(),
          down: each.lastFailed,
          lastFailure: each.lastFailure,
        }),
      );
      const budget = await readBudget(trx);
      const spent = budget === null ? null : await spendThisMonth(trx, budget.currency);
      const policy = await dataPolicy(trx);
      return {
        at: now.toISOString(),
        capabilities,
        work,
        jobs,
        index: {
          serving: status.serving?.model ?? null,
          pending:
            status.pending === null
              ? null
              : {
                  model: status.pending.model,
                  missing: status.pending.missing,
                  confirmed: status.pending.confirmedAt !== null,
                },
          p95LagSeconds: freshness.p95Seconds,
          maxLagSeconds: freshness.maxSeconds,
        },
        webhooks: await webhookCounts(trx),
        mail: {
          enabled: channel?.enabled ?? false,
          failingSince: iso(channel?.failingSince ?? null),
          waiting: mail.waiting,
          givenUp: mail.givenUp,
        },
        connections,
        objectives: await (async () => {
          const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          const probes = await serviceAvailability(trx, month);
          const runs = await backupRecord(trx);
          const read = objectiveReadings(objectives, { probes, runs }, now);
          return {
            availability: { ...read.availability, since: read.availability.since.toISOString() },
            recoveryPoint: read.recoveryPoint,
            recoveryTime: { ...read.recoveryTime, drilledAt: iso(read.recoveryTime.drilledAt) },
            backups: runs.map((run) => ({
              ...run,
              lastStartedAt: run.lastStartedAt.toISOString(),
              succeededAt: iso(run.succeededAt),
            })),
          };
        })(),
        performance: performance(await capabilityTotals(trx, new Date(now.getTime() - 7 * DAY)), {
          p95Seconds: freshness.p95Seconds,
          maxSeconds: freshness.maxSeconds,
        }),
        budgets: {
          model:
            budget === null || spent === null
              ? null
              : {
                  currency: budget.currency,
                  spentMicros: spent.micros.toString(),
                  limitMicros: budget.limitMicros.toString(),
                },
          queryRunsAtOnce: policy.concurrentRuns ?? runsAtOnce.default,
        },
      };
    },
  };
}
