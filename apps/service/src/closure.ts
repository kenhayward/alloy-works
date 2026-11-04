import type { ClosureBody, ClosureView } from '@alloy-works/api-contract';
import {
  cancelClosing,
  closureFacts,
  isRecentWholeExport,
  loadFacts,
  ownTenantState,
  startClosing,
  TenantStateRefused,
  type ClosureOffer,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, DELETION_DAYS, GRACE_DAYS, TENANT_STATE_EFFECTS } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { authoriseAt, callerOf, type Authorised } from './access.js';
import { contextOf } from './audit.js';
import { AppError } from './errors.js';

/**
 * **Closing an environment** (ADM-029, ADM-030; tenant-lifecycle.md, TL-E to TL-H). The state and who
 * may change it are the platform's; here is the offered export, the typed name, and what a page shows.
 */

const EXPORT_RECENT_HOURS = 24;

const wrongName = () =>
  new AppError(422, 'closure_name_mismatch', "That is not this environment's name.", 'ADM-030');
const unanswered = () =>
  new AppError(
    422,
    'closure_export_unanswered',
    'Take a whole export in the last 24 hours, or decline one, before closing.',
    'ADM-029',
  );
const needsExport = () =>
  new AppError(
    403,
    'close_needs_export',
    'Whoever closes an environment decides about its export, so must hold both export permissions.',
    'ADM-029',
  );
const operatorBegan = () =>
  new AppError(
    403,
    'closure_begun_by_operator',
    'The operator began this closure, and only the operator can cancel it.',
    'ADM-030',
  );
const cannot = (message: string) => new AppError(409, 'closure_not_possible', message, 'ADM-030');

async function viewOf(trx: TenantTransaction, mayCancel: boolean): Promise<ClosureView> {
  const own = await closureFacts(trx);
  return {
    state: own.state,
    name: own.name,
    since: own.since.toISOString(),
    graceEndsAt: own.graceEndsAt?.toISOString() ?? null,
    closedBy: own.closingBy,
    holds: own.holds,
    graceDays: GRACE_DAYS,
    deletionDays: DELETION_DAYS,
    effects: TENANT_STATE_EFFECTS.closing,
    mayCancel:
      mayCancel &&
      (own.state === 'closing' || own.state === 'retained') &&
      own.closingBy === 'person',
  };
}

const offerOf = async (trx: TenantTransaction, body: ClosureBody): Promise<ClosureOffer> => {
  if (body.declined && body.export === undefined) return { declined: true };
  if (body.export === undefined || body.declined) throw unanswered();
  if (!(await isRecentWholeExport(trx, body.export, EXPORT_RECENT_HOURS))) throw unanswered();
  return { export: body.export };
};

export function closureHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
) {
  const mayCancel = async (trx: TenantTransaction, principalId: string) => {
    const facts = await loadFacts(trx, principalId, { kind: 'tenant' });
    return facts !== undefined && decide('close_environment', facts).allowed;
  };
  return {
    getClosure: async (request: FastifyRequest) =>
      db.withTenant(
        tenantOf(request),
        async (trx) => {
          const caller = callerOf(request);
          // Anyone a closing environment still lets in may see where it stands. Before that it is a
          // question for whoever could close it.
          if ((await ownTenantState(trx)).state === 'active') {
            await authoriseAt(trx, caller, 'close_environment', { kind: 'tenant' });
          }
          return viewOf(trx, await mayCancel(trx, caller.principalId));
        },
        contextOf(request),
      ),

    startClosure: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const body = request.body as ClosureBody;
      const facts = await loadFacts(trx, principalId, { kind: 'tenant' });
      if (
        !facts ||
        !decide('export_environment', facts).allowed ||
        !decide('export_audit', facts).allowed
      ) {
        throw needsExport();
      }
      const { name } = await viewOf(trx, false);
      if (body.name !== name) throw wrongName();
      const offer = await offerOf(trx, body);
      try {
        await startClosing(trx, tenantOf(request), offer);
      } catch (error) {
        if (error instanceof TenantStateRefused) throw cannot(error.message);
        throw error;
      }
      return viewOf(trx, true);
    },

    cancelClosure: async (request: FastifyRequest, { trx }: Authorised) => {
      const before = await ownTenantState(trx);
      if (before.closingBy === 'operator') throw operatorBegan();
      try {
        await cancelClosing(trx, tenantOf(request));
      } catch (error) {
        if (error instanceof TenantStateRefused) throw cannot(error.message);
        throw error;
      }
      return viewOf(trx, true);
    },
  };
}
