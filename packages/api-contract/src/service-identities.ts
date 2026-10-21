import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { nextCursor, pageQuery } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';
import { CreateTokenBody, TokenIssued } from './tokens.js';

/**
 * Service identities (IAM-033; the G8 plan, G8-G and G8-H): principals of their own kind that an
 * administrator makes, grants roles to as to a person, and issues tokens to. Every route takes a
 * session alone, so no token makes a service or mints a service's token.
 */
export const ServiceIdentityParams = z.object({
  id: LowercaseUuid.describe('The service identity'),
});
export type ServiceIdentityParams = z.infer<typeof ServiceIdentityParams>;

const name = z.string().trim().min(1).max(80).describe('1 to 80 characters, trimmed');
const description = z
  .string()
  .trim()
  .max(500)
  .describe('What it is for and who looks after it: at most 500 characters, trimmed');

export const ServiceIdentityView = z.object({
  id: z.string().describe('Its principal, which grants name as they name a person'),
  name: z.string(),
  description: z.string(),
  createdBy: z.string().nullable().describe('The administrator who made it'),
  createdAt: z.string(),
  disabledAt: z
    .string()
    .nullable()
    .describe('When it was disabled, its tokens revoked and no more issued; null while it may act'),
  tokens: z.number().int().describe('Its tokens not yet revoked'),
});
export type ServiceIdentityView = z.infer<typeof ServiceIdentityView>;

export const ServiceIdentityListQuery = z.object(pageQuery);
export type ServiceIdentityListQuery = z.infer<typeof ServiceIdentityListQuery>;

export const ServiceIdentityList = z.object({
  items: z.array(ServiceIdentityView),
  next: nextCursor,
});
export type ServiceIdentityList = z.infer<typeof ServiceIdentityList>;

export const CreateServiceIdentityBody = z.strictObject({
  name,
  description: description.default(''),
});
export type CreateServiceIdentityBody = z.infer<typeof CreateServiceIdentityBody>;

export const ChangeServiceIdentityBody = z.strictObject({
  name: name.optional(),
  description: description.optional(),
});
export type ChangeServiceIdentityBody = z.infer<typeof ChangeServiceIdentityBody>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notAdministering = {
  description:
    'forbidden: the caller may not administer this environment; or token_not_allowed: service identities are managed with a signed-in session, never a token',
  schema: ErrorBody,
} as const;
const missing = {
  description: 'No such service identity in this environment',
  schema: ErrorBody,
} as const;
const ADMINISTER = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
  credential: 'session',
} as const;

export const serviceIdentityRoutes = {
  listServiceIdentities: {
    operationId: 'listServiceIdentities',
    method: 'GET',
    path: '/v1/service-identities',
    summary: "The environment's service identities, a page at a time",
    tenantScoped: true,
    access: ADMINISTER,
    query: ServiceIdentityListQuery,
    responses: {
      200: { description: 'A page of service identities', schema: ServiceIdentityList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: notAdministering,
    },
  },
  createServiceIdentity: {
    operationId: 'createServiceIdentity',
    method: 'POST',
    path: '/v1/service-identities',
    summary: 'Make a service identity: a principal of its own, never a person, with no roles yet',
    tenantScoped: true,
    access: ADMINISTER,
    body: CreateServiceIdentityBody,
    responses: {
      200: { description: 'Made', schema: ServiceIdentityView },
      400: { description: 'invalid_request', schema: ErrorBody },
      401: unauthenticated,
      403: notAdministering,
    },
  },
  changeServiceIdentity: {
    operationId: 'changeServiceIdentity',
    method: 'PATCH',
    path: '/v1/service-identities/{id}',
    summary: 'Rename a service identity or change what it says it is for',
    tenantScoped: true,
    access: ADMINISTER,
    params: ServiceIdentityParams,
    body: ChangeServiceIdentityBody,
    responses: {
      200: { description: 'Changed', schema: ServiceIdentityView },
      400: { description: 'invalid_request', schema: ErrorBody },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
    },
  },
  disableServiceIdentity: {
    operationId: 'disableServiceIdentity',
    method: 'POST',
    path: '/v1/service-identities/{id}/disablement',
    summary: 'Disable a service identity: its tokens are refused at their next request',
    tenantScoped: true,
    access: ADMINISTER,
    params: ServiceIdentityParams,
    responses: {
      200: {
        description: 'Disabled; kept, so what it did still names it',
        schema: ServiceIdentityView,
      },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
    },
  },
  issueServiceIdentityToken: {
    operationId: 'issueServiceIdentityToken',
    method: 'POST',
    path: '/v1/service-identities/{id}/tokens',
    summary:
      'Issue a service identity a token that acts as it, masked to its scopes, until it expires',
    tenantScoped: true,
    access: ADMINISTER,
    params: ServiceIdentityParams,
    body: CreateTokenBody,
    // A kept answer would keep the secret; a retry issues another, which can be revoked.
    idempotencyKey: false,
    responses: {
      200: { description: 'Issued, with its secret, shown this once', schema: TokenIssued },
      400: {
        description:
          'invalid_request, or token_expiry_invalid: an expiry past, or more than 365 days away',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: notAdministering,
      404: missing,
      409: {
        description: 'service_identity_disabled: a disabled service identity is issued nothing',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
