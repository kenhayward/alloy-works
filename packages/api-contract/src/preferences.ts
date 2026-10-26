import { INTERFACE_LANGUAGES } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/** A person's own preferences (the UI plan, UI-E; LOC-005): their interface language. */
export const MyPreferences = z.object({
  interfaceLanguage: z
    .enum(INTERFACE_LANGUAGES)
    .nullable()
    .describe(
      'The language the interface is in, independent of any content’s; null follows the browser’s first declared language, else English',
    ),
});
export type MyPreferences = z.infer<typeof MyPreferences>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const tokenNotAllowed = {
  description: 'A personal token: preferences are a signed-in person’s',
  schema: ErrorBody,
} as const;

export const preferenceRoutes = {
  getMyPreferences: {
    operationId: 'getMyPreferences',
    method: 'GET',
    path: '/v1/me/preferences',
    summary: 'The caller’s own preferences',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    responses: {
      200: { description: 'Their preferences', schema: MyPreferences },
      401: unauthenticated,
      403: tokenNotAllowed,
    },
  },
  setMyPreferences: {
    operationId: 'setMyPreferences',
    method: 'PUT',
    path: '/v1/me/preferences',
    summary: 'Choose the caller’s own preferences',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    body: z.strictObject({ interfaceLanguage: MyPreferences.shape.interfaceLanguage }),
    responses: {
      200: { description: 'Their preferences, as now chosen', schema: MyPreferences },
      400: { description: 'Not a declared interface language', schema: ErrorBody },
      401: unauthenticated,
      403: tokenNotAllowed,
    },
  },
} as const satisfies Record<string, RouteContract>;
