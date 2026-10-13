import type {
  Erased,
  ErasureParams,
  ErasureRefusalView,
  ErasureView,
} from '@alloy-works/api-contract';
import { erasePerson, erasureOf, type ErasureRefusal } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refused } from './wire-codes.js';

/** A refusal as the wire lists it. */
const refusalView = (refusal: ErasureRefusal): ErasureRefusalView =>
  refusal.reason === 'granted'
    ? { code: 'granted', grants: refusal.grants }
    : { code: refusal.reason };

/**
 * Erasing a person and what it would do (lifecycle.md, "Erasure"; the ER plan, Task 1), each decided
 * on `administer` at the tenant. A person the environment does not hold is not found, so another
 * environment's is never told apart from nobody (IAM-003).
 */
export function erasureHandlers() {
  return {
    getErasure: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ErasureView> => {
      const { id } = request.params as ErasureParams;
      const state = await erasureOf(trx, id, principalId);
      if (!state) throw notFound();
      return {
        person: { ...state.person },
        erases: { ...state.erases },
        remains: { ...state.remains },
        refusals: state.refusals.map(refusalView),
      };
    },

    erasePrincipal: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<Erased> => {
      const { id } = request.params as ErasureParams;
      const answer = await erasePerson(trx, id, principalId);
      if (!answer) throw notFound();
      if (answer.answer === 'refused') {
        throw refused(409, 'erasure.refused', 'This person cannot be erased yet.', {
          refusals: answer.refusals.map(refusalView),
        });
      }
      return { erased: true, labels: answer.answer === 'erased' ? answer.labels : 0 };
    },
  };
}
