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
});
export type DiagnosticsView = z.infer<typeof DiagnosticsView>;

export const diagnosticsRoutes = {
  getDiagnostics: {
    operationId: 'getDiagnostics',
    method: 'GET',
    path: '/v1/diagnostics',
    summary: "How the environment's capabilities, background work and deliveries are doing",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    responses: {
      200: { description: 'The diagnostics', schema: DiagnosticsView },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
      403: { description: 'The caller does not administer the environment', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
