import type { ComponentUsesParams, ComponentUsesView } from '@alloy-works/api-contract';
import { componentUses } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';

/** Where a component is used (relationships.md; the R1 plan, R1-B), to a reader of it. */
export function usesHandlers() {
  return {
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
