import type {
  DataSettings,
  DataSettingsBody,
  EditingSettings,
  EditingSettingsBody,
  ImportSettings,
  TranslationSettings,
  TranslationSettingsBody,
  TranslationSettingsHistory,
  TranslationSettingsHistoryQuery,
} from '@alloy-works/api-contract';
import {
  dataPolicy,
  editingPolicy,
  importPolicy,
  lockTranslationPolicy,
  recordEvent,
  setDataPolicy,
  setEditingPolicy,
  setImportPolicy,
  setTranslationPolicy,
  translationPolicy,
  translationPolicyHistory,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { limitCeilings, runsAtOnce } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';
import { AppError } from './errors.js';
import { cursorFor, languageOf, pageAsked } from './listing.js';

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

    // Read under the policy's lock (TE-D), so two changes at once take turns and neither's history
    // row is lost; the history gains one where a value changed, by whom.
    setTranslationSettings: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<TranslationSettings> => {
      const before = await lockTranslationPolicy(trx);
      const after = await setTranslationPolicy(
        trx,
        request.body as TranslationSettingsBody,
        principalId,
      );
      // The words by language compared as a whole, so an unchanged note is no change.
      const compared = (policy: TranslationSettings) => ({
        ...policy,
        note: JSON.stringify(policy.note),
      });
      await recordSettingsChanged(trx, 'translation', compared(before), compared(after));
      return after;
    },

    // The policy's history (TE-D; LOC-036), the newest first: its values, as they are enumerations
    // and the mark's words, never secrets, to an administrator of the environment.
    getTranslationSettingsHistory: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TranslationSettingsHistory> => {
      const asked = pageAsked(
        'translationPolicy',
        request.query as TranslationSettingsHistoryQuery,
        languageOf(request),
      );
      const listed = await translationPolicyHistory(trx, asked);
      return {
        items: listed.items.map((each) => ({
          id: each.id,
          at: each.at.toISOString(),
          by: each.by && { ...each.by },
          policy: each.policy,
        })),
        next: cursorFor(
          'translationPolicy',
          asked.sort,
          asked.order,
          listed.snapshot,
          listed.next,
          asked.language,
        ),
      };
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
