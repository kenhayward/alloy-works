import { supportScopes } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { InvitationView } from './invitations.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** The header a support person's content read carries, saying why (ADM-026; support.md). */
export const SUPPORT_READ_HEADER = 'support-read';

export const SupportScope = z
  .enum(supportScopes)
  .describe(
    'diagnostics: Diagnostics and usage alone; metadata: those, and titles, names and states in the spaces named; content: those, and content there, each request carrying a Support-Read header saying why',
  );

export const SupportAccessBody = z.strictObject({
  email: z
    .email()
    .max(254)
    .describe(
      'The address of the person from outside who gives support; invited as such where nobody has signed in with it',
    ),
  scope: SupportScope,
  spaces: z
    .array(LowercaseUuid)
    .max(100)
    .describe(
      'The spaces a metadata or content grant reads, at least one; for diagnostics, the spaces whose documents and queries its reads may name',
    ),
  purpose: z.string().trim().min(1).max(500).describe('Why support needs it, as the log keeps it'),
  expiresAt: z.iso
    .datetime({ offset: true })
    .describe("When it ends: required, and within the environment's cap for access from outside"),
});
export type SupportAccessBody = z.infer<typeof SupportAccessBody>;

const Named = z.object({ id: z.string(), name: z.string().nullable() });

export const SupportAccessView = z.object({
  id: z.string(),
  person: z.object({ id: z.string(), name: z.string().nullable(), email: z.string() }),
  scope: SupportScope,
  spaces: z.array(z.string()),
  purpose: z.string(),
  expiresAt: z.string(),
  grantedBy: Named,
  grantedAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedBy: Named.nullable(),
  active: z
    .boolean()
    .describe(
      "Whether it lets its person in now: not revoked, not expired, and within the environment's cap, which a lowered cap ends",
    ),
});
export type SupportAccessView = z.infer<typeof SupportAccessView>;

export const SupportAccessList = z.object({
  items: z.array(SupportAccessView).describe('Every grant, active and ended, the newest first'),
  active: z.number().int().describe('How many are active now'),
});
export type SupportAccessList = z.infer<typeof SupportAccessList>;

export const SupportAccessGranted = z.object({
  support: SupportAccessView,
  invitation: InvitationView.nullable().describe(
    'The invitation made or renewed for the address, or null where its person has signed in',
  ),
});
export type SupportAccessGranted = z.infer<typeof SupportAccessGranted>;

export const SupportAccessParams = z.object({ id: LowercaseUuid });
export type SupportAccessParams = z.infer<typeof SupportAccessParams>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/**
 * Support access (docs/design/support.md; ADM-022 to ADM-026, ADM-042): granted and revoked through
 * `grant_support`, a person's act, and seen by every administrator.
 */
export const supportRoutes = {
  listSupportAccess: {
    operationId: 'listSupportAccess',
    method: 'GET',
    path: '/v1/support-access',
    summary: 'Every support grant, active and ended',
    tenantScoped: true,
    reads: 'metadata',
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    responses: {
      200: { description: 'Every support grant', schema: SupportAccessList },
      401: unauthenticated,
      403: { description: 'The caller may not administer this environment', schema: ErrorBody },
    },
  },
  grantSupportAccess: {
    operationId: 'grantSupportAccess',
    method: 'POST',
    path: '/v1/support-access',
    summary: 'Lets somebody from outside look, at what and until when',
    tenantScoped: true,
    reads: 'metadata',
    access: {
      check: 'permission',
      permission: 'grant_support',
      target: { tenant: true },
      changesAccess: true,
    },
    body: SupportAccessBody,
    responses: {
      200: { description: 'Granted', schema: SupportAccessGranted },
      400: { description: 'An address, scope or expiry that is not one', schema: ErrorBody },
      401: unauthenticated,
      403: {
        description: 'The caller does not hold grant_support at the environment',
        schema: ErrorBody,
      },
      409: {
        description:
          'support_member: the address is somebody in the organisation; support_erased: the person was erased; support_active: they hold active support already; support_expiry_past; support_past_cap: the expiry is past the cap; support_spaces_required: a metadata or content grant names no space; support_space_missing: a space named is not this environment’s',
        schema: ErrorBody,
      },
    },
  },
  revokeSupportAccess: {
    operationId: 'revokeSupportAccess',
    method: 'DELETE',
    path: '/v1/support-access/{id}',
    summary: 'Ends a support grant at once',
    tenantScoped: true,
    reads: 'metadata',
    access: {
      check: 'permission',
      permission: 'grant_support',
      target: { tenant: true },
      changesAccess: true,
    },
    params: SupportAccessParams,
    responses: {
      200: { description: 'Revoked', schema: SupportAccessView },
      401: unauthenticated,
      403: {
        description: 'The caller does not hold grant_support at the environment',
        schema: ErrorBody,
      },
      404: { description: 'No such support grant in this environment', schema: ErrorBody },
      409: { description: 'support_revoked: it was revoked already', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
