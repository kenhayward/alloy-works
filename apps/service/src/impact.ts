import type {
  ArtifactParams,
  ImpactQuery,
  ImpactView,
  ReferencesView,
} from '@alloy-works/api-contract';
import { impact, referencesFrom } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';

/** Impact and what an artifact uses (relationships.md; the R2 plan, R2-C, R2-E), to a reader of it. */
export function impactHandlers() {
  return {
    getArtifactImpact: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ImpactView> => {
      const { id } = request.params as ArtifactParams;
      const { depth } = request.query as ImpactQuery;
      const walked = await impact(trx, principalId, id, Number(depth));
      return {
        reached: walked.reached.map((each) => ({ ...each })),
        cut: walked.cut,
        more: walked.more,
      };
    },
    getArtifactReferences: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ReferencesView> => {
      const { id } = request.params as ArtifactParams;
      const found = await referencesFrom(trx, principalId, id);
      return {
        references: found.items.map((each) => ({ ...each })),
        unreadable: found.unreadable,
      };
    },
  };
}
