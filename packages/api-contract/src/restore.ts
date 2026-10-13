import { z } from 'zod';
import { UnitChangeView } from './comparison.js';
import { ComponentVersionList, PageQuery, VersionSummary } from './components.js';
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
    .enum([
      'restore_unreadable',
      'restore_locked',
      'values_invalid',
      'restore_unchanged',
      'content_invalid',
      'definition_unreadable',
    ])
    .describe(
      "restore_unreadable: the version no longer reads. restore_locked: somebody is editing it, the caller included. values_invalid: a value its field now fixes at another. restore_unchanged: it would make what the latest already is. content_invalid and definition_unreadable: a save's checks on its content refuse it, the second where a bound table names a column of a query definition the caller may not read that the latest does not name",
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
  changed: z
    .array(
      z.object({
        field: z.string(),
        name: z.string().nullable().describe("The field's name now, or null where none is held"),
        latest: z.unknown().optional().describe("The latest's value, absent where it holds none"),
        restored: z
          .unknown()
          .optional()
          .describe('The value the restore would hold, absent where it would hold none'),
      }),
    )
    .describe("Each value the restore would hold, carried forward, otherwise than the latest's"),
  refusals: z.array(RestoreRefusalView).describe('Empty where it may be restored'),
});
export type RestorationView = z.infer<typeof RestorationView>;

export const RestoreAnswer = z.object({
  version: VersionSummary.describe('The new version, restored from the one asked'),
});
export type RestoreAnswer = z.infer<typeof RestoreAnswer>;

/** Why a document's restore would be refused, as the write would say it (the RS plan, RS-F). */
const DocumentRestoreRefusalView = z.object({
  code: z
    .enum([
      'restore_unreadable',
      'restore_unchanged',
      'outline_invalid',
      'values_invalid',
      'values_unresolved',
      'reference_deleted',
    ])
    .describe(
      "restore_unreadable: the version no longer reads. restore_unchanged: it would make what the latest already is. outline_invalid: the outline's own guards refuse it, `reason` saying which. values_invalid: a value its field no longer takes. values_unresolved: the template no longer resolves to check its values. reference_deleted: a reference to a component since deleted, one for each, `node` and `title` saying which",
    ),
  reason: z.string().optional().describe('outline_invalid: why, in words'),
  node: z.string().optional().describe('reference_deleted: the reference, by its node'),
  title: z.string().optional().describe("reference_deleted: the component's last title"),
  failures: z.array(Failure).optional().describe('values_invalid: each value refused'),
  unresolved: z
    .array(z.unknown())
    .optional()
    .describe('values_unresolved: what the template names that no longer resolves'),
});

/**
 * What restoring a document's version would make (VER-035), inserting nothing: its outline compared
 * with the latest's, a component the caller may not read withheld on both sides.
 */
export const DocumentRestorationView = z.object({
  document: z.string(),
  from: VersionSummary.describe('The version restored from'),
  latest: VersionSummary.describe('The latest version, which a restore must name'),
  older: z.record(z.string(), z.unknown()).describe("The latest version's outline, withheld"),
  newer: z.record(z.string(), z.unknown()).describe('The outline the restore would make, withheld'),
  structure: z.array(UnitChangeView).describe('What the restore would change from the latest'),
  titles: z
    .object({
      older: z.array(z.object({ node: z.string(), title: z.string() })),
      newer: z.array(z.object({ node: z.string(), title: z.string() })),
    })
    .describe(
      'Each reference the caller may read, on each side, by the title of the component version it places there',
    ),
  refusals: z.array(DocumentRestoreRefusalView).describe('Empty where it may be restored'),
});
export type DocumentRestorationView = z.infer<typeof DocumentRestorationView>;

/** A document's restore refused: `editOutline`'s members beside the version chain's. */
const DocumentRestoreRefusal = EditingRefusal.extend({
  reason: z.string().optional().describe('outline_invalid: why, in words'),
  node: z.string().optional().describe('reference_deleted: the reference, by its node'),
  title: z.string().optional().describe("reference_deleted: the component's last title"),
  unresolved: z
    .array(z.unknown())
    .optional()
    .describe('values_unresolved: what the template names that no longer resolves'),
});

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
const documentNotFound = {
  description: 'No such document the caller may read, or a version that is not one of its versions',
  schema: ErrorBody,
} as const;
const documentForbidden = {
  description: 'The caller may read the document but may not edit it',
  schema: ErrorBody,
} as const;
const edit = { check: 'permission', permission: 'edit', target: { artifact: 'id' } } as const;

/**
 * Restoring an earlier version of a component or a document, and a document's versions
 * (storage-and-versioning.md; the RS plan).
 */
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
        description:
          "values_invalid: a value its field now fixes at another. content_invalid: a save's checks on its content refuse it",
        schema: EditingRefusal,
      },
      401: unauthenticated,
      403: {
        description:
          'The caller may read the component but may not edit it; or definition_unreadable: a bound table names a column of a query definition the caller may not read that the latest does not name',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description:
          'restore_locked (naming the holder), restore_unchanged, restore_unreadable, or version_precondition (naming the latest)',
        schema: EditingRefusal,
      },
    },
  },
  listDocumentVersions: {
    operationId: 'listDocumentVersions',
    method: 'GET',
    path: '/v1/documents/{id}/versions',
    summary: "A document's versions, newest first, a page at a time",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: z.object({ id: z.uuid() }),
    query: PageQuery,
    responses: {
      200: { description: 'A page of its versions, newest first', schema: ComponentVersionList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description:
          'Never answered: a document the caller may read is one whose versions they may read',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  previewDocumentRestore: {
    operationId: 'previewDocumentRestore',
    method: 'GET',
    path: '/v1/documents/{id}/versions/{version}/restoration',
    summary: "What restoring a document's earlier version would make, and anything refusing it",
    tenantScoped: true,
    access: edit,
    params: RestoreParams,
    responses: {
      200: {
        description: 'What a restore would make, inserting nothing',
        schema: DocumentRestorationView,
      },
      401: unauthenticated,
      403: documentForbidden,
      404: documentNotFound,
    },
  },
  restoreDocumentVersion: {
    operationId: 'restoreDocumentVersion',
    method: 'POST',
    path: '/v1/documents/{id}/versions/{version}/restore',
    summary: "Restore a document's earlier version as a new version naming it",
    tenantScoped: true,
    access: edit,
    params: RestoreParams,
    body: RestoreBody,
    responses: {
      200: { description: 'Restored, as a new version', schema: RestoreAnswer },
      400: {
        description:
          "outline_invalid (with its reason), values_invalid or values_unresolved: the outline's own guards",
        schema: DocumentRestoreRefusal,
      },
      401: unauthenticated,
      403: documentForbidden,
      404: documentNotFound,
      409: {
        description:
          'restore_unchanged, restore_unreadable, or version_precondition (naming the latest)',
        schema: DocumentRestoreRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
