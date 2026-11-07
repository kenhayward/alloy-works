import { TENANT_STATES } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';
import { SignInSettings } from './sign-in-settings.js';

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
  suspendedBy: z
    .enum(['person', 'operator'])
    .nullable()
    .describe('Who stopped it: an organisation may start only what a person stopped'),
  closedBy: z
    .enum(['person', 'operator'])
    .nullable()
    .describe("Who began a closure: an organisation may give up only a person's"),
  graceEndsAt: z.iso.datetime().nullable().describe('When a closure can no longer be given up'),
  hostnames: z.array(z.string()).describe('The addresses it answers at'),
});
export type OrganisationTenantView = z.infer<typeof OrganisationTenantView>;

export const OrganisationTenantRequest = z.object({
  id: z.string().describe('The tenant it will be'),
  name: z.string().describe('Its name'),
  hostname: z.string().describe('The address it will answer at'),
  state: z
    .enum(['waiting', 'failed'])
    .describe('Being made, or could not be: the operator can see why'),
  createdAt: z.iso.datetime().describe('When it was asked for'),
});
export type OrganisationTenantRequest = z.infer<typeof OrganisationTenantRequest>;

export const OrganisationTenants = z.object({
  items: z.array(OrganisationTenantView),
  requests: z
    .array(OrganisationTenantRequest)
    .describe("Tenants asked for and not made: never the first administrator's address"),
  hostnameSuffix: z
    .string()
    .nullable()
    .describe("What a new tenant's address ends in; none means the operator has yet to say"),
});
export type OrganisationTenants = z.infer<typeof OrganisationTenants>;

export const NewTenantBody = z.strictObject({
  name: z.string().trim().min(1).max(80).describe('What it is called'),
  label: z
    .string()
    .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
    .describe("What comes before the organisation's suffix in its address"),
  firstAdministrator: z
    .email()
    .max(320)
    .describe('Who is invited to administer it: forgotten here once the invitation exists'),
});
export type NewTenantBody = z.infer<typeof NewTenantBody>;

export const SharedBody = z.strictObject({
  shared: z.boolean().describe("Whether this organisation's tenants have a copy kept current"),
});
export type SharedBody = z.infer<typeof SharedBody>;

export const OrganisationTenantParams = z.object({ id: z.string() });
export type OrganisationTenantParams = z.infer<typeof OrganisationTenantParams>;

const ACT = {
  check: 'permission',
  permission: 'suspend_tenant',
  target: { tenant: true },
  credential: 'session',
} as const;

/** What stops a tenant or gives up its closure asks for what the same act inside one does. */
const ACT_RECENTLY = { ...ACT, recentSignIn: 600 } as const;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description:
    "`suspend_tenant` is not held at this organisation's tenant, or the sign-in is too old",
  schema: ErrorBody,
} as const;
const notFound = { description: 'Not a tenant of this organisation', schema: ErrorBody } as const;
const conflict = {
  description:
    'It is not somewhere this can be done from, or the operator stopped it or began the closure',
  schema: ErrorBody,
} as const;

export const organisationRoutes = {
  suspendEnvironment: {
    operationId: 'suspendEnvironment',
    method: 'POST',
    path: '/v1/suspension',
    summary: 'Stop this environment, for its organisation or the operator to lift',
    tenantScoped: true,
    reads: 'metadata',
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
    reads: 'metadata',
    access: ACT,
    responses: {
      200: { description: 'Its tenants', schema: OrganisationTenants },
      401: unauthenticated,
      403: forbidden,
    },
  },
  createOrganisationTenant: {
    operationId: 'createOrganisationTenant',
    method: 'POST',
    path: '/v1/organisation/tenants',
    summary: 'Ask for another tenant for this organisation',
    tenantScoped: true,
    organisationTenant: true,
    reads: 'metadata',
    access: {
      check: 'permission',
      permission: 'create_tenant',
      target: { tenant: true },
      credential: 'session',
      recentSignIn: 600,
    },
    idempotencyKey: false,
    body: NewTenantBody,
    responses: {
      200: { description: 'Asked for: its tenants as they now stand', schema: OrganisationTenants },
      401: unauthenticated,
      403: {
        description:
          "`create_tenant` is not held at this organisation's tenant, or the sign-in is too old",
        schema: ErrorBody,
      },
      409: {
        description:
          'No provider is shared for its first administrator to sign in through, the address is taken, or this organisation has no addresses yet',
        schema: ErrorBody,
      },
    },
  },
  shareProvider: {
    operationId: 'shareProvider',
    method: 'PUT',
    path: '/v1/organisation/providers/{id}/shared',
    summary: "Share one of the organisation's identity providers with its tenants, or stop",
    tenantScoped: true,
    organisationTenant: true,
    reads: 'metadata',
    access: {
      check: 'permission',
      permission: 'share_provider',
      target: { tenant: true },
      credential: 'session',
      recentSignIn: 600,
    },
    idempotencyKey: false,
    params: OrganisationTenantParams,
    body: SharedBody,
    responses: {
      200: { description: 'Marked: what is configured now', schema: SignInSettings },
      401: unauthenticated,
      403: {
        description:
          "`share_provider` is not held at this organisation's tenant, or the sign-in is too old",
        schema: ErrorBody,
      },
      404: { description: 'No such open provider here', schema: ErrorBody },
    },
  },
  suspendOrganisationTenant: {
    operationId: 'suspendOrganisationTenant',
    method: 'POST',
    path: '/v1/organisation/tenants/{id}/suspension',
    summary: "Stop one of this organisation's tenants",
    tenantScoped: true,
    organisationTenant: true,
    reads: 'metadata',
    access: ACT_RECENTLY,
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
    reads: 'metadata',
    access: ACT_RECENTLY,
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
    reads: 'metadata',
    access: ACT_RECENTLY,
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
