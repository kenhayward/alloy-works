import { publishFailureCodes } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { DocumentParams } from './documents.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** What publishing takes: the version the caller is looking at, and the formats, `pdf` alone for now. */
export const RequestPublicationBody = z.strictObject({
  version: LowercaseUuid.describe(
    'The document version the caller is publishing, which must be the latest',
  ),
  formats: z
    .array(z.string().min(1))
    .min(1)
    // A format named twice is a malformed request, refused here rather than by the store, which would
    // answer it as a format the template cannot make.
    .refine((formats) => new Set(formats).size === formats.length, {
      message: 'Name each format once',
    })
    .describe(
      'The formats to publish, each once; `pdf` is the only one until a layout declares another',
    ),
});
export type RequestPublicationBody = z.infer<typeof RequestPublicationBody>;

export const PublicationRequestParams = z.object({ id: LowercaseUuid });
export type PublicationRequestParams = z.infer<typeof PublicationRequestParams>;

/** One failure, naming its stage and its place (PUB-086). An unreadable place carries its node alone. */
export const PublishFailureView = z.object({
  stage: z.enum(['resolve', 'compose', 'engine', 'store']),
  code: z.enum(publishFailureCodes),
  node: z.string().nullable().describe('The outline node it concerns'),
  block: z.string().nullable().describe("The block within that node's component"),
  detail: z
    .string()
    .nullable()
    .describe(
      'The kind of block or mark, the style, the language tag, or the character as U+XXXX; null where the place is one the publisher may not read',
    ),
});
export type PublishFailureView = z.infer<typeof PublishFailureView>;

export const PublicationRequestView = z.object({
  id: z.string(),
  document: z.string(),
  state: z.enum(['queued', 'done', 'failed']),
  failures: z.array(PublishFailureView),
  publication: z.string().nullable().describe('The publication it made, once done'),
});
export type PublicationRequestView = z.infer<typeof PublicationRequestView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** Publishing a document, and following the request (publishing.md, "Routes"). */
export const publishingRoutes = {
  requestPublication: {
    operationId: 'requestPublication',
    method: 'POST',
    path: '/v1/documents/{id}/publications',
    summary: 'Publish the latest version of this document',
    tenantScoped: true,
    access: { check: 'permission', permission: 'publish', target: { artifact: 'id' } },
    params: DocumentParams,
    body: RequestPublicationBody,
    responses: {
      // 200, not 202: a permission-checked handler cannot set a status (finding 12).
      200: {
        description: 'Asked for, and queued; follow the request for its outcome',
        schema: PublicationRequestView,
      },
      400: {
        description: '`format_unsupported`: a format the template cannot make',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not publish it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description: '`version_precondition`: the document has a newer version than the one named',
        schema: ErrorBody,
      },
    },
  },
  getPublicationRequest: {
    operationId: 'getPublicationRequest',
    method: 'GET',
    path: '/v1/publication-requests/{id}',
    summary:
      'A publish the caller asked for: its state, every failure, and its publication once made',
    tenantScoped: true,
    access: { check: 'session' },
    params: PublicationRequestParams,
    responses: {
      200: { description: 'The request', schema: PublicationRequestView },
      401: unauthenticated,
      404: { description: 'No such request, or one somebody else asked for', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
