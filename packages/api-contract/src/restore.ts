import { z } from 'zod';
import { VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { EditingRefusal } from './editing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** An earlier version of a component, by the component's id and the version's. */
export const RestoreParams = z.object({
  id: z.uuid(),
  version: LowercaseUuid.describe('The earlier version to restore'),
});
export type RestoreParams = z.infer<typeof RestoreParams>;

export const RestoreBody = z.strictObject({
  latest: LowercaseUuid.describe(
    'The latest version the restore was previewed against, which must still be the latest',
  ),
});
export type RestoreBody = z.infer<typeof RestoreBody>;

const Failure = z.object({
  code: z.string(),
  field: z.string(),
  rule: z.string(),
  schemas: z.array(z.string()),
  detail: z.string(),
});

/** Why a restore would be refused, as the write would say it (the RS plan, RS-E). */
const RestoreRefusalView = z.object({
  code: z
    .enum(['restore_unreadable', 'restore_locked', 'values_invalid', 'restore_unchanged'])
    .describe(
      'restore_unreadable: the version no longer reads. restore_locked: somebody is editing it, the caller included. values_invalid: a value its field now fixes at another. restore_unchanged: it would make what the latest already is',
    ),
  holder: z
    .object({ id: z.string(), name: z.string().nullable() })
    .optional()
    .describe('restore_locked: who holds the lock'),
  failures: z.array(Failure).optional().describe('values_invalid: each value refused'),
});

/** What restoring a version would make (VER-035), inserting nothing. */
export const RestorationView = z.object({
  component: z.string(),
  from: VersionSummary.describe('The version restored from'),
  latest: VersionSummary.describe('The latest version, which a restore must name'),
  notCarried: z
    .array(
      z.object({
        field: z.string(),
        name: z.string().nullable().describe("The field's name now, or null where none is held"),
        value: z.unknown(),
      }),
    )
    .describe("The version's values its component's fields no longer take, not carried forward"),
  refusals: z.array(RestoreRefusalView).describe('Empty where it may be restored'),
});
export type RestorationView = z.infer<typeof RestorationView>;

export const RestoreAnswer = z.object({
  version: VersionSummary.describe('The new version, restored from the one asked'),
});
export type RestoreAnswer = z.infer<typeof RestoreAnswer>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description:
    'No such component the caller may read, or a version that is not one of its versions',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may read the component but may not edit it',
  schema: ErrorBody,
} as const;
const edit = { check: 'permission', permission: 'edit', target: { artifact: 'id' } } as const;

/** Restoring an earlier version of a component (storage-and-versioning.md; the RS plan, Task 1). */
export const restoreRoutes = {
  previewRestore: {
    operationId: 'previewRestore',
    method: 'GET',
    path: '/v1/components/{id}/versions/{version}/restoration',
    summary: 'What restoring an earlier version would make, and anything refusing it',
    tenantScoped: true,
    access: edit,
    params: RestoreParams,
    responses: {
      200: { description: 'What a restore would make, inserting nothing', schema: RestorationView },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  },
  restoreVersion: {
    operationId: 'restoreVersion',
    method: 'POST',
    path: '/v1/components/{id}/versions/{version}/restore',
    summary: 'Restore an earlier version as a new version naming it',
    tenantScoped: true,
    access: edit,
    params: RestoreParams,
    body: RestoreBody,
    responses: {
      200: { description: 'Restored, as a new version', schema: RestoreAnswer },
      400: {
        description: '`values_invalid`: a value its field now fixes at another',
        schema: EditingRefusal,
      },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: {
        description:
          'restore_locked (naming the holder), restore_unchanged, restore_unreadable, or version_precondition (naming the latest)',
        schema: EditingRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
