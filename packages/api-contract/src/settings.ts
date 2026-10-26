import {
  TRANSLATION_CONFLICTS,
  TRANSLATION_MACHINE,
  limitCeilings,
  runsAtOnce,
  translationPolicySchema,
} from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/**
 * The environment's editing settings (component-editor.md, RC-C): how long a saved change is kept
 * after the next version is cut from its component (VER-003, VER-004).
 */
const retention = z
  .int()
  .min(1)
  .max(365)
  .describe(
    'How many days an iteration is kept after the next version of its component is made: 1 to 365, 30 unless changed',
  );
const release = z
  .int()
  .min(5)
  .max(240)
  .describe(
    'How many minutes a lock lasts once its holder does nothing: 5 to 240, 15 unless changed (COL-008)',
  );
const take = z
  .int()
  .min(1)
  .max(239)
  .describe(
    'How many minutes before an idle holder may be asked for the lock: 1 to 239, always fewer than the release period, 5 unless changed (COL-046)',
  );

export const EditingSettings = z.strictObject({
  iterationRetentionDays: retention,
  lockReleaseMinutes: release,
  lockTakeMinutes: take,
});
export type EditingSettings = z.infer<typeof EditingSettings>;

/** A change to the editing settings: each given is changed, each absent kept. */
export const EditingSettingsBody = z.strictObject({
  iterationRetentionDays: retention.optional(),
  lockReleaseMinutes: release.optional(),
  lockTakeMinutes: take.optional(),
});
export type EditingSettingsBody = z.infer<typeof EditingSettingsBody>;

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
  concurrentRuns: z
    .int()
    .min(1)
    .max(runsAtOnce.ceiling)
    .nullable()
    .optional()
    .describe(
      `How many of the environment's query runs may be in flight at once, 1 to ${runsAtOnce.ceiling}; null or absent for the product's ${runsAtOnce.default}`,
    ),
});
export type DataSettingsBody = z.infer<typeof DataSettingsBody>;

export const DataSettings = z.object({
  rows: z.int().nullable(),
  bytes: z.int().nullable(),
  seconds: z.int().nullable(),
  concurrentRuns: z
    .int()
    .nullable()
    .describe(
      'Runs at once, or null for the default; one past them waits, then is query_throttled',
    ),
  defaults: z.object({ concurrentRuns: z.int() }).describe("The product's runs at once"),
  ceilings: z
    .object({ rows: z.int(), bytes: z.int(), seconds: z.int(), concurrentRuns: z.int() })
    .describe("The product's ceilings, which no definition passes and an environment only lowers"),
});
export type DataSettings = z.infer<typeof DataSettings>;

/** The environment's identity policy for imports (the IM plan, IM-I; IMP-010). */
export const ImportSettings = z.strictObject({
  policy: z
    .enum(['map', 'keep', 'discard'])
    .describe(
      'What an accepted import records of the names a file carries: `map`, the default, keeps each as text with the member its email matches, or a name match its importer confirmed; `keep` keeps each as text; `discard` keeps none. Whatever an import makes is made by its importer',
    ),
});
export type ImportSettings = z.infer<typeof ImportSettings>;

/** The environment's translation policy (the TR plan, TR-J; LOC-017, LOC-036, LOC-037). */
export const TranslationSettings = translationPolicySchema.describe(
  '`fallback`: where a component has no translation into the language a document is published in, `source`, the default, publishes it in its own language, marked as untranslated, and `refuse` fails the publish; a document may say otherwise. `outOfDate`: a translation out of date with a change that needs retranslating, `publish`, the default, publishes it and reports it, and `refuse` fails the publish. `note`: the words the mark says, by language tag, else `Untranslated`. `conflict`: what a translation returned for a source or a translation that moved since it was sent is offered first - `review`, the default, leaves it held, `accept` offers accepting it as a translation of the version sent, `reject` offers rejecting it; a person always decides. `machine`: whether content is sent to the `translate` model endpoint for a machine draft - `off`, the default, never; `inside`, only to an endpoint inside the data boundary; `any`, to any',
);
export type TranslationSettings = z.infer<typeof TranslationSettings>;

/**
 * The policy set: as read, but `conflict` and `machine` may be left out, and then stay as they are,
 * so a body written before either existed changes neither (the XL final review).
 */
export const TranslationSettingsBody = translationPolicySchema.extend({
  conflict: z.enum(TRANSLATION_CONFLICTS).optional().describe('Left out, it stays as it is'),
  machine: z.enum(TRANSLATION_MACHINE).optional().describe('Left out, it stays as it is'),
});
export type TranslationSettingsBody = z.infer<typeof TranslationSettingsBody>;

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
    summary:
      "The environment's editing settings: how long saved changes are kept, and a lock lasts",
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
    body: EditingSettingsBody,
    responses: {
      200: { description: 'The editing settings, as changed', schema: EditingSettings },
      400: {
        description:
          'invalid_request: a value out of its bounds. lock_periods_invalid: a take period not shorter than the release period',
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
  getImportSettings: {
    operationId: 'getImportSettings',
    method: 'GET',
    path: '/v1/settings/import',
    summary: "The environment's policy for the names an imported file carries",
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'The import settings', schema: ImportSettings },
      401: unauthenticated,
    },
  },
  setImportSettings: {
    operationId: 'setImportSettings',
    method: 'PUT',
    path: '/v1/settings/import',
    summary: "Change the environment's policy for the names an imported file carries",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    body: ImportSettings,
    responses: {
      200: { description: 'The import settings, as changed', schema: ImportSettings },
      400: { description: 'invalid_request: not map, keep or discard', schema: ErrorBody },
      401: unauthenticated,
      403: { description: 'The caller may not administer this environment', schema: ErrorBody },
    },
  },
  getTranslationSettings: {
    operationId: 'getTranslationSettings',
    method: 'GET',
    path: '/v1/settings/translation',
    summary: "The environment's policy for publishing in a language",
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'The translation settings', schema: TranslationSettings },
      401: unauthenticated,
    },
  },
  setTranslationSettings: {
    operationId: 'setTranslationSettings',
    method: 'PUT',
    path: '/v1/settings/translation',
    summary: "Change the environment's policy for publishing in a language",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    body: TranslationSettingsBody,
    responses: {
      200: { description: 'The translation settings, as changed', schema: TranslationSettings },
      400: {
        description: 'invalid_request: a value it does not take, or a note too long',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'The caller may not administer this environment', schema: ErrorBody },
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
