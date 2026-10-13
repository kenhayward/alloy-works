import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { pageQuery } from './listing.js';
import { ErrorBody } from './schemas.js';

/** A component or a document, by the id its artifact carries. */
export const DeletionParams = z.object({ id: z.uuid() });
export type DeletionParams = z.infer<typeof DeletionParams>;

const Named = z.object({ id: z.string(), title: z.string() });

/** Why a deletion is refused (the DL plan, DL-C): every reason, not the first. */
export const DeletionRefusalView = z.object({
  code: z
    .enum([
      'baselined',
      'published',
      'publishing',
      'referenced',
      'held',
      'kept',
      'locked',
      'in_review',
    ])
    .describe(
      'baselined: a baseline pins a version, superseded or not, or is of the document. published: a publication placed a version, or is of the document. publishing: a queued publish or preview places it. referenced: the latest version of a document references it, a deleted document included. held: a legal hold on it or its space. kept: a retention keep has yet to pass, `until` saying when. locked: somebody is editing it, `holder` saying who. in_review: a review round is open on it',
    ),
  named: z
    .array(Named)
    .optional()
    .describe('Each dependant the caller may read, by its title, or a baseline by its name'),
  unreadable: z
    .boolean()
    .optional()
    .describe(
      'Whether something the caller may not read depends on it too: never how many, nor what',
    ),
  holder: z
    .object({ id: z.string(), name: z.string().nullable() })
    .optional()
    .describe('locked: who holds the lock'),
  until: z
    .string()
    .optional()
    .describe(
      'kept: when the longest retention keep reaching it passes, counted from its latest version',
    ),
});
export type DeletionRefusalView = z.infer<typeof DeletionRefusalView>;

/** What deleting it leaves and what refuses it now (LIF-024, VER-047, VER-048). */
export const DeletionView = z.object({
  kind: z.enum(['component', 'document']),
  deleted: z.boolean().describe('Whether it is deleted now'),
  remains: z
    .object({
      versions: z.int().nonnegative(),
      iterations: z.int().nonnegative(),
      threads: z.int().nonnegative(),
      suggestions: z.int().nonnegative(),
      rounds: z.int().nonnegative(),
      events: z.int().nonnegative().describe('Audit events about it'),
    })
    .describe(
      'What stays once deleted, unreachable but kept, and comes back on an undelete: nothing is removed',
    ),
  refusals: z
    .array(DeletionRefusalView)
    .describe('Everything refusing deletion now; empty where it may be deleted, or is deleted'),
});
export type DeletionView = z.infer<typeof DeletionView>;

export const DeletedView = z.object({
  deleted: z.boolean().describe('Whether it is deleted now'),
});
export type DeletedView = z.infer<typeof DeletedView>;

/** A deletion refused: every reason. */
export const DeletionRefused = ErrorBody.extend({
  refusals: z.array(DeletionRefusalView).optional().describe('deletion_refused: every reason'),
});

/** Narrowing the Deleted listing to one kind. */
export const DeletedListQuery = z.object({
  ...pageQuery,
  kind: z
    .enum(['component', 'document'])
    .optional()
    .describe('Only deleted components, or only deleted documents; both when absent'),
});
export type DeletedListQuery = z.infer<typeof DeletedListQuery>;

/** A deleted component or document as the Deleted listing shows it (the DL plan, DL-H). */
export const DeletedItem = z.object({
  id: z.string(),
  kind: z.enum(['component', 'document']),
  title: z.string().describe('Its title at its latest version'),
  space: z.object({ id: z.string(), name: z.string() }),
  deletedBy: z.object({
    id: z.string(),
    name: z
      .string()
      .nullable()
      .describe('Their display name, or address; null where neither is known'),
  }),
  deletedAt: z.string(),
  mayUndelete: z.boolean().describe('Whether the caller may undelete it: retire on it'),
});

export const DeletedList = z.object({
  items: z.array(DeletedItem),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
  total: z.number().int().describe('How many the caller may read are deleted, of the kind asked'),
});
export type DeletedList = z.infer<typeof DeletedList>;

const retire = { check: 'permission', permission: 'retire', target: { artifact: 'id' } } as const;
/** Undelete and what remains reach a deleted one, which every other route answers 410. */
const retireDeleted = { ...retire, readsDeleted: true } as const;

const responses = (kind: 'component' | 'document') =>
  ({
    401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
    403: {
      description: `The caller may read the ${kind} but may not retire it`,
      schema: ErrorBody,
    },
    404: {
      description: `No such ${kind} in this environment, or none the caller may read`,
      schema: ErrorBody,
    },
  }) as const;

const deleting = (kind: 'component' | 'document') =>
  ({
    ...responses(kind),
    200: { description: 'Deleted', schema: DeletedView },
    409: {
      description: 'deletion_refused: something depends on it, every reason listed',
      schema: DeletionRefused,
    },
    410: { description: `artifact_deleted: the ${kind} is deleted already`, schema: ErrorBody },
  }) as const;

const undeleting = (kind: 'component' | 'document') =>
  ({
    ...responses(kind),
    200: { description: 'Undeleted, or not deleted, which changes nothing', schema: DeletedView },
  }) as const;

const remaining = (kind: 'component' | 'document') =>
  ({
    ...responses(kind),
    200: { description: 'What deleting it leaves, and what refuses it', schema: DeletionView },
  }) as const;

/** Deleting and undeleting a component or a document (lifecycle.md; the DL plan, DL-A to DL-F). */
export const deletionRoutes = {
  listDeleted: {
    operationId: 'listDeleted',
    method: 'GET',
    path: '/v1/deleted',
    summary: 'The deleted components and documents the caller may read, a page at a time',
    tenantScoped: true,
    access: { check: 'session' },
    query: DeletedListQuery,
    responses: {
      200: { description: 'A page of the deleted, the latest deleted first', schema: DeletedList },
      400: {
        description:
          'A cursor this listing did not give out, a limit outside 1 to 100, or a kind it does not know',
        schema: ErrorBody,
      },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
    },
  },
  deleteComponent: {
    operationId: 'deleteComponent',
    method: 'POST',
    path: '/v1/components/{id}/delete',
    summary: 'Delete a component',
    tenantScoped: true,
    access: retire,
    params: DeletionParams,
    responses: deleting('component'),
  },
  undeleteComponent: {
    operationId: 'undeleteComponent',
    method: 'POST',
    path: '/v1/components/{id}/undelete',
    summary: 'Undelete a component',
    tenantScoped: true,
    access: retireDeleted,
    params: DeletionParams,
    responses: undeleting('component'),
  },
  getComponentDeletion: {
    operationId: 'getComponentDeletion',
    method: 'GET',
    path: '/v1/components/{id}/deletion',
    summary: 'What deleting a component leaves, and what refuses it',
    tenantScoped: true,
    access: retireDeleted,
    params: DeletionParams,
    responses: remaining('component'),
  },
  deleteDocument: {
    operationId: 'deleteDocument',
    method: 'POST',
    path: '/v1/documents/{id}/delete',
    summary: 'Delete a document',
    tenantScoped: true,
    access: retire,
    params: DeletionParams,
    responses: deleting('document'),
  },
  undeleteDocument: {
    operationId: 'undeleteDocument',
    method: 'POST',
    path: '/v1/documents/{id}/undelete',
    summary: 'Undelete a document',
    tenantScoped: true,
    access: retireDeleted,
    params: DeletionParams,
    responses: undeleting('document'),
  },
  getDocumentDeletion: {
    operationId: 'getDocumentDeletion',
    method: 'GET',
    path: '/v1/documents/{id}/deletion',
    summary: 'What deleting a document leaves, and what refuses it',
    tenantScoped: true,
    access: retireDeleted,
    params: DeletionParams,
    responses: remaining('document'),
  },
} as const satisfies Record<string, RouteContract>;
