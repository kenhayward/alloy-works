import type { LicenceList, LicenceParams, LicenceView } from '@alloy-works/api-contract';
import {
  listLicences,
  readDefinitionLatest,
  readsOnlyShares,
  type StoredDefinition,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound } from './access.js';
import type { SessionPrincipal } from './sessions.js';

const licenceView = (stored: StoredDefinition<'licence'>): LicenceView => ({
  id: stored.id,
  version: {
    id: stored.version.id,
    number: `${stored.version.revision}.${stored.version.version}`,
  },
  licence: stored.definition,
});

/**
 * The licence routes (the AL plan, AL-B): read by anyone signed in, as vocabularies are, since an
 * uploader declares the one an image is held under; somebody from outside reads none.
 */
export function licenceHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  const read = <T>(
    request: FastifyRequest,
    work: (trx: TenantTransaction) => Promise<T>,
    outside: T,
  ) =>
    db.withTenant(tenantOf(request), async (trx) =>
      (await readsOnlyShares(trx, principalOf(request).principalId)) ? outside : work(trx),
    );
  return {
    listLicences: async (request: FastifyRequest): Promise<LicenceList> => ({
      items: (await read(request, listLicences, [])).map(licenceView),
    }),

    getLicence: async (request: FastifyRequest): Promise<LicenceView> => {
      const { id } = request.params as LicenceParams;
      const stored = await read(request, (trx) => readDefinitionLatest(trx, id), undefined);
      if (stored?.kind !== 'licence') throw notFound();
      return licenceView(stored as StoredDefinition<'licence'>);
    },
  };
}
