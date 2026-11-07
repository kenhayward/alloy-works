import type { BoundaryView } from '@alloy-works/api-contract';
import { tenantBoundary } from '@alloy-works/db';
import { OUTBOUND } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';

/**
 * Everything that can leave a tenant (secrets.md, "The boundary"; ADM-041): `OUTBOUND`'s declaration
 * of each way out, and what this tenant has configured for it, a host alone and never a secret.
 */
export function boundaryHandlers() {
  return {
    getBoundary: async (_request: FastifyRequest, { trx }: Authorised): Promise<BoundaryView> => {
      const configured = await tenantBoundary(trx);
      return {
        ways: OUTBOUND.map((each) => ({
          way: each.way,
          what: each.what,
          onByDefault: each.onByDefault,
          changedBy: each.changedBy === null ? null : { ...each.changedBy },
          residency: each.residency,
          absent: each.absent ?? null,
          on: configured[each.way].on,
          items: configured[each.way].items.map((item) => ({ ...item })),
        })),
      };
    },
  };
}
