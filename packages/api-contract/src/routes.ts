import type { RouteContract } from './contract.js';
import { ErrorBody, Health, TenantProfile } from './schemas.js';

/** The API's major version, as in `/v1`. It changes only with a breaking change (API-010). */
export const API_VERSION = '1';

export const routes = {
  getHealth: {
    operationId: 'getHealth',
    method: 'GET',
    path: '/health',
    summary: 'Whether the service is up. Answers on any hostname',
    tenantScoped: false,
    responses: { 200: { description: 'The service is up', schema: Health } },
  },
  getTenant: {
    operationId: 'getTenant',
    method: 'GET',
    path: '/v1/tenant',
    summary: 'The environment this address serves, as its sign-in page shows it',
    tenantScoped: true,
    responses: {
      200: { description: 'The environment', schema: TenantProfile },
      404: { description: 'No environment is served at this address', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;

export const allRoutes: readonly RouteContract[] = Object.values(routes);
