import type {
  ComponentUsesParams,
  ComponentUsesView,
  StyleUsesQuery,
  StyleUsesView,
} from '@alloy-works/api-contract';
import { componentUses, styleUses, type Tenant, type TenantDatabase } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import type { SessionPrincipal } from './sessions.js';

/** Where a component is used (relationships.md; the R1 plan, R1-B), to a reader of it. */
export function usesHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    /** Where a style is used (REU-055; the R20 plan, R20-A): to anybody, naming what they may read. */
    getStyleUses: async (request: FastifyRequest): Promise<StyleUsesView> => {
      const { kind, key } = request.query as StyleUsesQuery;
      const uses = await db.withTenant(tenantOf(request), (trx) =>
        styleUses(trx, principalOf(request).principalId, { kind, key }),
      );
      return {
        components: uses.components.map((each) => ({ ...each })),
        unreadable: uses.unreadable,
      };
    },

    getComponentUses: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ComponentUsesView> => {
      const { id } = request.params as ComponentUsesParams;
      const row = await trx
        .selectFrom('artifact')
        .select('kind')
        .where('id', '=', id)
        .executeTakeFirst();
      if (row?.kind !== 'component') throw notFound();
      const uses = await componentUses(trx, principalId, id);
      return {
        documents: uses.documents.map((each) => ({
          id: each.id,
          title: each.title,
          state: each.state && { ...each.state },
          references: each.references.map((reference) => ({
            node: reference.node,
            mode: reference.mode,
            version: reference.version && { ...reference.version },
            overridden: reference.overridden,
          })),
        })),
        unreadableDocuments: uses.unreadableDocuments,
        baselines: {
          named: uses.baselines.named.map((each) => ({ ...each })),
          unreadable: uses.baselines.unreadable,
        },
        publications: {
          named: uses.publications.named.map((each) => ({ ...each })),
          unreadable: uses.publications.unreadable,
        },
      };
    },
  };
}
