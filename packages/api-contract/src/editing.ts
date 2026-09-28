import { storableEverywhere } from '@alloy-works/domain';
import { z } from 'zod';
import { ComponentParams, Lock, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { nextCursor, pageQuery } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** An iteration's address: the component, the editing session, and the session's sequence number. */
export const IterationParams = z.object({
  id: LowercaseUuid,
  session: LowercaseUuid.describe(
    'The editing session, which the renderer makes and keeps per window',
  ),
  sequence: z
    .string()
    .regex(/^[1-9][0-9]{0,8}$/, 'Expected a whole number from 1')
    .describe('Only ever increasing within a session'),
});
export type IterationParams = z.infer<typeof IterationParams>;

export const ClaimBody = z.strictObject({
  session: LowercaseUuid,
  move: z
    .boolean()
    .optional()
    .describe('Continue here: move a lock this principal holds elsewhere'),
});
export type ClaimBody = z.infer<typeof ClaimBody>;

export const LockAnswer = z.object({ lock: Lock });
export type LockAnswer = z.infer<typeof LockAnswer>;

export const IterationBody = z.strictObject({
  openedFrom: LowercaseUuid.describe(
    'The version the session opened from, which must be the latest',
  ),
  content: z.record(z.string(), z.unknown()).describe('The whole content document'),
  values: z
    .record(z.string(), z.unknown())
    .refine(storableEverywhere, 'A value holds a character that cannot be stored')
    .optional()
    .describe(
      "The component's values, whole, by field identifier; absent keeps those of the version opened from",
    ),
});
export type IterationBody = z.infer<typeof IterationBody>;

export const IterationAccepted = z.object({ sequence: z.number(), lock: Lock });
export type IterationAccepted = z.infer<typeof IterationAccepted>;

export const CutBody = z.strictObject({
  session: LowercaseUuid,
  openedFrom: LowercaseUuid,
  note: z.string().min(1).max(500).optional(),
});
export type CutBody = z.infer<typeof CutBody>;

export const ReleaseQuery = z.object({ session: LowercaseUuid, openedFrom: LowercaseUuid });
export type ReleaseQuery = z.infer<typeof ReleaseQuery>;

/**
 * Reading iterations back (component-editor.md, "Recovery, as W11 builds it"): the caller's own, while
 * the editing session named here holds the lock (RC-A).
 */
const HoldingSession = LowercaseUuid.describe(
  'The editing session asking, which must hold the lock on the component',
);

export const IterationListQuery = z.object({ session: HoldingSession, ...pageQuery });
export type IterationListQuery = z.infer<typeof IterationListQuery>;

export const SavedIterationParams = z.object({ id: z.uuid(), iteration: LowercaseUuid });
export type SavedIterationParams = z.infer<typeof SavedIterationParams>;

export const SavedIterationQuery = z.object({ session: HoldingSession });
export type SavedIterationQuery = z.infer<typeof SavedIterationQuery>;

const IterationSummary = z.object({
  id: z.string(),
  session: z.string().describe("The editing session that wrote it, one of the caller's own"),
  sequence: z.number().int(),
  createdAt: z.string().describe('When the service accepted it'),
  openedFrom: z
    .object({ id: z.string(), number: z.string().describe('`revision.version`, as `0.2`') })
    .describe('The version the session that wrote it had opened'),
});

export const IterationList = z.object({
  items: z.array(IterationSummary).describe('Newest first, with no content (RC-E)'),
  next: nextCursor,
});
export type IterationList = z.infer<typeof IterationList>;

export const SavedIteration = IterationSummary.extend({
  content: z
    .record(z.string(), z.unknown())
    .describe('The whole content document, as stored: migrated and validated by its reader'),
  values: z.record(z.string(), z.unknown()).describe("The component's values it was saved with"),
});
export type SavedIteration = z.infer<typeof SavedIteration>;

export const CutAnswer = z.object({
  outcome: z
    .enum(['cut', 'unchanged'])
    .describe('unchanged: nothing differed from the latest version, which is not an error'),
  version: VersionSummary.describe('The version cut, or the latest when nothing was'),
});
export type CutAnswer = z.infer<typeof CutAnswer>;

/**
 * A write refused in an editing session, in the one error shape with what the author needs as members
 * rather than prose (component-editor.md, "The API"): who holds the lock and when it is expected back
 * (`lock_held`, API-039), the current version (`version_precondition`), or the latest accepted sequence
 * (`iteration_stale`, `iteration_conflict`). The wire uses an underscore in every code (Ken's decision
 * F); the store's own dotted answers (`lock.held` and the rest) are mapped to these in the service, at
 * one place.
 */
export const EditingRefusal = ErrorBody.extend({
  holder: z.object({ id: z.string(), name: z.string().nullable() }).optional(),
  expectedRelease: z.string().optional(),
  current: VersionSummary.optional(),
  latest: z.number().optional(),
  failures: z
    .array(
      z.object({
        code: z.string(),
        field: z.string(),
        rule: z.string(),
        schemas: z.array(z.string()),
        detail: z.string(),
      }),
    )
    .optional()
    .describe(
      "values_invalid: each value that cannot be stored with the component, in MET-022's shape",
    ),
});
export type EditingRefusal = z.infer<typeof EditingRefusal>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such component in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may read the component but may not edit it',
  schema: ErrorBody,
} as const;
const refused = {
  description:
    'lock_held, lock_required, version_precondition, iteration_stale or iteration_conflict',
  schema: EditingRefusal,
} as const;
const edit = { check: 'permission', permission: 'edit', target: { artifact: 'id' } } as const;

/** Writing in an editing session (component-editor.md, "The API"), each checking `edit`. */
export const editingRoutes = {
  claimLock: {
    operationId: 'claimLock',
    method: 'POST',
    path: '/v1/components/{id}/lock',
    summary: 'Claim the lock for an editing session, or move it to this one',
    tenantScoped: true,
    access: edit,
    params: ComponentParams,
    body: ClaimBody,
    responses: {
      200: { description: 'Claimed', schema: LockAnswer },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: refused,
    },
  },
  releaseLock: {
    operationId: 'releaseLock',
    method: 'DELETE',
    path: '/v1/components/{id}/lock',
    summary: 'Done editing: cut a version of what changed, then release the lock',
    tenantScoped: true,
    access: edit,
    params: ComponentParams,
    query: ReleaseQuery,
    responses: {
      400: {
        description: '`values_invalid`: a fixed value differs from its default at the cut',
        schema: EditingRefusal,
      },
      200: { description: 'Released, with the version cut or the latest', schema: CutAnswer },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: refused,
    },
  },
  saveIteration: {
    operationId: 'saveIteration',
    method: 'PUT',
    path: '/v1/components/{id}/iterations/{session}/{sequence}',
    summary: "Save the session's whole content as an iteration",
    tenantScoped: true,
    access: edit,
    params: IterationParams,
    body: IterationBody,
    responses: {
      200: { description: 'Accepted, and the lock extended', schema: IterationAccepted },
      400: {
        description:
          '`content_invalid`: the content is not a document the model accepts; `values_invalid`: a ' +
          'fixed value changed, a value of the wrong type, or a user this environment does not hold',
        schema: EditingRefusal,
      },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: refused,
    },
  },
  cutVersion: {
    operationId: 'cutVersion',
    method: 'POST',
    path: '/v1/components/{id}/versions',
    summary: "Save version: cut a version from the session's latest iteration",
    tenantScoped: true,
    access: edit,
    params: ComponentParams,
    body: CutBody,
    responses: {
      400: {
        description: '`values_invalid`: a fixed value differs from its default at the cut',
        schema: EditingRefusal,
      },
      200: { description: 'Cut, or nothing to cut', schema: CutAnswer },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: refused,
    },
  },
  listIterations: {
    operationId: 'listIterations',
    method: 'GET',
    path: '/v1/components/{id}/iterations',
    summary:
      "The caller's own retained iterations of the component, newest first, while their session holds the lock",
    tenantScoped: true,
    access: edit,
    params: ComponentParams,
    query: IterationListQuery,
    responses: {
      200: { description: 'A page of iterations, with no content', schema: IterationList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: {
        description: 'lock_held or lock_required: the session named does not hold the lock',
        schema: EditingRefusal,
      },
    },
  },
  getIteration: {
    operationId: 'getIteration',
    method: 'GET',
    path: '/v1/components/{id}/iterations/{iteration}',
    summary:
      "One of the caller's own retained iterations, content and values, while their session holds the lock",
    tenantScoped: true,
    access: edit,
    params: SavedIterationParams,
    query: SavedIterationQuery,
    responses: {
      200: { description: 'The iteration, whole', schema: SavedIteration },
      401: unauthenticated,
      403: forbidden,
      404: {
        description:
          "No such component or iteration, or one that is not the caller's own or is no longer kept",
        schema: ErrorBody,
      },
      409: {
        description: 'lock_held or lock_required: the session named does not hold the lock',
        schema: EditingRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
