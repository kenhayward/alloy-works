import type { BudgetRecipientsBody, ModelBudgetBody } from '@alloy-works/api-contract';
import {
  budgetRecipients,
  readBudget,
  setBudget,
  setBudgetRecipients,
  spendThisMonth,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';

import type { Authorised } from '../access.js';
import { AppError } from '../errors.js';
import { microsText } from './money.js';

/**
 * The model budget's routes (the G6 plan, G6-B to G6-D): `administer` at the environment, every change
 * audited. Nothing stops when it is spent, and the view says so (ADM-014).
 */

const units = (micros: bigint) => Number(micros) / 1_000_000;

async function view(trx: TenantTransaction) {
  const budget = await readBudget(trx);
  // The month as the budget counts it: UTC's.
  const month = new Date().toISOString().slice(0, 7);
  const spent = budget ? await spendThisMonth(trx, budget.currency) : undefined;
  return {
    budget: budget && {
      currency: budget.currency,
      limit: units(budget.limitMicros),
      thresholds: [...budget.thresholds],
    },
    month,
    spent: microsText(spent?.micros ?? 0n),
    otherCurrencyRuns: spent?.otherCurrencyRuns ?? 0,
    recipients: await budgetRecipients(trx),
    whenSpent: 'everything_continues' as const,
  };
}

export function modelBudgetHandlers() {
  return {
    getModelBudget: async (_request: FastifyRequest, { trx }: Authorised) => view(trx),

    setModelBudget: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { budget } = request.body as ModelBudgetBody;
      if (budget !== null) {
        const rising = budget.thresholds.every(
          (one, at) => at === 0 || one > budget.thresholds[at - 1]!,
        );
        if (!rising || budget.thresholds[0]! >= 100) {
          throw new AppError(
            400,
            'invalid_request',
            'Thresholds rise, each once, and at least one is below 100.',
          );
        }
      }
      await setBudget(
        trx,
        budget && {
          currency: budget.currency,
          limitMicros: BigInt(Math.round(budget.limit * 1_000_000)),
          thresholds: budget.thresholds,
        },
        principalId,
      );
      return view(trx);
    },

    setBudgetRecipients: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { principals } = request.body as BudgetRecipientsBody;
      const { refused } = await setBudgetRecipients(trx, principals, principalId);
      if (refused.length > 0) {
        throw new AppError(
          400,
          'recipient_not_administrator',
          'Only people from inside who administer the environment are told of spend.',
          undefined,
          { refused },
        );
      }
      return view(trx);
    },
  };
}
