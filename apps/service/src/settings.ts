import type { EditingSettings } from '@alloy-works/api-contract';
import { editingPolicy, setEditingPolicy, type Tenant, type TenantDatabase } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';
import { AppError } from './errors.js';

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
      const answer = await setEditingPolicy(trx, request.body as EditingSettings);
      // The contract's schema refuses the same range before a handler runs; this is its second word.
      if ('refused' in answer) {
        throw new AppError(
          400,
          'invalid_request',
          'The window is a whole number of days from 1 to 365.',
        );
      }
      return answer.policy;
    },
  };
}
