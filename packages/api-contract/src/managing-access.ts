import { z } from 'zod';
import { ComponentListQuery } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid, PermissionName, Target } from './schemas.js';

/** A listing's page, as every listing takes it (API-007). */
const Paging = ComponentListQuery.shape;

export const GrantListQuery = z.object({
  level: Target.describe('The level whose grants are listed: not those above it or below it'),
  ...Paging,
});
export type GrantListQuery = z.infer<typeof GrantListQuery>;

const Named = z.object({ id: z.string(), name: z.string().nullable() });

export const GrantView = z.object({
  id: z.string(),
  role: z.object({ id: z.string(), name: z.string() }),
  subject: z.union([
    z.object({ principal: Named.extend({ email: z.string().nullable() }) }),
    z.object({ group: z.object({ id: z.string(), name: z.string() }) }),
  ]),
  level: z.string().describe('`tenant`, `space:<id>` or `artifact:<id>`'),
  effect: z.enum(['allow', 'deny']),
  expiresAt: z.string().nullable().describe('When it stops conferring anything, or null for never'),
  extends: z.string().nullable().describe('The grant this one replaced by extending it'),
  grantedBy: Named,
  grantedAt: z.string(),
});
export type GrantView = z.infer<typeof GrantView>;

export const GrantList = z.object({
  items: z.array(GrantView),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
});
export type GrantList = z.infer<typeof GrantList>;

export const GrantBody = z.strictObject({
  role: LowercaseUuid.describe('The role granted'),
  subject: z
    .strictObject({ principal: LowercaseUuid })
    .describe('Who it is granted to: a principal. Granting to a group is not offered yet'),
  level: Target.describe('Where it is granted'),
  effect: z.enum(['allow', 'deny']).describe('deny refuses everything the role holds, there'),
});
export type GrantBody = z.infer<typeof GrantBody>;

export const GrantParams = z.object({ id: LowercaseUuid });
export type GrantParams = z.infer<typeof GrantParams>;

export const GrantMade = z.object({ grant: GrantView });
export type GrantMade = z.infer<typeof GrantMade>;

export const GrantRemoved = z.object({ removed: z.string().describe('The grant removed') });
export type GrantRemoved = z.infer<typeof GrantRemoved>;

/**
 * Where the caller manages access. Roles and people are listed to anybody who may administer the level
 * named, since choosing them is what making a grant there needs - not only to an administrator of the
 * whole environment.
 */
const ChoosingFor = z.object({
  level: Target.describe('A level the caller administers, at it or above: where they are granting'),
  ...Paging,
});

export const RoleListQuery = ChoosingFor;
export type RoleListQuery = z.infer<typeof RoleListQuery>;

export const RoleList = z.object({
  items: z.array(
    z.object({ id: z.string(), name: z.string(), permissions: z.array(PermissionName) }),
  ),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
});
export type RoleList = z.infer<typeof RoleList>;

export const PrincipalListQuery = ChoosingFor;
export type PrincipalListQuery = z.infer<typeof PrincipalListQuery>;

export const PrincipalList = z.object({
  items: z.array(
    Named.extend({
      email: z.string().nullable(),
      kind: z
        .enum(['user', 'service', 'external'])
        .describe('external: from outside the organisation, and held to the external rules'),
      invited: z.boolean().describe('Invited by address, and not yet signed in'),
    }),
  ),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
});
export type PrincipalList = z.infer<typeof PrincipalList>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such level or grant in this environment, or none the caller may see',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may read the level but may not administer it, or anything above it',
  schema: ErrorBody,
} as const;

/**
 * Managing access (access.md, "Routes"): grants at one level, each needing `administer` at that level
 * or above - asked of each level on the chain as its own walk.
 */
export const managingAccessRoutes = {
  listGrants: {
    operationId: 'listGrants',
    method: 'GET',
    path: '/v1/grants',
    summary: 'The grants made at one level, a page at a time',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { query: 'level' } },
    query: GrantListQuery,
    responses: {
      200: { description: 'A page of grants', schema: GrantList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  },
  listRoles: {
    operationId: 'listRoles',
    method: 'GET',
    path: '/v1/roles',
    summary: 'The roles a grant can name, with what each holds, a page at a time',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { query: 'level' } },
    query: RoleListQuery,
    responses: {
      200: { description: 'A page of roles', schema: RoleList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  },
  listPrincipals: {
    operationId: 'listPrincipals',
    method: 'GET',
    path: '/v1/principals',
    summary: 'The people a grant can name: everybody who has signed in or been invited',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { query: 'level' } },
    query: PrincipalListQuery,
    responses: {
      200: { description: 'A page of people', schema: PrincipalList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
    },
  },
  makeGrant: {
    operationId: 'makeGrant',
    method: 'POST',
    path: '/v1/grants',
    summary: 'Grant a role to a person at one level, as an allow or a denial',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'administer',
      target: { body: 'level' },
      changesAccess: true,
    },
    body: GrantBody,
    responses: {
      200: { description: 'Granted', schema: GrantMade },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: {
        description:
          'grant_duplicate, grant_allow_without_read, grant_administer_denied_at_tenant, grant_role_missing, grant_subject_missing, grant_external_at_tenant, grant_external_capped or grant_external_past_cap',
        schema: ErrorBody,
      },
    },
  },
  removeGrant: {
    operationId: 'removeGrant',
    method: 'DELETE',
    path: '/v1/grants/{id}',
    summary: 'Remove a grant, unless it is the last that keeps this environment administered',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'administer',
      target: { grant: 'id' },
      changesAccess: true,
    },
    params: GrantParams,
    responses: {
      200: { description: 'Removed', schema: GrantRemoved },
      401: unauthenticated,
      // No 403: a grant is an administrator's to see (access.md, "Refusing"), so one the caller may
      // not manage is always answered as absent, whether or not they may read the level it was made
      // at - the caller's own targetOf/authorise never produces a 403 for a `{ grant }` target.
      404: notFound,
      409: { description: 'grant_last_administrator', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
