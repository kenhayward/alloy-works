import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { JobView } from './jobs.js';
import { listingQuery, nextCursor } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** The most rows one cohort takes (the R7 plan, R7-B). */
const ROWS_MAX = 1000;

const parameterSet = z
  .record(z.string(), z.unknown())
  .describe("One row: a value for each of the template's parameters, by name");

export const CohortSpaceParams = z.object({ space: z.uuid() });
export type CohortSpaceParams = z.infer<typeof CohortSpaceParams>;
export const CohortParams = z.object({ id: z.uuid() });
export type CohortParams = z.infer<typeof CohortParams>;

/**
 * A cohort asked for (REU-031, REU-032; R7-A to R7-C): a template, the title each document takes, and
 * its rows, given inline or taken from a query result the caller may read.
 */
const cohortHead = {
  template: LowercaseUuid.describe('The template every document is made from'),
  title: z
    .string()
    .min(1)
    .max(400)
    .describe("Each document's title, `{name}` standing for the row's value of that parameter"),
  language: z.string().min(1).describe("Each document's language, a BCP 47 tag"),
  direction: z.enum(['ltr', 'rtl']).describe("Each document's base direction"),
};

export const SubmitCohortBody = z
  .strictObject({
    ...cohortHead,
    rows: z
      .array(parameterSet)
      .min(1)
      .max(ROWS_MAX)
      .optional()
      .describe('The rows, inline, 1 to 1,000'),
    dataset: LowercaseUuid.optional().describe(
      "A query result's version whose rows are the rows: one parameter for each column, by its name",
    ),
  })
  .refine((body) => (body.rows === undefined) !== (body.dataset === undefined), {
    message: 'Give the rows inline or name a query result, one or the other',
  })
  .meta({
    examples: [
      {
        template: '00000000-0000-4000-8000-000000000001',
        title: 'Site report: {site}',
        language: 'en',
        direction: 'ltr',
        rows: [{ site: 'Leeds' }, { site: 'York' }],
      },
    ],
  });
export type SubmitCohortBody = z.infer<typeof SubmitCohortBody>;

/** Failed rows run again (REU-035; R7-F), each with the corrected parameters given for it, if any. */
export const RerunCohortBody = z.strictObject({
  corrections: z
    .record(z.string().regex(/^[1-9][0-9]{0,3}$/), parameterSet)
    .optional()
    .describe('Corrected parameters for failed rows, by row number'),
});
export type RerunCohortBody = z.infer<typeof RerunCohortBody>;

export const CohortView = z.object({
  id: LowercaseUuid,
  space: LowercaseUuid,
  template: z
    .object({ id: LowercaseUuid, version: LowercaseUuid })
    .describe(
      'The template version every row is made from, resolved when the cohort was asked for',
    ),
  title: z.string(),
  source: z
    .object({ rows: z.number().int().optional(), dataset: LowercaseUuid.optional() })
    .describe('Where its rows came from: how many were given inline, or the query result'),
  requestedAt: z.string(),
  rows: z
    .array(
      z.object({
        row: z.number().int(),
        parameters: parameterSet,
        state: z
          .enum(['pending', 'made', 'failed'])
          .describe(
            'pending: not yet made; made: `document` is its document; failed: `failure` says why',
          ),
        document: LowercaseUuid.nullable(),
        failure: z
          .object({ code: z.string(), message: z.string() })
          .catchall(z.unknown())
          .nullable()
          .describe("A failed row's refusal: its code, its words, and what it names"),
        attempts: z.number().int(),
      }),
    )
    .describe('Every row, in order'),
});
export type CohortView = z.infer<typeof CohortView>;

export const CohortRun = z.object({ cohort: CohortView, job: JobView });
export type CohortRun = z.infer<typeof CohortRun>;

const CohortRefusal = ErrorBody.extend({
  detail: z.string().optional().describe('rows_invalid: what is wrong with the rows'),
});

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const unseen = {
  description: 'No such cohort, or one in a space the caller may not read',
  schema: ErrorBody,
} as const;

/** The cohorts listing's query (SCH-065; the R14 plan, R14-A): sorted, filtered and paged. */
export const CohortListQuery = z.object({
  ...listingQuery(['requested', 'title'], 'requested'),
  template: LowercaseUuid.optional().describe('Only cohorts made from this template'),
  state: z
    .enum(['complete', 'failed', 'pending'])
    .optional()
    .describe(
      'Only cohorts every row of which was made, one with a row that failed, or one with a row waiting and none failed',
    ),
});
export type CohortListQuery = z.infer<typeof CohortListQuery>;

export const CohortSummaryView = z.object({
  id: LowercaseUuid,
  title: z.string().describe('The title each document takes, `{name}` standing for a parameter'),
  template: z.object({ id: LowercaseUuid, version: LowercaseUuid, name: z.string() }),
  space: z.object({ id: LowercaseUuid, name: z.string() }),
  requestedAt: z.string(),
  rows: z
    .object({
      made: z.int().nonnegative(),
      failed: z.int().nonnegative(),
      pending: z.int().nonnegative(),
    })
    .describe('How its rows stand'),
});

export const CohortList = z.object({ items: z.array(CohortSummaryView), next: nextCursor });
export type CohortList = z.infer<typeof CohortList>;

/** Cohorts: documents made in bulk from one template (templates.md; the R7 plan). */
export const cohortRoutes = {
  submitCohort: {
    operationId: 'submitCohort',
    method: 'POST',
    path: '/v1/spaces/{space}/cohorts',
    summary: 'Make many documents from one template, one for each row of parameters, as a job',
    tenantScoped: true,
    access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    params: CohortSpaceParams,
    body: SubmitCohortBody,
    responses: {
      200: {
        description: 'Accepted: the cohort, every row pending, and its job',
        schema: CohortRun,
      },
      400: {
        description:
          '`rows_invalid`: no rows, too many, or a query result that cannot be read as rows; `template_unresolved`: what the template names does not resolve; or `invalid_request`',
        schema: CohortRefusal,
      },
      401: unauthenticated,
      403: { description: 'The caller may not create in this space', schema: ErrorBody },
      404: {
        description: 'No such space, template or query result the caller may read',
        schema: ErrorBody,
      },
      409: {
        description:
          "`cohort_bound`: the template's required components run queries, which documents made in bulk cannot run yet",
        schema: ErrorBody,
      },
    },
  },
  listCohorts: {
    operationId: 'listCohorts',
    method: 'GET',
    path: '/v1/cohorts',
    summary:
      'The cohorts the caller may read, newest first or by title, filtered by template and state',
    tenantScoped: true,
    access: { check: 'session' },
    query: CohortListQuery,
    responses: {
      200: { description: 'A page of cohorts', schema: CohortList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
    },
  },
  getCohort: {
    operationId: 'getCohort',
    method: 'GET',
    path: '/v1/cohorts/{id}',
    summary: 'A cohort: what it was made from, and every row, its document or why it failed',
    tenantScoped: true,
    access: { check: 'session' },
    params: CohortParams,
    responses: {
      200: { description: 'The cohort', schema: CohortView },
      401: unauthenticated,
      404: unseen,
    },
  },
  rerunCohort: {
    operationId: 'rerunCohort',
    method: 'POST',
    path: '/v1/cohorts/{id}/rerun',
    summary: "Run a cohort's failed rows again, from the same template version",
    tenantScoped: true,
    access: { check: 'session' },
    params: CohortParams,
    body: RerunCohortBody,
    responses: {
      200: {
        description: 'Accepted: the cohort and the job running its failed rows',
        schema: CohortRun,
      },
      400: {
        description: '`rows_invalid`: a correction for a row that has not failed',
        schema: CohortRefusal,
      },
      401: unauthenticated,
      403: { description: "The caller may not create in the cohort's space", schema: ErrorBody },
      404: unseen,
      409: { description: '`cohort_complete`: no row has failed', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
