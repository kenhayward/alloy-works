import type { GeneratedParams, GeneratedReport } from '@alloy-works/api-contract';
import {
  generatedReport,
  readDocument,
  readPublication,
  publicationPlacements,
  readsOnlyShares,
  resolveOccurrences,
  type GeneratedPlacement,
} from '@alloy-works/db';
import type { OutlineDocument } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';

import { notFound, type Authorised } from '../access.js';

/**
 * Which of a document, or of a publication, came from a model (the G3 plan, G3-C, G3-D; GEN-026,
 * GEN-041): the document's components as its reader resolves them now, unreadable ones counted; a
 * publication's as it recorded them, never anything newer.
 */

function view(placements: readonly GeneratedPlacement[], unreadable: number): GeneratedReport {
  return {
    placements: placements.map((placement) => ({
      node: placement.node,
      component: placement.component,
      version: placement.version,
      number: placement.number,
      restoredFrom: placement.restoredFrom,
      items: placement.items.map((item) => ({
        kind: item.kind,
        id: item.id,
        state: item.state,
        askedBy: item.askedBy,
        actedBy: item.actedBy,
        actedAt: item.actedAt?.toISOString() ?? null,
        acceptedInto: item.acceptedInto,
        run: item.run,
      })),
    })),
    unreadable,
  };
}

export function generatedHandlers() {
  return {
    getDocumentGenerated: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<GeneratedReport> => {
      const { id } = request.params as GeneratedParams;
      const document = await readDocument(trx, id);
      if (!document) throw notFound();
      const outcomes = await resolveOccurrences(
        trx,
        document.version.content as OutlineDocument,
        principalId,
      );
      const placements = outcomes.flatMap((each) =>
        each.outcome === 'resolved'
          ? [{ node: each.node, component: each.component, version: each.version }]
          : [],
      );
      const unreadable = outcomes.filter((each) => each.outcome === 'unreadable').length;
      return view(await generatedReport(trx, placements), unreadable);
    },

    getPublicationGenerated: async (
      request: FastifyRequest,
      { trx, facts, principalId }: Authorised,
    ): Promise<GeneratedReport> => {
      const { id } = request.params as GeneratedParams;
      // It names who asked and who accepted: never to somebody shared the publication alone (R17-I).
      if (facts.principal.kind === 'external' && (await readsOnlyShares(trx, principalId))) {
        throw notFound();
      }
      if (!(await readPublication(trx, id))) throw notFound();
      return view(await generatedReport(trx, await publicationPlacements(trx, id)), 0);
    },
  };
}
