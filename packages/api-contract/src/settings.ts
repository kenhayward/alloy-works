import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/**
 * The environment's editing settings (component-editor.md, RC-C): how long a saved change is kept
 * after the next version is cut from its component (VER-003, VER-004).
 */
export const EditingSettings = z.strictObject({
  iterationRetentionDays: z
    .int()
    .min(1)
    .max(365)
    .describe(
      'How many days an iteration is kept after the next version of its component is made: 1 to 365, 30 unless changed',
    ),
});
export type EditingSettings = z.infer<typeof EditingSettings>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/**
 * The editing settings, stated to anybody signed in, since a window nobody can read is one nobody
 * chose (VER-004); changed only by an administrator of the environment. No page of the application
 * shows them yet: they are the API's in T1.
 */
export const settingsRoutes = {
  getEditingSettings: {
    operationId: 'getEditingSettings',
    method: 'GET',
    path: '/v1/settings/editing',
    summary: "The environment's editing settings: how long saved changes are kept",
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'The editing settings', schema: EditingSettings },
      401: unauthenticated,
    },
  },
  setEditingSettings: {
    operationId: 'setEditingSettings',
    method: 'PUT',
    path: '/v1/settings/editing',
    summary: "Change the environment's editing settings",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    body: EditingSettings,
    responses: {
      200: { description: 'The editing settings, as changed', schema: EditingSettings },
      400: {
        description: 'A window that is not a whole number of days from 1 to 365',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'The caller may not administer this environment', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
