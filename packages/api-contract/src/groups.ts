import { z } from 'zod';
import { ComponentListQuery } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const GroupListQuery = z.object({ ...ComponentListQuery.shape });
export type GroupListQuery = z.infer<typeof GroupListQuery>;

export const GroupView = z.object({
  id: z.string(),
  name: z.string(),
  source: z
    .enum(['tenant', 'provider'])
    .describe(
      "tenant: the environment's own, whose members an administrator names. provider: stands for a value the organisation's provider asserts, and its members are whoever signed in last asserting it",
    ),
  providerValue: z
    .string()
    .nullable()
    .describe("The value of the provider's groups claim this group stands for; null for tenant"),
  members: z.array(
    z.object({ id: z.string(), name: z.string().nullable(), email: z.string().nullable() }),
  ),
});
export type GroupView = z.infer<typeof GroupView>;

export const GroupList = z.object({
  items: z.array(GroupView),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
  total: z.number().int().describe('How many groups there are in all, on every page alike'),
});
export type GroupList = z.infer<typeof GroupList>;

export const GroupBody = z.strictObject({
  name: z.string().trim().min(1).max(80).describe('1 to 80 characters, trimmed; unique here'),
  providerValue: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe(
      "Given: the group stands for this value of the provider's groups claim, matched exactly, and its members are the sign-ins' to decide. Absent: the environment's own group",
    ),
});
export type GroupBody = z.infer<typeof GroupBody>;

export const GroupParams = z.object({ id: LowercaseUuid });
export type GroupParams = z.infer<typeof GroupParams>;

export const GroupMembersBody = z.strictObject({
  principals: z
    .array(LowercaseUuid)
    .max(1000)
    .describe('Every member the group is to have: those not named are removed. Each counted once'),
});
export type GroupMembersBody = z.infer<typeof GroupMembersBody>;

export const GroupMade = z.object({ group: GroupView });
export type GroupMade = z.infer<typeof GroupMade>;

export const GroupDeleted = z.object({
  deleted: z.string().describe('The group deleted, with its memberships and every grant it held'),
});
export type GroupDeleted = z.infer<typeof GroupDeleted>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may not administer this environment',
  schema: ErrorBody,
} as const;
const missing = {
  description: 'No such group in this environment',
  schema: ErrorBody,
} as const;

/**
 * Groups (access.md, "Groups and Access, as W12 builds them"): each needs `administer` at the tenant,
 * because a group can hold a grant anywhere in the environment.
 */
export const groupRoutes = {
  listGroups: {
    operationId: 'listGroups',
    method: 'GET',
    path: '/v1/groups',
    summary: 'Every group, with its members, a page at a time',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    query: GroupListQuery,
    responses: {
      200: { description: 'A page of groups', schema: GroupList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
    },
  },
  createGroup: {
    operationId: 'createGroup',
    method: 'POST',
    path: '/v1/groups',
    summary:
      "Make a group: the environment's own, or one standing for a value the provider asserts",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    body: GroupBody,
    responses: {
      200: { description: 'Made, with no members yet', schema: GroupMade },
      401: unauthenticated,
      403: forbidden,
      409: { description: 'group_name_taken or group_value_taken', schema: ErrorBody },
    },
  },
  setGroupMembers: {
    operationId: 'setGroupMembers',
    method: 'PUT',
    path: '/v1/groups/{id}/members',
    summary: "Set the members of one of the environment's own groups",
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'administer',
      target: { tenant: true },
      changesAccess: true,
    },
    params: GroupParams,
    body: GroupMembersBody,
    responses: {
      200: { description: 'Set: the group as it now is', schema: GroupMade },
      401: unauthenticated,
      403: forbidden,
      404: missing,
      409: {
        description:
          'group_from_provider, group_member_missing, grant_external_at_tenant, grant_external_capped or grant_external_past_cap',
        schema: ErrorBody,
      },
    },
  },
  deleteGroup: {
    operationId: 'deleteGroup',
    method: 'DELETE',
    path: '/v1/groups/{id}',
    summary: 'Delete a group, with its memberships and every grant it holds',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'administer',
      target: { tenant: true },
      changesAccess: true,
    },
    params: GroupParams,
    responses: {
      200: { description: 'Deleted', schema: GroupDeleted },
      401: unauthenticated,
      403: forbidden,
      404: missing,
    },
  },
} as const satisfies Record<string, RouteContract>;
