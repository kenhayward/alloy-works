import type { DiagnosticsView } from '@alloy-works/api-contract';
import {
  backgroundWork,
  capabilityUsage,
  connectionRunsSince,
  dataPolicy,
  embeddingFreshness,
  embeddingStatus,
  mailChannel,
  mailCounts,
  ownJobs,
  readBudget,
  spendThisMonth,
  webhookCounts,
  type CapabilityUsage,
} from '@alloy-works/db';
import {
  addBuckets,
  capabilityHealth,
  emptyBuckets,
  HEALTH_WINDOW_MS,
  JOB_CAPABILITIES,
  runsAtOnce,
  workHealth,
} from '@alloy-works/domain';
import type { Authorised } from './access.js';

const DAY = 86_400_000;
const iso = (date: Date | null) => (date === null ? null : date.toISOString());

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
export function diagnosticsHandlers() {
  return {
    getDiagnostics: async (_request: unknown, { trx }: Authorised): Promise<DiagnosticsView> => {
      const now = new Date();
      const minutes = await capabilityUsage(
        trx,
        'minute',
        new Date(now.getTime() - HEALTH_WINDOW_MS),
      );
      const capabilities = summed(minutes)
        .map(({ capability, counts }) => ({ capability, ...capabilityHealth(counts) }))
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
