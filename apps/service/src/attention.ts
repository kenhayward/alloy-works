import type { AttentionView } from '@alloy-works/api-contract';
import { decideOnly, whatWaits, type Tenant, type TenantDatabase } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import type { SessionPrincipal } from './sessions.js';

/**
 * **What waits on a person** (home.md, Needs your attention; the HM plan, HM-A): their own alone,
 * computed when asked, in one transaction that only decides.
 */
export function attentionHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    getAttention: async (request: FastifyRequest): Promise<AttentionView> =>
      db.withTenant(tenantOf(request), async (trx) => {
        await decideOnly(trx);
        return whatWaits(trx, principalOf(request).principalId);
      }),
  };
}
