import type { ModelUsageQuery } from '@alloy-works/api-contract';
import { usageByMonth } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';

import type { Authorised } from '../access.js';
import { microsText } from './money.js';

/** The months a trend shows, the oldest first, ending with this one, UTC. */
function monthsEnding(count: number, now = new Date()): string[] {
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push(at.toISOString().slice(0, 7));
  }
  return months;
}

/** Spend as a trend (the G6 plan, G6-F): `administer` at the environment. */
export function modelUsageHandlers() {
  return {
    getModelUsage: async (request: FastifyRequest, { trx }: Authorised) => {
      const { months } = request.query as ModelUsageQuery;
      const count = months === undefined ? 12 : Number(months);
      const usage = await usageByMonth(trx, count);
      return {
        months: monthsEnding(count),
        models: usage.models.map((each) => ({
          month: each.month,
          purpose: each.purpose,
          runs: each.runs,
          tokensIn: each.tokensIn,
          tokensOut: each.tokensOut,
          tokensCached: each.tokensCached,
          costs: each.costs.map((cost) => ({
            currency: cost.currency,
            cost: microsText(cost.micros),
          })),
        })),
        queries: usage.queries,
      };
    },
  };
}
