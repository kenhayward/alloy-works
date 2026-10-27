import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * What may be fetched through the service (the R17 plan, R17-E): an output, or the PDF's veraPDF
 * report.
 */
export const SharedOutputFormat = z.enum(['pdf', 'docx', 'html', 'provenance', 'verapdf']);
export type SharedOutputFormat = z.infer<typeof SharedOutputFormat>;

export const ShareParams = z.object({ id: LowercaseUuid, share: LowercaseUuid });
export type ShareParams = z.infer<typeof ShareParams>;

export const SharedOutputParams = z.object({ id: LowercaseUuid, format: SharedOutputFormat });
export type SharedOutputParams = z.infer<typeof SharedOutputParams>;

export const ShareBody = z.strictObject({
  email: z
    .email()
    .max(254)
    .describe(
      'The address of the person outside the organisation to share with; its case is not kept',
    ),
  expiresAt: z.iso
    .datetime({ offset: true })
    .optional()
    .describe(
      "When the share ends: within the environment's cap for access from outside, 90 days unless an administrator set another. Its default, 30 days, where absent",
    ),
});
export type ShareBody = z.infer<typeof ShareBody>;

export const ShareView = z.object({
  id: z.string().describe("The share's id, which is the grant's"),
  recipient: z.object({
    id: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable().describe('Their name, once they have signed in'),
    signedIn: z
      .boolean()
      .describe(
        'Whether they have proved who they are by signing in; until then they read nothing',
      ),
  }),
  expiresAt: z.string(),
  expired: z.boolean(),
  sharedBy: z.object({ id: z.string(), name: z.string().nullable() }),
  sharedAt: z.string(),
  accesses: z
    .array(
      z.object({
        at: z.string(),
        output: SharedOutputFormat.nullable().describe(
          'What was fetched, or null where the publication itself was opened',
        ),
      }),
    )
    .describe('Every access, newest first'),
});
export type ShareView = z.infer<typeof ShareView>;

export const ShareList = z.object({
  shares: z.array(ShareView).describe("The publication's shares, oldest first, expired ones too"),
});
export type ShareList = z.infer<typeof ShareList>;

export const ShareMade = z.object({
  share: ShareView,
  invited: z
    .boolean()
    .describe(
      'true: nobody had signed in with the address, so it was invited; the share opens once they sign in with it',
    ),
});
export type ShareMade = z.infer<typeof ShareMade>;

export const ShareRevoked = z.object({ revoked: z.string().describe('The share revoked') });
export type ShareRevoked = z.infer<typeof ShareRevoked>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

const notFound = {
  description: 'No such publication in this environment, or none the caller may share',
  schema: ErrorBody,
} as const;

export const shareRoutes = {
  listPublicationShares: {
    operationId: 'listPublicationShares',
    method: 'GET',
    path: '/v1/publications/{id}/shares',
    summary: "A publication's shares outside the organisation, each with every access",
    tenantScoped: true,
    access: { check: 'permission', permission: 'publish', target: { publication: 'id' } },
    params: z.object({ id: LowercaseUuid }),
    responses: {
      200: { description: 'The shares', schema: ShareList },
      401: unauthenticated,
      403: { description: 'The caller may not publish its document', schema: ErrorBody },
      404: notFound,
    },
  },
  sharePublication: {
    operationId: 'sharePublication',
    method: 'POST',
    path: '/v1/publications/{id}/shares',
    summary: 'Shares a publication with a named person outside the organisation',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'publish',
      target: { publication: 'id' },
      changesAccess: true,
    },
    params: z.object({ id: LowercaseUuid }),
    body: ShareBody,
    responses: {
      200: { description: 'Shared', schema: ShareMade },
      400: { description: 'An address or an expiry that is not one', schema: ErrorBody },
      401: unauthenticated,
      403: { description: 'The caller may not publish its document', schema: ErrorBody },
      404: notFound,
      409: {
        description:
          'share_member: the address is somebody in the organisation, who reads through their own access; share_duplicate: it is shared with them already; share_expiry_past; share_past_cap: the expiry is past the cap; share_erased: the person was erased',
        schema: ErrorBody,
      },
    },
  },
  revokePublicationShare: {
    operationId: 'revokePublicationShare',
    method: 'DELETE',
    path: '/v1/publications/{id}/shares/{share}',
    summary: 'Revokes a share at once',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'publish',
      target: { publication: 'id' },
      changesAccess: true,
    },
    params: ShareParams,
    responses: {
      200: { description: 'Revoked: they read nothing more of it', schema: ShareRevoked },
      401: unauthenticated,
      403: { description: 'The caller may not publish its document', schema: ErrorBody },
      404: { description: 'No such share of this publication', schema: ErrorBody },
    },
  },
  getSharedOutput: {
    operationId: 'getSharedOutput',
    method: 'GET',
    path: '/v1/publications/{id}/outputs/{format}',
    summary: "A publication's output, through the service, decided at each request",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: SharedOutputParams,
    responses: {
      200: {
        description:
          'The bytes, saved as the publication id and format: decided at each request, so a revoked share fetches nothing more',
        binary: {
          contentTypes: [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/html; charset=utf-8',
            'application/json',
          ],
        },
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a publication the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: {
        description: 'No such publication or output, or none the caller may read',
        schema: ErrorBody,
      },
      503: { description: 'This environment has nowhere to keep documents yet', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
