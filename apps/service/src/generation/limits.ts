import type { ModelLimitBody, PersonLimitBody } from '@alloy-works/api-contract';
import {
  rateRefusal,
  readGenerationLimits,
  setGenerationLimit,
  setPersonLimit,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';

import { notFound, type Authorised } from '../access.js';
import { AppError } from '../errors.js';

/**
 * Rate limits (the G6 plan, G6-A; GEN-035): `administer` at the environment, every change audited;
 * and the check, made in a route's transaction and again as the run starts.
 */

const view = async (trx: TenantTransaction) => {
  const limits = await readGenerationLimits(trx);
  return { perHour: limits.perHour, people: [...limits.people] };
};

export const rateLimitedWords = (resetsAt: Date) =>
  `You have started as many model runs this hour as you may. One is free again at ${resetsAt.toISOString()}.`;

/** Refuses a person over their hourly limit, before anything is called (GEN-035). */
export async function refuseOverLimit(trx: TenantTransaction, principalId: string): Promise<void> {
  const over = await rateRefusal(trx, principalId);
  if (over) {
    throw new AppError(429, 'model_rate_limited', rateLimitedWords(over.resetsAt), undefined, {
      resetsAt: over.resetsAt.toISOString(),
    });
  }
}

/** A run refused as it started, its person over their limit by runs started meanwhile. */
export class RateLimited extends Error {
  constructor(readonly resetsAt: Date) {
    super('model_rate_limited');
  }
}

/** The check again as a run starts, under the person's lock, so runs started at once are counted. */
export async function startLimited<T>(
  trx: TenantTransaction,
  principalId: string,
  start: () => Promise<T>,
): Promise<T> {
  const over = await rateRefusal(trx, principalId, { lock: true });
  if (over) throw new RateLimited(over.resetsAt);
  return start();
}

export function modelLimitHandlers() {
  return {
    getModelLimits: async (_request: FastifyRequest, { trx }: Authorised) => view(trx),

    setModelLimit: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { perHour } = request.body as ModelLimitBody;
      await setGenerationLimit(trx, perHour, principalId);
      return view(trx);
    },

    setPersonLimit: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { principal } = request.params as { principal: string };
      const { perHour } = request.body as PersonLimitBody;
      if (!(await setPersonLimit(trx, principal, perHour, principalId))) throw notFound();
      return view(trx);
    },
  };
}
