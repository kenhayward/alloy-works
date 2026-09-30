import { limitCeilings } from '@alloy-works/domain';
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

/**
 * The tenant's lowered limits on a query (the D2 plan, D2-N; DAT-050), each null or absent where the
 * environment lowers none: a run takes the least of each of its definition's and these.
 */
export const DataSettingsBody = z.strictObject({
  rows: z
    .int()
    .min(1)
    .max(limitCeilings.rows)
    .nullable()
    .optional()
    .describe(
      `The most rows a run may read, 1 to ${limitCeilings.rows}; null or absent lowers none`,
    ),
  bytes: z
    .int()
    .min(1)
    .max(limitCeilings.bytes)
    .nullable()
    .optional()
    .describe(
      `The most bytes a run's result may hold, 1 to ${limitCeilings.bytes}; null or absent lowers none`,
    ),
  seconds: z
    .int()
    .min(1)
    .max(limitCeilings.seconds)
    .nullable()
    .optional()
    .describe(
      `The most seconds a run may take, 1 to ${limitCeilings.seconds}; null or absent lowers none`,
    ),
});
export type DataSettingsBody = z.infer<typeof DataSettingsBody>;

export const DataSettings = z.object({
  rows: z.int().nullable(),
  bytes: z.int().nullable(),
  seconds: z.int().nullable(),
  ceilings: z
    .object({ rows: z.int(), bytes: z.int(), seconds: z.int() })
    .describe("The product's ceilings, which no definition passes and an environment only lowers"),
});
export type DataSettings = z.infer<typeof DataSettings>;

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
  getDataSettings: {
    operationId: 'getDataSettings',
    method: 'GET',
    path: '/v1/settings/data',
    summary: "The environment's lowered limits on a query's rows, bytes and seconds",
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'The data settings, with the ceilings', schema: DataSettings },
      401: unauthenticated,
    },
  },
  setDataSettings: {
    operationId: 'setDataSettings',
    method: 'PUT',
    path: '/v1/settings/data',
    summary: "Lower, or stop lowering, the environment's limits on a query",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    body: DataSettingsBody,
    responses: {
      200: { description: 'The data settings, as changed', schema: DataSettings },
      400: {
        description: 'A limit that is not a whole number from 1 to its ceiling',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'The caller may not administer this environment', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
