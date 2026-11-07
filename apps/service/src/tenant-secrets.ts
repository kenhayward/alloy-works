import type { SecretList } from '@alloy-works/api-contract';
import { tenantSecrets } from '@alloy-works/db';
import { SECRETS_ABSENT, secretConsumers } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';

const iso = (at: Date | null) => (at === null ? null : at.toISOString());

/**
 * A tenant's secrets and what uses each (secrets.md; ADM-047): read from the rows that hold them, and
 * never a value or a hash, which `tenantSecrets` never selects.
 */
export function tenantSecretHandlers() {
  return {
    listSecrets: async (_request: FastifyRequest, { trx }: Authorised): Promise<SecretList> => ({
      items: (await tenantSecrets(trx)).map((each) => {
        const row = secretConsumers(each.kind);
        return {
          kind: each.kind,
          of: each.of,
          replacedAt: iso(each.replacedAt),
          previousUntil: iso(each.previousUntil),
          replacement: {
            operation: row.operation,
            permission: row.permission,
            how: row.replacement.how,
          },
          consumers: [...each.consumers],
        };
      }),
      absent: SECRETS_ABSENT.map((each) => ({ ...each })),
    }),
  };
}
