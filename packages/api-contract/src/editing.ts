import { z } from 'zod';
import { ComponentParams, Lock, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A uuid, lowercase only. Postgres' `uuid` type returns its canonical form lowercase regardless of the
 * case it was written in, and a session or an opened-from version is compared against that reading in
 * JavaScript - never through Postgres' own case-insensitive equality - so an uppercase one sent back
 * would compare unequal to the very record it names, for as long as the session or the version lasts.
 * Refusing it at the door, rather than downcasing it, keeps what a caller sent and what is stored the
 * same string everywhere this is echoed back (a lock's `session`, a refusal's `holder`).
 */
const LowercaseUuid = z.uuid().regex(LOWERCASE_UUID, 'Expected a lowercase uuid');

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
      400: { description: 'The content is not a document the model accepts', schema: ErrorBody },
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
      200: { description: 'Cut, or nothing to cut', schema: CutAnswer },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: refused,
    },
  },
} as const satisfies Record<string, RouteContract>;
