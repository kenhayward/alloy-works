import { TENANT_STATES } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/** Stopping a tenant, from inside it or from its organisation's (tenant-lifecycle.md, TL-D, TL-L). */

export const SuspensionBody = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe('Why, recorded in the audit log and shown to nobody who is stopped'),
});
export type SuspensionBody = z.infer<typeof SuspensionBody>;

export const Suspended = z.object({
  state: z.literal('suspended').describe('Where it now stands'),
});
export type Suspended = z.infer<typeof Suspended>;

export const OrganisationTenantView = z.object({
  id: z.string().describe('The tenant'),
  name: z.string().describe('Its name'),
  state: z.enum(TENANT_STATES).describe('Where it is in its life'),
  since: z.iso.datetime().describe('When it came to be in this state'),
  closedBy: z
    .enum(['person', 'operator'])
    .nullable()
    .describe("Who began a closure: an organisation may give up only a person's"),
  graceEndsAt: z.iso.datetime().nullable().describe('When a closure can no longer be given up'),
  hostnames: z.array(z.string()).describe('The addresses it answers at'),
});
export type OrganisationTenantView = z.infer<typeof OrganisationTenantView>;

export const OrganisationTenants = z.object({ items: z.array(OrganisationTenantView) });
export type OrganisationTenants = z.infer<typeof OrganisationTenants>;

export const OrganisationTenantParams = z.object({ id: z.string() });
export type OrganisationTenantParams = z.infer<typeof OrganisationTenantParams>;

const ACT = {
  check: 'permission',
  permission: 'suspend_tenant',
  target: { tenant: true },
  credential: 'session',
} as const;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: "`suspend_tenant` is not held at this organisation's tenant",
  schema: ErrorBody,
} as const;
const notFound = { description: 'Not a tenant of this organisation', schema: ErrorBody } as const;
const conflict = {
  description: 'It is not somewhere this can be done from, or the operator began the closure',
  schema: ErrorBody,
} as const;

export const organisationRoutes = {
  suspendEnvironment: {
    operationId: 'suspendEnvironment',
    method: 'POST',
    path: '/v1/suspension',
    summary: 'Stop this environment, for its organisation or the operator to lift',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'suspend_environment',
      target: { tenant: true },
      recentSignIn: 600,
      credential: 'session',
    },
    idempotencyKey: false,
    body: SuspensionBody,
    responses: {
      200: { description: 'Stopped', schema: Suspended },
      401: unauthenticated,
      403: {
        description: '`suspend_environment` is not held, or the sign-in is older than ten minutes',
        schema: ErrorBody,
      },
      409: {
        description: 'No organisation could lift it, or it is not active',
        schema: ErrorBody,
      },
    },
  },
  listOrganisationTenants: {
    operationId: 'listOrganisationTenants',
    method: 'GET',
    path: '/v1/organisation/tenants',
    summary: "This organisation's tenants, as metadata",
    tenantScoped: true,
    organisationTenant: true,
    access: ACT,
    responses: {
      200: { description: 'Its tenants', schema: OrganisationTenants },
      401: unauthenticated,
      403: forbidden,
    },
  },
  suspendOrganisationTenant: {
    operationId: 'suspendOrganisationTenant',
    method: 'POST',
    path: '/v1/organisation/tenants/{id}/suspension',
    summary: "Stop one of this organisation's tenants",
    tenantScoped: true,
    organisationTenant: true,
    access: ACT,
    idempotencyKey: false,
    params: OrganisationTenantParams,
    body: SuspensionBody,
    responses: {
      200: { description: 'Stopped: its tenants as they now stand', schema: OrganisationTenants },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: conflict,
    },
  },
  liftOrganisationSuspension: {
    operationId: 'liftOrganisationSuspension',
    method: 'DELETE',
    path: '/v1/organisation/tenants/{id}/suspension',
    summary: "Start one of this organisation's tenants again",
    tenantScoped: true,
    organisationTenant: true,
    access: ACT,
    idempotencyKey: false,
    params: OrganisationTenantParams,
    responses: {
      200: {
        description: 'Started again: its tenants as they now stand',
        schema: OrganisationTenants,
      },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: conflict,
    },
  },
  cancelOrganisationClosure: {
    operationId: 'cancelOrganisationClosure',
    method: 'DELETE',
    path: '/v1/organisation/tenants/{id}/closure',
    summary: "Give up closing one of this organisation's tenants",
    tenantScoped: true,
    organisationTenant: true,
    access: ACT,
    idempotencyKey: false,
    params: OrganisationTenantParams,
    responses: {
      200: {
        description: 'Back as it was: its tenants as they now stand',
        schema: OrganisationTenants,
      },
      401: unauthenticated,
      403: forbidden,
      404: notFound,
      409: conflict,
    },
  },
} as const satisfies Record<string, RouteContract>;
