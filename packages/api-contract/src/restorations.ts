import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * **Restoring an environment from its export** (IMP-039, IMP-048, ADM-054; the EI plan, EIc). A
 * restoration is made, its archive sent, and a job checks it and says what would happen; each secret and
 * sign-in provider is answered for, and it is applied whole or not at all.
 */

/** What one S3 PUT holds, which is how the archive is kept while it waits for its job. */
export const RESTORATION_MAX_BYTES = 5 * 1024 * 1024 * 1024;

export const TenantRestorationParams = z.object({
  id: LowercaseUuid.describe("The restoration's id"),
});
export type TenantRestorationParams = z.infer<typeof TenantRestorationParams>;

const TenantRestorationPlan = z.object({
  format: z.number().int().describe('The format the archive was written in'),
  scope: z.string().describe('What the archive holds: `tenant` for a whole environment'),
  cutAt: z.string().describe('The instant the archive was cut'),
  tables: z.record(z.string(), z.number().int()).describe('Each table it holds, and how many rows'),
  missingObjects: z
    .array(z.string())
    .describe('The hash of each file lost before the export was made, restored without its bytes'),
  secrets: z
    .array(z.object({ reference: z.string(), kind: z.string() }))
    .describe('Each secret left out of the archive, which arrives switched off'),
  issuers: z
    .array(z.object({ issuer: z.string(), people: z.number().int() }))
    .describe('Each sign-in provider its people sign in by, and how many'),
  groups: z.number().int().describe('How many groups it holds'),
  externals: z.number().int().describe('How many people from outside it holds'),
  serviceIdentities: z.number().int().describe('How many service identities it holds'),
  leftOut: z.record(z.string(), z.string()).describe('What does not travel, and why'),
  rebuilt: z.record(z.string(), z.string()).describe('What is made again here, and from what'),
});

export const TenantRestorationAnswers = z.object({
  issuers: z
    .record(z.string(), z.string().nullable())
    .describe(
      'For every provider the plan names: another this environment has, or null to keep it, those people unable to sign in until it is added',
    ),
  switchedOff: z
    .array(z.string())
    .describe('Every secret the plan names: each arrives switched off, to be set afterwards'),
});
export type TenantRestorationAnswers = z.infer<typeof TenantRestorationAnswers>;

export const TenantRestorationView = z.object({
  id: z.string(),
  state: z.enum([
    'awaiting_archive',
    'checking',
    'previewed',
    'refused',
    'applying',
    'restored',
    'failed',
  ]),
  requestedAt: z.string(),
  finishedAt: z.string().nullable(),
  plan: TenantRestorationPlan.nullable().describe(
    'What it would do: set once the archive is checked',
  ),
  answers: TenantRestorationAnswers.nullable(),
  refusal: z
    .object({ code: z.string(), message: z.string() })
    .nullable()
    .describe('Why it stopped. Nothing has changed.'),
  providers: z.array(z.string()).describe('The issuers this environment already signs in by'),
});
export type TenantRestorationView = z.infer<typeof TenantRestorationView>;

export const TenantRestorationList = z.object({ items: z.array(TenantRestorationView) });
export type TenantRestorationList = z.infer<typeof TenantRestorationList>;

export const RestoreReview = z.object({
  restoredAt: z.string().nullable().describe('When this environment was restored, if it was'),
  underReview: z.boolean().describe('Whether dates and reminders are still held'),
  datesPast: z.number().int().describe('Revisions that would take effect as soon as they run'),
  reviewDatesPast: z.number().int().describe('Review dates already past'),
});
export type RestoreReview = z.infer<typeof RestoreReview>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: '`import_environment` is not held at this environment',
  schema: ErrorBody,
} as const;
const forbiddenRecently = {
  description:
    '`import_environment` is not held at this environment, or `reauthentication_required`: sign in again, then ask again',
  schema: ErrorBody,
} as const;
const missing = {
  description: 'No such restoration in this environment',
  schema: ErrorBody,
} as const;
const READ = {
  check: 'permission',
  permission: 'import_environment',
  target: { tenant: true },
} as const;
const ACT = { ...READ, recentSignIn: 600 } as const;

export const restorationRoutes = {
  createTenantRestoration: {
    operationId: 'createTenantRestoration',
    method: 'POST',
    path: '/v1/restorations',
    summary: 'Begin restoring this environment from an archive',
    tenantScoped: true,
    access: ACT,
    idempotencyKey: false,
    responses: {
      200: { description: 'Waiting for its archive', schema: TenantRestorationView },
      401: unauthenticated,
      403: forbiddenRecently,
    },
  },
  listTenantRestorations: {
    operationId: 'listTenantRestorations',
    method: 'GET',
    path: '/v1/restorations',
    summary: "This environment's latest restorations, the newest first",
    tenantScoped: true,
    access: READ,
    responses: {
      200: { description: 'The latest twenty', schema: TenantRestorationList },
      401: unauthenticated,
      403: forbidden,
    },
  },
  getTenantRestoration: {
    operationId: 'getTenantRestoration',
    method: 'GET',
    path: '/v1/restorations/{id}',
    summary: 'A restoration: where it has got to, and what it would do',
    tenantScoped: true,
    access: READ,
    params: TenantRestorationParams,
    responses: {
      200: { description: 'The restoration', schema: TenantRestorationView },
      401: unauthenticated,
      403: forbidden,
      404: missing,
    },
  },
  sendTenantRestorationArchive: {
    operationId: 'sendTenantRestorationArchive',
    method: 'PUT',
    path: '/v1/restorations/{id}/archive',
    summary: 'Send the archive, as bytes; a job then checks it',
    tenantScoped: true,
    access: ACT,
    params: TenantRestorationParams,
    idempotencyKey: false,
    rawBody: { contentType: 'application/x-tar', maxBytes: RESTORATION_MAX_BYTES },
    responses: {
      200: { description: 'Kept, and being checked', schema: TenantRestorationView },
      401: unauthenticated,
      403: forbiddenRecently,
      404: missing,
      409: {
        description: '`restoration_filled`: this restoration already has its archive',
        schema: ErrorBody,
      },
      413: { description: '`archive_too_large`: past 5 GiB', schema: ErrorBody },
    },
  },
  answerTenantRestoration: {
    operationId: 'answerTenantRestoration',
    method: 'PUT',
    path: '/v1/restorations/{id}/answers',
    summary: 'Answer for each secret and each sign-in provider it names',
    tenantScoped: true,
    access: ACT,
    params: TenantRestorationParams,
    body: TenantRestorationAnswers,
    responses: {
      200: { description: 'Answered', schema: TenantRestorationView },
      400: {
        description: '`restoration_answer_invalid`: an answer missing, or naming nothing',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbiddenRecently,
      404: missing,
      409: {
        description: '`restoration_not_previewed`: it is not waiting for its answers',
        schema: ErrorBody,
      },
    },
  },
  applyTenantRestoration: {
    operationId: 'applyTenantRestoration',
    method: 'POST',
    path: '/v1/restorations/{id}/apply',
    summary: 'Restore it: a job applies all of it or nothing',
    tenantScoped: true,
    access: ACT,
    params: TenantRestorationParams,
    responses: {
      200: { description: 'Being applied', schema: TenantRestorationView },
      401: unauthenticated,
      403: forbiddenRecently,
      404: missing,
      409: {
        description:
          '`restoration_not_previewed` or `restoration_unanswered`: it is not ready to apply',
        schema: ErrorBody,
      },
    },
  },
  getRestoreReview: {
    operationId: 'getRestoreReview',
    method: 'GET',
    path: '/v1/restore-review',
    summary: 'What would fall due in a restored environment once dates and reminders run',
    tenantScoped: true,
    access: READ,
    responses: {
      200: { description: 'The review', schema: RestoreReview },
      401: unauthenticated,
      403: forbidden,
    },
  },
  endRestoreReview: {
    operationId: 'endRestoreReview',
    method: 'POST',
    path: '/v1/restore-review/end',
    summary: 'Let dates and reminders run again in a restored environment',
    tenantScoped: true,
    access: ACT,
    responses: {
      200: { description: 'The review, ended', schema: RestoreReview },
      401: unauthenticated,
      403: forbiddenRecently,
    },
  },
} as const satisfies Record<string, RouteContract>;
