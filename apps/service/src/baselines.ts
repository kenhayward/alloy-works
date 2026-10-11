import type {
  BaselineList,
  BaselineListQuery,
  BaselineParams,
  BaselineSummaryView,
  BaselineView,
  DocumentParams,
  MakeBaselineBody,
  SupersedeBaselineBody,
} from '@alloy-works/api-contract';
import {
  baselineDocument,
  listBaselines,
  makeBaseline,
  readBaseline,
  supersedeBaseline,
  type BaselineSummary,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refusePublish } from './publishing.js';
import { refused } from './wire-codes.js';

const summaryView = (baseline: BaselineSummary): BaselineSummaryView => ({
  id: baseline.id,
  document: baseline.documentId,
  name: baseline.name,
  madeBy: baseline.madeBy,
  madeAt: baseline.madeAt.toISOString(),
  digest: baseline.digest,
  superseded:
    baseline.superseded === null
      ? null
      : {
          by: baseline.superseded.by,
          principal: baseline.superseded.principal,
          at: baseline.superseded.at.toISOString(),
        },
});

async function summaryOf(
  trx: TenantTransaction,
  baselineId: string,
  reader: string,
): Promise<BaselineSummaryView> {
  const read = await readBaseline(trx, baselineId, reader);
  if (!read) throw new Error(`The baseline ${baselineId} was not recorded`);
  return summaryView(read);
}

/**
 * Baselines (docs/design/baselines.md; the BL plan, Task 1): each decided by `authorise` on the
 * document - its path's, or the baseline's (BL-H) - in the transaction the handler then runs in, as a
 * publish is, so no grant changes between the decision and what was resolved.
 */
export function baselineHandlers() {
  return {
    makeBaseline: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<BaselineSummaryView> => {
      const { id } = request.params as DocumentParams;
      const body = request.body as MakeBaselineBody;
      const answer = await makeBaseline(trx, {
        documentId: id,
        version: body.version,
        name: body.name,
        maker: principalId,
      });
      switch (answer.answer) {
        case 'made':
          return summaryOf(trx, answer.baseline, principalId);
        case 'name.invalid':
          throw refused(400, 'name.invalid', `${answer.problem}.`);
        case 'name.taken':
          throw refused(409, 'name.taken', 'This document has a baseline by that name already.');
        // Each place by its node alone, as a publish's failures are (issue #143).
        case 'baseline.unresolved':
          throw refused(
            400,
            'baseline.unresolved',
            `${answer.failures.length === 1 ? 'A place' : `${answer.failures.length} places`} in this document cannot be pinned as you can read it.`,
            { places: answer.failures },
          );
        default:
          return refusePublish(trx, id, answer);
      }
    },

    listBaselines: async (request: FastifyRequest, { trx }: Authorised): Promise<BaselineList> => {
      const { id } = request.params as DocumentParams;
      const { state } = request.query as BaselineListQuery;
      return { baselines: (await listBaselines(trx, id, state)).map(summaryView) };
    },

    getBaseline: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<BaselineView> => {
      const { id } = request.params as BaselineParams;
      const read = await readBaseline(trx, id, principalId);
      if (!read) throw notFound();
      const { pins, withheld } = read;
      return {
        ...summaryView(read),
        pins: {
          ...pins,
          occurrences: [...pins.occurrences],
          assets: [...pins.assets],
          bindings: [...pins.bindings],
        },
        withheld: { nodes: [...withheld.nodes], assets: withheld.assets },
      };
    },

    supersedeBaseline: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<BaselineSummaryView> => {
      const { id } = request.params as BaselineParams;
      const { by } = request.body as SupersedeBaselineBody;
      // Decided on this baseline's document, so `by` is read only once it is shown to be of it.
      if ((await baselineDocument(trx, id)) === undefined) throw notFound();
      const answer = await supersedeBaseline(trx, { baseline: id, by, principal: principalId });
      switch (answer.answer) {
        case 'superseded':
          return summaryOf(trx, id, principalId);
        case 'superseder.invalid':
          throw refused(
            400,
            'superseder.invalid',
            'A baseline is superseded only by a later baseline of the same document.',
          );
        case 'superseded.already':
          throw refused(409, 'superseded.already', 'This baseline is superseded already.');
      }
    },
  };
}
