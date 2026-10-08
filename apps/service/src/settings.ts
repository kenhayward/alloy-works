import type { DataSettings, DataSettingsBody, EditingSettings } from '@alloy-works/api-contract';
import {
  dataPolicy,
  editingPolicy,
  recordEvent,
  setDataPolicy,
  setEditingPolicy,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { limitCeilings } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';
import { AppError } from './errors.js';

/**
 * Records the settings a change changed (ADM-002; the AU1 plan, AU1-I), by name and never by value:
 * nothing where none did.
 */
async function recordSettingsChanged(
  trx: TenantTransaction,
  area: 'editing' | 'data',
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
      const answer = await setEditingPolicy(trx, request.body as EditingSettings);
      // The contract's schema refuses the same range before a handler runs; this is its second word.
      if ('refused' in answer) {
        throw new AppError(
          400,
          'invalid_request',
          'The window is a whole number of days from 1 to 365.',
        );
      }
      await recordSettingsChanged(trx, 'editing', before, answer.policy);
      return answer.policy;
    },

    // The tenant's lowered limits on a run (D2-N; DAT-050): read by anybody signed in, as a limit a
    // query author meets should be stated, and lowered only by an administrator of the environment.
    getDataSettings: async (request: FastifyRequest): Promise<DataSettings> =>
      db.withTenant(tenantOf(request), async (trx) => ({
        ...(await dataPolicy(trx)),
        ceilings: { ...limitCeilings },
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
      });
      const after = await dataPolicy(trx);
      await recordSettingsChanged(trx, 'data', before, after);
      return { ...after, ceilings: { ...limitCeilings } };
    },
  };
}
