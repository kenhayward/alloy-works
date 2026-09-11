import type { RouteContract } from './contract.js';
import { ErrorBody, Health, Me, SignInCallback, TenantProfile } from './schemas.js';

/** The API's major version, as in `/v1`. It changes only with a breaking change (API-010). */
export const API_VERSION = '1';

/** The session cookie: `__Host-` so only the exact hostname that set it can set or read it. */
export const SESSION_COOKIE = '__Host-aw_session';

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

export const routes = {
  getHealth: {
    operationId: 'getHealth',
    method: 'GET',
    path: '/health',
    summary: 'Whether the service is up. Answers on any hostname',
    tenantScoped: false,
    authenticated: false,
    responses: { 200: { description: 'The service is up', schema: Health } },
  },
  getTenant: {
    operationId: 'getTenant',
    method: 'GET',
    path: '/v1/tenant',
    summary: 'The environment this address serves, as its sign-in page shows it',
    tenantScoped: true,
    authenticated: false,
    responses: {
      200: { description: 'The environment', schema: TenantProfile },
      404: { description: 'No environment is served at this address', schema: ErrorBody },
    },
  },
  startOrganisationSignIn: {
    operationId: 'startOrganisationSignIn',
    method: 'GET',
    path: '/v1/sign-in/organisation',
    summary: "Begin signing in with the organisation's identity provider",
    tenantScoped: true,
    authenticated: false,
    responses: {
      302: { description: 'On to the identity provider' },
      404: {
        description: 'This environment does not permit signing in this way',
        schema: ErrorBody,
      },
    },
  },
  finishOrganisationSignIn: {
    operationId: 'finishOrganisationSignIn',
    method: 'GET',
    path: '/v1/sign-in/organisation/callback',
    summary: 'Where the identity provider returns; completes the sign-in',
    tenantScoped: true,
    authenticated: false,
    query: SignInCallback,
    responses: {
      302: { description: 'Signed in, and on to the application' },
      401: { description: 'The sign-in could not be completed', schema: ErrorBody },
    },
  },
  signOut: {
    operationId: 'signOut',
    method: 'POST',
    path: '/v1/sign-out',
    summary: 'End this session, wherever it is in use',
    tenantScoped: true,
    authenticated: true,
    responses: {
      204: { description: 'Signed out, everywhere this session was in use' },
      401: unauthenticated,
    },
  },
  getMe: {
    operationId: 'getMe',
    method: 'GET',
    path: '/v1/me',
    summary: 'Who is signed in, and to which environment',
    tenantScoped: true,
    authenticated: true,
    responses: {
      200: { description: 'The signed-in principal', schema: Me },
      401: unauthenticated,
    },
  },
} as const satisfies Record<string, RouteContract>;

export const allRoutes: readonly RouteContract[] = Object.values(routes);
