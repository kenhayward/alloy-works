import type {
  HoldBody,
  HoldList,
  HoldParams,
  HoldView,
  PageQuery,
  ReleaseHoldBody,
} from '@alloy-works/api-contract';
import {
  countHolds,
  listHolds,
  placeHold,
  readHold,
  releaseHold,
  type ListedHold,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import { AppError } from './errors.js';
import { refused } from './wire-codes.js';

/** A hold as the API shows it, its reason with it: these routes alone carry one (AH-G). */
function holdView(hold: ListedHold): HoldView {
  return {
    id: hold.id,
    target: { ...hold.target },
    reason: hold.reason,
    appliedBy: { ...hold.appliedBy },
    appliedAt: hold.appliedAt.toISOString(),
    released:
      hold.released === null
        ? null
        : {
            reason: hold.released.reason,
            by: { ...hold.released.by },
            at: hold.released.at.toISOString(),
          },
  };
}

const emptyReason = () => new AppError(400, 'invalid_request', 'Give a reason.');

async function viewOf(trx: TenantTransaction, id: string): Promise<HoldView> {
  const hold = await readHold(trx, id);
  if (!hold) throw new Error(`The hold ${id} was written and is not there`);
  return holdView(hold);
}

/**
 * Placing, releasing and listing legal holds (lifecycle.md; the AH plan, Task 2), each decided on
 * `administer` at the tenant before it runs.
 */
export function holdHandlers() {
  return {
    placeHold: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const body = request.body as HoldBody;
      const answer = await placeHold(trx, {
        target: body.target,
        reason: body.reason,
        by: principalId,
      });
      if (answer.answer === 'target.missing') throw notFound();
      if (answer.answer !== 'placed') throw emptyReason();
      return viewOf(trx, answer.id);
    },

    releaseHold: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as HoldParams;
      const { reason } = request.body as ReleaseHoldBody;
      const answer = await releaseHold(trx, { hold: id, reason, by: principalId });
      if (answer.answer === 'hold.missing') throw notFound();
      if (answer.answer === 'reason.invalid') throw emptyReason();
      if (answer.answer === 'hold.released') {
        throw refused(409, 'hold.released', 'This hold was released already.');
      }
      return viewOf(trx, id);
    },

    listHolds: async (request: FastifyRequest, { trx }: Authorised): Promise<HoldList> => {
      const query = request.query as PageQuery;
      const after = afterCursor(query.cursor);
      const page = await listHolds(trx, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return {
        items: page.items.map(holdView),
        next: cursorAfter(page.after),
        total: await countHolds(trx),
      };
    },
  };
}
