import type {
  DataSettings,
  DataSettingsBody,
  EditingSettings,
  EditingSettingsBody,
  ImportSettings,
  TranslationSettings,
} from '@alloy-works/api-contract';
import {
  dataPolicy,
  editingPolicy,
  importPolicy,
  recordEvent,
  setDataPolicy,
  setEditingPolicy,
  setImportPolicy,
  setTranslationPolicy,
  translationPolicy,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { limitCeilings, runsAtOnce } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';
import { AppError } from './errors.js';

/**
 * Records the settings a change changed (ADM-002; the AU1 plan, AU1-I), by name and never by value:
 * nothing where none did.
 */
export async function recordSettingsChanged(
  trx: TenantTransaction,
  area: 'editing' | 'data' | 'referenceSources' | 'import' | 'translation',
  before: object,
  after: object,
): Promise<void> {
  const was = before as Readonly<Record<string, unknown>>;
  const now = after as Readonly<Record<string, unknown>>;
  const changed = Object.keys(now)
    .filter((name) => was[name] !== now[name])
    .sort()
    .map((name) => `${area}.${name}`);
  if (changed.length === 0) return;
  await recordEvent(trx, {
    kind: 'settings.changed',
    subject: { kind: 'settings' },
    detail: { settings: changed },
  });
}

/**
 * The environment's editing settings (component-editor.md, RC-C): read by anybody signed in, since
 * VER-004 wants the window stated, and changed in the transaction `administer` at the tenant was
 * decided in.
 */
export function settingsHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
) {
  return {
    getEditingSettings: async (request: FastifyRequest): Promise<EditingSettings> =>
      db.withTenant(tenantOf(request), (trx) => editingPolicy(trx)),

    setEditingSettings: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<EditingSettings> => {
      const before = await editingPolicy(trx);
      const body = request.body as EditingSettingsBody;
      const answer = await setEditingPolicy(trx, {
        ...(body.iterationRetentionDays === undefined
          ? {}
          : { iterationRetentionDays: body.iterationRetentionDays }),
        ...(body.lockReleaseMinutes === undefined
          ? {}
          : { lockReleaseMinutes: body.lockReleaseMinutes }),
        ...(body.lockTakeMinutes === undefined ? {} : { lockTakeMinutes: body.lockTakeMinutes }),
      });
      // The contract's schema refuses each value's range before a handler runs; this is its second
      // word, and the one word on the two lock periods together (COL-046).
      if ('refused' in answer) {
        throw answer.refused === 'lock_periods.invalid'
          ? new AppError(
              400,
              'lock_periods_invalid',
              'A lock may be taken only before it would be released: the take period must be shorter.',
            )
          : new AppError(
              400,
              'invalid_request',
              'The window is a whole number of days from 1 to 365.',
            );
      }
      await recordSettingsChanged(trx, 'editing', before, answer.policy);
      return answer.policy;
    },

    // The tenant's identity policy for imports (IM-I; IMP-010): read by anybody signed in, as an
    // importer is told what acceptance will do; set by an administrator of the environment.
    getImportSettings: async (request: FastifyRequest): Promise<ImportSettings> =>
      db.withTenant(tenantOf(request), async (trx) => ({ policy: await importPolicy(trx) })),

    setImportSettings: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ImportSettings> => {
      const before = { policy: await importPolicy(trx) };
      const after = {
        policy: await setImportPolicy(trx, (request.body as ImportSettings).policy),
      };
      await recordSettingsChanged(trx, 'import', before, after);
      return after;
    },

    // The tenant's translation policy (TR-J; LOC-036): read by anybody signed in, as a publisher is
    // told what a missing translation does; set whole by an administrator of the environment, audited.
    getTranslationSettings: async (request: FastifyRequest): Promise<TranslationSettings> =>
      db.withTenant(tenantOf(request), (trx) => translationPolicy(trx)),

    setTranslationSettings: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TranslationSettings> => {
      const before = await translationPolicy(trx);
      const after = await setTranslationPolicy(trx, request.body as TranslationSettings);
      // The words by language compared as a whole, so an unchanged note is no change.
      const compared = (policy: TranslationSettings) => ({
        ...policy,
        note: JSON.stringify(policy.note),
      });
      await recordSettingsChanged(trx, 'translation', compared(before), compared(after));
      return after;
    },

    // The tenant's lowered limits on a run (D2-N; DAT-050): read by anybody signed in, as a limit a
    // query author meets should be stated, and lowered only by an administrator of the environment.
    getDataSettings: async (request: FastifyRequest): Promise<DataSettings> =>
      db.withTenant(tenantOf(request), async (trx) => ({
        ...(await dataPolicy(trx)),
        defaults: { concurrentRuns: runsAtOnce.default },
        ceilings: { ...limitCeilings, concurrentRuns: runsAtOnce.ceiling },
      })),

    setDataSettings: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<DataSettings> => {
      // The contract refuses a limit past its ceiling before this runs, and the table's check again.
      const body = request.body as DataSettingsBody;
      const before = await dataPolicy(trx);
      await setDataPolicy(trx, {
        rows: body.rows ?? null,
        bytes: body.bytes ?? null,
        seconds: body.seconds ?? null,
        concurrentRuns: body.concurrentRuns ?? null,
      });
      const after = await dataPolicy(trx);
      await recordSettingsChanged(trx, 'data', before, after);
      return {
        ...after,
        defaults: { concurrentRuns: runsAtOnce.default },
        ceilings: { ...limitCeilings, concurrentRuns: runsAtOnce.ceiling },
      };
    },
  };
}
