import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

const at = z.string().describe('An ISO 8601 time');
const Health = z
  .enum(['healthy', 'degraded', 'failing', 'idle'])
  .describe(
    'Over the last 15 minutes: failing when most answered requests failed on the server, degraded when 5% did or the 95th percentile passed its budget, idle with none answered',
  );

const CapabilityView = z.object({
  capability: z
    .string()
    .describe("A route tag of this API, or one of the worker's kinds of work, such as Indexing"),
  health: Health,
  requests: z.int(),
  errorRate: z
    .number()
    .nullable()
    .describe('Server errors over the requests answered; null with none'),
  p95Ms: z
    .int()
    .nullable()
    .describe('The 95th percentile, as the bucket bound holding it; null with none'),
});

const WorkView = z.object({
  work: z.string().describe('The sweep or loop, by name'),
  health: z
    .enum(['healthy', 'failing', 'paused'])
    .describe(
      'Failing when its last run failed or it has not run for twice its cadence; paused while the environment is held',
    ),
  outcome: z.enum(['succeeded', 'failed', 'paused']),
  lastStartedAt: at,
  lastFinishedAt: at,
  nextDueAt: at.nullable().describe('Read from its own cadence; null after one run'),
  failure: z.string().nullable().describe('The last failure, as a code, kept after it clears'),
  failedAt: at.nullable(),
  failures: z.int().describe('Failures in a row'),
});

const JobsView = z.object({
  kind: z.string(),
  capability: z.string().describe('The kind of work it is measured as'),
  state: z.enum(['waiting', 'running', 'done', 'failed']),
  jobs: z.int(),
  firstAt: at,
  lastAt: at,
  lastError: z.string().nullable().describe("The latest failed job's code"),
});

const ConnectionView = z.object({
  connection: z.string(),
  name: z.string().nullable().describe('Its name at its latest version; null where it has gone'),
  runs: z.int(),
  failed: z.int(),
  timedOut: z.int(),
  lastRunAt: at,
  down: z
    .boolean()
    .describe('Its latest run failed: as far as the product knows, the source is down'),
  lastFailure: z.string().nullable(),
});

/** A performance budget, as registered and as production measured it (the DG plan, DG-J). */
const PerformanceView = z.object({
  budget: z
    .string()
    .describe('The requirement stating it, with what it times where one states two'),
  requirement: z.string(),
  owner: z.string().describe('The design that claims it'),
  reference: z.string().describe('What the tests measure it on'),
  percentile: z.number().nullable().describe('The fraction held to `withinMs`, such as 0.95'),
  withinMs: z.number().nullable(),
  neverAboveMs: z.number().nullable().describe('No sample above this'),
  provisional: z.boolean(),
  confirmedBy: z.string().describe('The tranche by which it is confirmed'),
  measuredAs: z
    .enum(['request', 'job', 'lag', 'immediate', 'unmeasured'])
    .describe(
      "How production measures it: an operation's requests, a job's run without its wait, the index's lag, met as built, or not at all",
    ),
  capability: z.string().nullable().describe('The capability whose measurements it is read from'),
  verdict: z
    .enum(['met', 'missed', 'nothing', 'immediate', 'unmeasured'])
    .describe(
      'Over the last 7 days: met, missed, nothing measured, met as built, or not measured in production',
    ),
  atMs: z
    .number()
    .nullable()
    .describe('Its percentile as measured: for requests and jobs, the bucket bound holding it'),
  largestMs: z
    .number()
    .nullable()
    .describe('The largest sample, as a bucket bound; null with nothing, or past every bound'),
  why: z.string().nullable().describe('Why it is met as built, or not measured in production'),
});

/** A class of stored artifact, as its re-verification last found it (the DG plan, DG-K). */
const IntegrityClassView = z.object({
  class: z
    .enum(['asset', 'version', 'audit_export', 'tenant_export'])
    .describe(
      "An asset's original against its hash, a version against its digests, or an export against its hash",
    ),
  items: z.int().describe('Items held now'),
  checkedInPeriod: z.int().describe('Items checked within the period'),
  failing: z.int().describe('Items whose last check failed'),
  lastFailure: z
    .object({
      item: z.string().describe('The item, by id'),
      failure: z.enum(['hash_mismatch', 'digest_mismatch', 'object_missing']),
      at: z.string().describe('When the check found it, an ISO 8601 time'),
    })
    .nullable()
    .describe("The latest failing item's check; null with none failing"),
});

const objectiveVerdict = z
  .enum(['met', 'missed', 'unrecorded', 'unrehearsed'])
  .describe(
    'Met, missed, recorded nowhere here, or (a recovery time) not rehearsed in the stated period',
  );

/** The objectives an operator set, against what was measured (the DG plan, DG-D; ADR-0101). */
const ObjectivesView = z.object({
  availability: z.object({
    objective: z.number().describe('The fraction of a month the service answers, such as 0.995'),
    since: at.describe('This month, or the first minute probed if later'),
    measured: z.number().nullable().describe('Minutes probed up over minutes elapsed'),
    verdict: objectiveVerdict,
  }),
  recoveryPoint: z.object({
    objectiveHours: z.number(),
    hours: z.number().nullable().describe("The age of the oldest class's last good backup"),
    verdict: objectiveVerdict,
  }),
  recoveryTime: z.object({
    objectiveHours: z.number(),
    hours: z.number().nullable().describe("The latest drills' restores of every class, added up"),
    drilledAt: at.nullable(),
    verdict: objectiveVerdict,
  }),
  backups: z
    .array(
      z.object({
        class: z.enum(['databases', 'objects']),
        act: z.enum(['backup', 'drill']),
        lastStartedAt: at,
        lastSeconds: z.number(),
        lastOutcome: z.enum(['succeeded', 'failed']),
        succeededAt: at.nullable(),
      }),
    )
    .describe(
      'The latest backup and drill of each class; none where backups are recorded elsewhere',
    ),
});

export const DiagnosticsView = z.object({
  at,
  capabilities: z.array(CapabilityView).describe('Each capability with requests in the window'),
  work: z.array(WorkView).describe('Each sweep and loop that has run here'),
  jobs: z.array(JobsView).describe('The last 24 hours of jobs, and those still to do'),
  index: z.object({
    serving: z.string().nullable().describe('The embedding model searches are served by'),
    pending: z
      .object({ model: z.string(), missing: z.int(), confirmed: z.boolean() })
      .nullable()
      .describe('A model being changed to, and the texts it has still to embed'),
    p95LagSeconds: z
      .number()
      .nullable()
      .describe("A version's wait to be searchable by meaning, over the last 7 days"),
    maxLagSeconds: z.number().nullable(),
    waitingSeconds: z
      .number()
      .nullable()
      .describe(
        'How long the oldest version waiting to be searchable by meaning has waited; null with none waiting',
      ),
  }),
  webhooks: z.object({
    subscriptions: z.int(),
    failing: z.int().describe('Enabled, and failing since an attempt not yet succeeded'),
    disabledFailing: z.int().describe('Turned off after three days of failing'),
  }),
  mail: z.object({
    enabled: z.boolean(),
    failingSince: at.nullable(),
    waiting: z.int(),
    givenUp: z.int(),
  }),
  connections: z.array(ConnectionView).describe('Each connection run on in the last 24 hours'),
  objectives: ObjectivesView,
  performance: z
    .array(PerformanceView)
    .describe('Every performance budget the specification states, read against production'),
  budgets: z.object({
    model: z
      .object({
        currency: z.string(),
        spentMicros: z.string().describe('This month so far, in millionths, as a decimal string'),
        limitMicros: z.string(),
      })
      .nullable()
      .describe("The month's model spend against its budget; null with no budget set"),
    queryRunsAtOnce: z.int().describe('How many query runs may run at once'),
  }),
  integrity: z
    .object({
      periodDays: z.int().describe('Every item of every class is checked within this many days'),
      classes: z.array(IntegrityClassView),
    })
    .describe('Stored artifacts re-verified, a share each night'),
});
export type DiagnosticsView = z.infer<typeof DiagnosticsView>;

/** A period of days (ADR-0100): the last 13 months unless named. */
const day = z.iso.date().describe('A UTC day, YYYY-MM-DD');
export const UsageQuery = z.object({
  from: day.optional().describe('The first day, inclusive; 395 days before `to` where absent'),
  to: day.optional().describe('The last day, inclusive; today where absent'),
});
export type UsageQuery = z.infer<typeof UsageQuery>;

export const UsageView = z.object({
  from: day,
  to: day,
  measures: z
    .array(
      z.object({
        measure: z
          .string()
          .describe(
            'databaseBytes, publicationBytes, assetBytes, importBytes, exportBytes, publications, assets, mail, webhooks, translationJobs, referenceSearches, embeddingRuns or queryMs',
          ),
        kind: z
          .enum(['count', 'sample'])
          .describe(
            'A count is what happened that day; a sample, what was held when it was counted',
          ),
        unit: z.enum(['count', 'bytes', 'ms']),
        days: z
          .array(z.object({ day, amount: z.number() }))
          .describe('Oldest first; a day with nothing counted is absent'),
      }),
    )
    .describe('Every measure declared, in the order declared, whether or not it has days'),
});
export type UsageView = z.infer<typeof UsageView>;

export const diagnosticsRoutes = {
  getDiagnostics: {
    operationId: 'getDiagnostics',
    method: 'GET',
    path: '/v1/diagnostics',
    summary: "How the environment's capabilities, background work and deliveries are doing",
    tenantScoped: true,
    reads: 'metadata',
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    responses: {
      200: { description: 'The diagnostics', schema: DiagnosticsView },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
      403: { description: 'The caller does not administer the environment', schema: ErrorBody },
    },
  },
  getUsage: {
    operationId: 'getUsage',
    method: 'GET',
    path: '/v1/usage',
    summary: 'What the environment has used, by day, over the last 13 months',
    tenantScoped: true,
    reads: 'metadata',
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    query: UsageQuery,
    responses: {
      200: { description: 'Each measure by day', schema: UsageView },
      400: {
        description: 'A day that is not one, `from` after `to`, or a period past 13 months',
        schema: ErrorBody,
      },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
      403: { description: 'The caller does not administer the environment', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
