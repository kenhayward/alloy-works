import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * A job (API-040 to API-043; the R3 plan): work that can outlive a request, read by whoever submitted
 * it. Every kind is read, cancelled and downloaded alike; each is submitted where its subject is.
 */
export const JobView = z.object({
  id: LowercaseUuid,
  kind: z
    .enum(['impact_report', 'cohort'])
    .describe(
      'impact_report: what a change to `subject` reaches; cohort: the documents of the cohort `subject` made',
    ),
  subject: LowercaseUuid.describe(
    'What it is about: an impact report starts from this artifact; a cohort run makes this cohort',
  ),
  parameters: z
    .object({ depth: z.number().int().optional(), rows: z.number().int().optional() })
    .describe("What it was asked with: an impact report's depth, or the rows a cohort run takes"),
  state: z
    .enum(['accepted', 'running', 'succeeded', 'failed', 'cancelled'])
    .describe(
      'accepted: waiting to run; running; succeeded: its result may be downloaded; failed: `failure` says why; cancelled: `outcome` says how far it got',
    ),
  requestedAt: z.string(),
  startedAt: z.string().nullable().describe('When it first started; null while accepted'),
  finishedAt: z.string().nullable(),
  progress: z
    .object({ done: z.number().int(), of: z.number().int(), unit: z.string() })
    .nullable()
    .describe('How far it has got, as `done` of `of` in `unit`; null before its first step'),
  cancelRequested: z.boolean().describe('Whether a cancel was asked for while it ran'),
  failure: z
    .object({ code: z.string(), message: z.string(), rule: z.string().optional() })
    .nullable()
    .describe("A failed job's error, in an error's shape but its trace (API-043)"),
  outcome: z
    .union([
      z.object({
        depthsWalked: z.number().int(),
        depthsAsked: z.number().int(),
        reached: z.number().int(),
        cut: z
          .boolean()
          .describe('Whether the walk met something the requester may not read: never what'),
      }),
      z.object({
        made: z.number().int().describe('The rows made into documents'),
        failed: z.number().int().describe('The rows that failed, each reported'),
        of: z.number().int().describe('The rows the run took'),
        onFailure: z
          .enum(['continue', 'stop'])
          .optional()
          .describe('What it did at a failed row, as the cohort asked (TPL-047)'),
        stoppedAt: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe(
            'The failed row it stopped at, the rows after it waiting; null where it did not stop',
          ),
      }),
    ])
    .nullable()
    .describe(
      'What it did, once finished or cancelled: a cancelled report walked `depthsWalked` of `depthsAsked` and kept nothing',
    ),
  result: z
    .object({ bytes: z.number().int(), sha256: z.string() })
    .nullable()
    .describe("A succeeded job's result, to download"),
});
export type JobView = z.infer<typeof JobView>;

export const JobParams = z.object({ id: z.uuid() });
export type JobParams = z.infer<typeof JobParams>;

export const ImpactReportParams = z.object({ id: z.uuid() });
export type ImpactReportParams = z.infer<typeof ImpactReportParams>;

export const ImpactReportBody = z.strictObject({
  depth: z.number().int().min(1).max(10).describe('How many hops to walk, 1 to 10 (REL-017)'),
});
export type ImpactReportBody = z.infer<typeof ImpactReportBody>;

export const JobDownload = z.object({
  download: z.string().describe('A link to the result, JSON Lines, good for five minutes'),
});
export type JobDownload = z.infer<typeof JobDownload>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notYours = {
  description: 'No such job, or one somebody else submitted',
  schema: ErrorBody,
} as const;

/** Jobs, and the impact report the first of them (relationships.md; the R3 plan, R3-B). */
export const jobRoutes = {
  submitImpactReport: {
    operationId: 'submitImpactReport',
    method: 'POST',
    path: '/v1/artifacts/{id}/impact-reports',
    summary: 'Ask for the complete report of what a change to an artifact reaches, as a job',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ImpactReportParams,
    body: ImpactReportBody,
    responses: {
      200: { description: 'Accepted: the job, to follow', schema: JobView },
      400: { description: 'A depth not from 1 to 10', schema: ErrorBody },
      401: unauthenticated,
      403: {
        description: 'Never answered: an artifact the caller may not read is not found',
        schema: ErrorBody,
      },
      404: { description: 'No such artifact the caller may read', schema: ErrorBody },
    },
  },
  getJob: {
    operationId: 'getJob',
    method: 'GET',
    path: '/v1/jobs/{id}',
    summary: 'A job: its state, when it started, how far it has got, and how it ended',
    tenantScoped: true,
    access: { check: 'session' },
    params: JobParams,
    responses: {
      200: { description: 'The job', schema: JobView },
      401: unauthenticated,
      404: notYours,
    },
  },
  cancelJob: {
    operationId: 'cancelJob',
    method: 'POST',
    path: '/v1/jobs/{id}/cancel',
    summary: 'Cancel a job',
    tenantScoped: true,
    access: { check: 'session' },
    params: JobParams,
    responses: {
      200: {
        description:
          'Cancelled, having done nothing, if it had not started; or asked to stop, which a running job does at its next step',
        schema: JobView,
      },
      401: unauthenticated,
      404: notYours,
      409: { description: 'job_finished: it has finished already', schema: ErrorBody },
    },
  },
  downloadJob: {
    operationId: 'downloadJob',
    method: 'GET',
    path: '/v1/jobs/{id}/download',
    summary: "A link to a succeeded job's result",
    tenantScoped: true,
    access: { check: 'session' },
    params: JobParams,
    responses: {
      200: { description: 'A link to the result', schema: JobDownload },
      401: unauthenticated,
      404: notYours,
      409: { description: 'job_not_ready: it has not succeeded', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
