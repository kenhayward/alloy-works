import { z } from 'zod';
import { ComponentListQuery } from './components.js';
import type { RouteContract } from './contract.js';
import { LowercaseUuid } from './editing.js';
import { ErrorBody } from './schemas.js';

export const InvitationListQuery = z.object({ ...ComponentListQuery.shape });
export type InvitationListQuery = z.infer<typeof InvitationListQuery>;

export const InvitationView = z.object({
  id: z.string(),
  email: z.string().describe('The address invited, in lower case'),
  person: z
    .string()
    .describe(
      'The principal the invitation made: a grant names it, and its first sign-in becomes it',
    ),
  external: z.boolean().describe('Invited as somebody from outside the organisation'),
  invitedBy: z
    .object({ id: z.string(), name: z.string().nullable() })
    .nullable()
    .describe('Null for an invitation made by whoever provisioned the environment'),
  createdAt: z.string(),
  expiresAt: z.string().nullable().describe('When it can no longer be accepted, or null for never'),
  lapsed: z.boolean().describe('Waiting, and past its expiry: nobody can accept it until renewed'),
  acceptedAt: z.string().nullable(),
  acceptedThrough: z.enum(['organisation', 'google']).nullable(),
});
export type InvitationView = z.infer<typeof InvitationView>;

export const InvitationList = z.object({
  items: z.array(InvitationView),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
});
export type InvitationList = z.infer<typeof InvitationList>;

export const InvitationBody = z.strictObject({
  email: z.email().max(254).describe('The address to invite; its case is not kept'),
  external: z
    .boolean()
    .optional()
    .describe(
      'true: from outside the organisation, and held to the external rules. false if absent',
    ),
});
export type InvitationBody = z.infer<typeof InvitationBody>;

export const InvitationParams = z.object({ id: LowercaseUuid });
export type InvitationParams = z.infer<typeof InvitationParams>;

export const InvitationMade = z.object({
  invitation: InvitationView,
  renewed: z
    .boolean()
    .describe('true: an invitation already waited for the address, and was renewed'),
});
export type InvitationMade = z.infer<typeof InvitationMade>;

export const InvitationWithdrawn = z.object({
  withdrawn: z.string().describe('The invitation withdrawn, with its person and their grants'),
});
export type InvitationWithdrawn = z.infer<typeof InvitationWithdrawn>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may not administer this environment',
  schema: ErrorBody,
} as const;

/**
 * Inviting somebody by address, before they sign in (access.md, "Invitations"): each needs
 * `administer` at the tenant, because an invitation adds a person to the whole environment and, through
 * Google, admits them to it.
 */
export const invitationRoutes = {
  listInvitations: {
    operationId: 'listInvitations',
    method: 'GET',
    path: '/v1/invitations',
    summary: 'Every invitation, waiting or accepted, a page at a time',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    query: InvitationListQuery,
    responses: {
      200: { description: 'A page of invitations', schema: InvitationList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
    },
  },
  invite: {
    operationId: 'invite',
    method: 'POST',
    path: '/v1/invitations',
    summary: 'Invite an address, so the person can be granted access before they first sign in',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    body: InvitationBody,
    responses: {
      200: { description: 'Invited, or the waiting invitation renewed', schema: InvitationMade },
      401: unauthenticated,
      403: forbidden,
      409: { description: 'invitation_signed_in or invitation_kind_differs', schema: ErrorBody },
    },
  },
  withdrawInvitation: {
    operationId: 'withdrawInvitation',
    method: 'DELETE',
    path: '/v1/invitations/{id}',
    summary: 'Withdraw an invitation nobody has accepted, with its person and their grants',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'administer',
      target: { tenant: true },
      changesAccess: true,
    },
    params: InvitationParams,
    responses: {
      200: { description: 'Withdrawn', schema: InvitationWithdrawn },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'No such invitation in this environment', schema: ErrorBody },
      409: { description: 'invitation_accepted', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
