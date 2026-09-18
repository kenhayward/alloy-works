import { outlineOperationSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { CreateComponentBody, SpaceParams, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** A document, by the id its artifact carries - lowercase, unlike `ComponentParams`. */
export const DocumentParams = z.object({ id: LowercaseUuid });
export type DocumentParams = z.infer<typeof DocumentParams>;

/**
 * What creating a document takes: a component's header without its type. Picked from
 * `CreateComponentBody`, not restated, so the language rule is written once for both.
 */
export const CreateDocumentBody = CreateComponentBody.pick({
  title: true,
  language: true,
  direction: true,
});
export type CreateDocumentBody = z.infer<typeof CreateDocumentBody>;

/**
 * One structural act (structure.md, "Editing the outline"): the version the caller read the outline
 * at, and one operation from the domain's closed union - imported, never restated, so the contract and
 * the tree cannot disagree about what an operation is.
 */
export const OutlineOperationBody = z.strictObject({
  openedFrom: LowercaseUuid.describe(
    'The version the outline was read at, which must be the latest',
  ),
  operation: outlineOperationSchema,
});
export type OutlineOperationBody = z.infer<typeof OutlineOperationBody>;

export const DocumentList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      space: z.object({ id: z.string(), name: z.string() }),
      version: z.string().describe('`revision.version` of the latest version'),
    }),
  ),
});
export type DocumentList = z.infer<typeof DocumentList>;

export const DocumentView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  outline: z
    .record(z.string(), z.unknown())
    .describe(
      "The latest version's outline document (structure.md), as the caller is shown it: a reference " +
        'to a component the caller may not read carries `component: null`, and a pinned one ' +
        '`mode.version: null`; everything else is as stored. Empty when the stored outline does not read',
    ),
  mayEdit: z.boolean().describe('Whether the caller may restructure the outline'),
});
export type DocumentView = z.infer<typeof DocumentView>;

/**
 * A structural act refused, in the one error shape: the outline as it now stands when somebody else
 * moved first (`version_precondition`), or why the operation does not apply (`outline_invalid`).
 */
export const OutlineRefusal = ErrorBody.extend({
  current: DocumentView.optional().describe('version_precondition: the document as it now stands'),
  reason: z.string().optional().describe('outline_invalid: why the operation does not apply'),
});
export type OutlineRefusal = z.infer<typeof OutlineRefusal>;

/**
 * A document's numbering (structure.md, "Numbering"), as the caller is shown it: the version it
 * numbers, the scheme, which component version each occurrence resolved to, and the numbering table.
 */
export const NumberingView = z.object({
  document: z.string(),
  version: z.object({ id: z.string(), number: z.string() }),
  scheme: z
    .string()
    .describe('The scheme numbered against, by its id: `default/1` until layouts exist'),
  occurrences: z
    .array(z.object({ node: z.string(), version: z.string().nullable() }))
    .describe(
      'Each component reference, in outline order, and the component version it resolved to: null ' +
        'where the caller may not read the component, where it waits on revisions, or where its ' +
        'content does not read. Its contributions are then not counted, and every number it could ' +
        'have moved is null',
    ),
  entries: z.array(
    z.object({
      node: z.string().describe('The outline node that produced it'),
      block: z.string().nullable().describe('The block or footnote, for a caption or a footnote'),
      sequence: z.string(),
      matter: z.enum(['body', 'appendix']),
      sections: z.array(z.number().int()).describe('The section counter stack at this point'),
      value: z.number().int().nullable().describe("This sequence's counter; null when not known"),
      restartedAt: z.string().nullable().describe('The node that last restarted the counter'),
      number: z.string().nullable(),
      label: z.string().nullable(),
    }),
  ),
});
export type NumberingView = z.infer<typeof NumberingView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such document in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;

/** Creating, finding, opening and restructuring documents (structure.md, "Routes"). */
export const documentRoutes = {
  listDocuments: {
    operationId: 'listDocuments',
    method: 'GET',
    path: '/v1/documents',
    summary: 'The documents the caller may read',
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'The documents', schema: DocumentList },
      401: unauthenticated,
    },
  },
  createDocument: {
    operationId: 'createDocument',
    method: 'POST',
    path: '/v1/spaces/{space}/documents',
    summary: 'Create a document in this space, at version 0.1, with an empty outline',
    tenantScoped: true,
    access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateDocumentBody,
    responses: {
      // 200, not 201, for the reason createComponent gives: a permission-checked handler cannot set
      // a status, so nothing is sent before its transaction commits.
      200: { description: 'Created, at version 0.1', schema: DocumentView },
      400: {
        description: 'The title, language or direction is not one an outline accepts',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not create in it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getDocument: {
    operationId: 'getDocument',
    method: 'GET',
    path: '/v1/documents/{id}',
    summary: 'A document at its latest version, and whether the caller may restructure it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'The document', schema: DocumentView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  getNumbering: {
    operationId: 'getNumbering',
    method: 'GET',
    path: '/v1/documents/{id}/numbering',
    summary: "The latest version's numbering, as the caller is shown it",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'The numbering table', schema: NumberingView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may read is one they may number',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  editOutline: {
    operationId: 'editOutline',
    method: 'POST',
    path: '/v1/documents/{id}/outline',
    summary: 'Apply one operation to the outline, as one version',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: DocumentParams,
    body: OutlineOperationBody,
    responses: {
      200: {
        description: 'Applied, or nothing changed: the document at its latest version',
        schema: DocumentView,
      },
      400: {
        description:
          'outline_invalid: the operation does not apply to the latest outline; or invalid_request: a body this route does not accept',
        schema: OutlineRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not edit it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description: 'version_precondition: the outline has changed since it was read',
        schema: OutlineRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
