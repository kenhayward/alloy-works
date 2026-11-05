import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';
import { TokenIssued } from './tokens.js';

const unauthenticated = { description: 'There is no live session or token', schema: ErrorBody };
const forbidden = {
  description: 'The permission this needs is not held at the environment',
  schema: ErrorBody,
};

const ProviderName = z.string().trim().min(1).max(80).describe('Shown on the sign-in page');
const GroupsClaim = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .describe("The ID token claim carrying the provider's group values");
const ClientSecret = z
  .string()
  .min(1)
  .max(2000)
  .describe('The client secret: sealed as it arrives, and never returned');

const ScimClaim = z
  .enum(['sub', 'oid'])
  .describe("The ID token claim equal to SCIM's externalId: sub (Okta) or oid (Entra ID)");

export const ScimOnBody = z.strictObject({ claim: ScimClaim });
export type ScimOnBody = z.infer<typeof ScimOnBody>;

export const ProviderParams = z.object({ id: LowercaseUuid });
export type ProviderParams = z.infer<typeof ProviderParams>;
export const PrincipalParams = z.object({ id: LowercaseUuid });
export type PrincipalParams = z.infer<typeof PrincipalParams>;

export const ProviderBody = z.strictObject({
  name: ProviderName,
  issuer: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .describe('The OpenID Connect issuer, as its tokens name it'),
  clientId: z.string().trim().min(1).max(500).describe("This environment's client at the issuer"),
  clientSecret: ClientSecret,
  groupsClaim: GroupsClaim.optional(),
  scimClaim: ScimClaim.optional(),
});
export type ProviderBody = z.infer<typeof ProviderBody>;

export const ProviderChangeBody = z.strictObject({
  name: ProviderName,
  groupsClaim: GroupsClaim.optional(),
});
export type ProviderChangeBody = z.infer<typeof ProviderChangeBody>;

export const ProviderSecretBody = z.strictObject({ clientSecret: ClientSecret });
export type ProviderSecretBody = z.infer<typeof ProviderSecretBody>;

export const GoogleSettingsBody = z.strictObject({
  open: z.boolean().describe('Whether people may sign in with Google'),
  domains: z
    .array(z.string().trim().toLowerCase().min(1).max(253))
    .max(100)
    .describe('The Workspace domains admitted without an invitation; invited addresses always are'),
});
export type GoogleSettingsBody = z.infer<typeof GoogleSettingsBody>;

export const SessionSettingsBody = z.strictObject({
  idleMinutes: z
    .number()
    .int()
    .min(5)
    .max(1440)
    .describe('The minutes a session lasts unused, from 5 to 1,440'),
  absoluteHours: z
    .number()
    .int()
    .min(1)
    .max(720)
    .describe('The hours a session lasts at most, from 1 to 720'),
});
export type SessionSettingsBody = z.infer<typeof SessionSettingsBody>;

export const SignInSettings = z.object({
  sharing: z
    .boolean()
    .describe("Whether this is an organisation's tenant, which can share a provider"),
  providers: z
    .array(
      z.object({
        id: LowercaseUuid,
        name: z.string(),
        issuer: z.string(),
        clientId: z.string(),
        groupsClaim: z.string(),
        closed: z.boolean().describe('Closed: it signs nobody in'),
        shared: z.boolean().describe("Copied into this organisation's tenants, and kept current"),
        managed: z
          .boolean()
          .describe("A copy of the organisation's: it can be closed here, not edited"),
        scim: z.object({
          on: z.boolean().describe('It provisions: it admits only those it pushed'),
          claim: ScimClaim,
          lastUsedAt: z.string().nullable().describe('When its token was last used'),
        }),
      }),
    )
    .describe('Every provider, the open before the closed. A client secret is never here'),
  google: z.object({
    available: z.boolean().describe('Whether this service holds a Google client at all'),
    open: z.boolean(),
    domains: z.array(z.string()),
  }),
  sessions: z.object({ idleMinutes: z.number().int(), absoluteHours: z.number().int() }),
  redirectUri: z.string().describe('The address to register at each provider'),
  scimUrl: z.string().describe('The SCIM base address to give a provider that provisions'),
  recentSignIn: z
    .boolean()
    .describe('Whether this session authenticated recently enough to change any of this'),
  signedInThrough: z
    .object({
      route: z.enum(['organisation', 'google']),
      provider: LowercaseUuid.nullable(),
    })
    .nullable()
    .describe('The way in of the session asking, which it may not close; null for a token'),
});
export type SignInSettings = z.infer<typeof SignInSettings>;

export const PersonDisablement = z.object({ id: LowercaseUuid, disabled: z.boolean() });
export type PersonDisablement = z.infer<typeof PersonDisablement>;

const notFoundProvider = { description: 'There is no such provider', schema: ErrorBody };
const reauthentication = {
  description:
    'forbidden: the permission this needs is not held; or reauthentication_required: the session last authenticated too long ago, or this is a token',
  schema: ErrorBody,
};
/** Every change here needs a sign-in in the last ten minutes (identity.md, IN-D). */
const CHANGING = {
  check: 'permission',
  permission: 'configure_services',
  target: { tenant: true },
  recentSignIn: 600,
} as const;
/** And what could leave nobody able to sign in decides under the epoch it counts by (IN-B). */
const CLOSING = { ...CHANGING, changesAccess: true } as const;

export const signInSettingsRoutes = {
  getSignInSettings: {
    operationId: 'getSignInSettings',
    organisationTenant: true,
    method: 'GET',
    path: '/v1/sign-in-settings',
    summary: 'How people sign in to this environment: its providers, Google and session lifetimes',
    tenantScoped: true,
    access: { check: 'permission', permission: 'configure_services', target: { tenant: true } },
    responses: {
      200: { description: 'What is configured, never a secret', schema: SignInSettings },
      401: unauthenticated,
      403: forbidden,
    },
  },
  addProvider: {
    operationId: 'addProvider',
    organisationTenant: true,
    method: 'POST',
    path: '/v1/sign-in-settings/providers',
    summary: 'Add an identity provider, or open one of the same issuer closed before',
    tenantScoped: true,
    access: CHANGING,
    body: ProviderBody,
    idempotencyKey: false,
    responses: {
      200: { description: 'Added', schema: SignInSettings },
      401: unauthenticated,
      403: reauthentication,
      409: { description: 'provider_name_taken or provider_issuer_taken', schema: ErrorBody },
    },
  },
  changeProvider: {
    operationId: 'changeProvider',
    organisationTenant: true,
    method: 'PUT',
    path: '/v1/sign-in-settings/providers/{id}',
    summary: 'Rename an identity provider, or change the claim its groups come in',
    tenantScoped: true,
    access: CHANGING,
    params: ProviderParams,
    body: ProviderChangeBody,
    responses: {
      200: { description: 'Changed', schema: SignInSettings },
      401: unauthenticated,
      403: reauthentication,
      404: notFoundProvider,
      409: { description: 'provider_name_taken', schema: ErrorBody },
    },
  },
  replaceProviderSecret: {
    operationId: 'replaceProviderSecret',
    organisationTenant: true,
    method: 'PUT',
    path: '/v1/sign-in-settings/providers/{id}/secret',
    summary: "Replace an open identity provider's client secret",
    tenantScoped: true,
    access: { ...CHANGING, permission: 'rotate_secrets' },
    params: ProviderParams,
    body: ProviderSecretBody,
    idempotencyKey: false,
    responses: {
      200: { description: 'Replaced', schema: SignInSettings },
      401: unauthenticated,
      403: reauthentication,
      404: notFoundProvider,
    },
  },
  closeProvider: {
    operationId: 'closeProvider',
    organisationTenant: true,
    method: 'POST',
    path: '/v1/sign-in-settings/providers/{id}/closure',
    summary: 'Close an identity provider, ending its sessions and its people’s tokens',
    tenantScoped: true,
    access: CLOSING,
    params: ProviderParams,
    responses: {
      200: { description: 'Closed, or closed already', schema: SignInSettings },
      401: unauthenticated,
      403: reauthentication,
      404: notFoundProvider,
      409: { description: 'last_way_in or provider_own_session', schema: ErrorBody },
    },
  },
  turnScimOn: {
    operationId: 'turnScimOn',
    organisationTenant: true,
    method: 'POST',
    path: '/v1/sign-in-settings/providers/{id}/scim',
    summary: 'Have an identity provider provision people and groups by SCIM',
    tenantScoped: true,
    access: CHANGING,
    params: ProviderParams,
    body: ScimOnBody,
    responses: {
      200: { description: 'On', schema: SignInSettings },
      401: unauthenticated,
      403: reauthentication,
      404: notFoundProvider,
    },
  },
  turnScimOff: {
    operationId: 'turnScimOff',
    organisationTenant: true,
    method: 'DELETE',
    path: '/v1/sign-in-settings/providers/{id}/scim',
    summary: 'Stop an identity provider provisioning, ending its token',
    tenantScoped: true,
    access: CHANGING,
    params: ProviderParams,
    responses: {
      200: { description: 'Off', schema: SignInSettings },
      401: unauthenticated,
      403: reauthentication,
      404: notFoundProvider,
    },
  },
  issueScimToken: {
    operationId: 'issueScimToken',
    organisationTenant: true,
    method: 'POST',
    path: '/v1/sign-in-settings/providers/{id}/scim/token',
    summary: "Make a provider's SCIM token, shown this once, ending any before it",
    tenantScoped: true,
    access: { ...CHANGING, permission: 'rotate_secrets' },
    params: ProviderParams,
    body: z.strictObject({}),
    idempotencyKey: false,
    responses: {
      200: { description: 'The token, shown this once', schema: TokenIssued },
      401: unauthenticated,
      403: reauthentication,
      404: notFoundProvider,
      409: { description: 'scim_off: it does not provision', schema: ErrorBody },
    },
  },
  setGoogleSignIn: {
    operationId: 'setGoogleSignIn',
    organisationTenant: true,
    method: 'PUT',
    path: '/v1/sign-in-settings/google',
    summary: 'Open or close the Google route, and set the Workspace domains it admits',
    tenantScoped: true,
    access: CLOSING,
    body: GoogleSettingsBody,
    responses: {
      200: { description: 'Set', schema: SignInSettings },
      401: unauthenticated,
      403: reauthentication,
      409: {
        description: 'last_way_in, provider_own_session or google_unavailable',
        schema: ErrorBody,
      },
    },
  },
  setSessionSettings: {
    operationId: 'setSessionSettings',
    organisationTenant: true,
    method: 'PUT',
    path: '/v1/sign-in-settings/sessions',
    summary: 'Set how long a session lasts; a shortening reaches open sessions at once',
    tenantScoped: true,
    access: CHANGING,
    body: SessionSettingsBody,
    responses: {
      200: { description: 'Set', schema: SignInSettings },
      401: unauthenticated,
      403: reauthentication,
    },
  },
  disablePerson: {
    operationId: 'disablePerson',
    organisationTenant: true,
    method: 'POST',
    path: '/v1/principals/{id}/disablement',
    summary: 'Disable a person: their sessions and tokens end at once, and they sign in no more',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'administer',
      target: { tenant: true },
      changesAccess: true,
    },
    params: PrincipalParams,
    responses: {
      200: { description: 'Disabled, or disabled already', schema: PersonDisablement },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'There is no such person', schema: ErrorBody },
      409: {
        description:
          'last_way_in, principal_last_holder, principal_own_account, principal_service or principal_erased',
        schema: ErrorBody,
      },
    },
  },
  enablePerson: {
    operationId: 'enablePerson',
    organisationTenant: true,
    method: 'DELETE',
    path: '/v1/principals/{id}/disablement',
    summary: 'Enable a person disabled; what ended stays ended',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    params: PrincipalParams,
    responses: {
      200: { description: 'Enabled, or enabled already', schema: PersonDisablement },
      401: unauthenticated,
      403: {
        description:
          'The caller may not administer here, or grant_beyond_held: this gives an administrative permission they do not hold, which the message names',
        schema: ErrorBody,
      },
      404: { description: 'There is no such person', schema: ErrorBody },
      409: { description: 'principal_service or principal_erased', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
