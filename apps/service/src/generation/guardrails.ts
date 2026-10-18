import type { GuardrailBody } from '@alloy-works/api-contract';
import {
  listGuardrails,
  retireGuardrail,
  setGuardrail,
  type StoredGuardrail,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';

import { notFound, type Authorised } from '../access.js';

/** The guardrail routes (the G5 plan, G5-F): `administer` at the environment, every change audited. */

const view = (rule: StoredGuardrail) => ({
  id: rule.id,
  phrase: rule.phrase,
  applies: rule.applies,
  reason: rule.reason,
  madeAt: rule.madeAt.toISOString(),
  retiredAt: rule.retiredAt?.toISOString() ?? null,
});

export function guardrailHandlers() {
  return {
    listGuardrails: async (request: FastifyRequest, { trx }: Authorised) => {
      const { retired } = request.query as { retired?: 'true' | 'false' };
      return { items: (await listGuardrails(trx, { retired: retired === 'true' })).map(view) };
    },

    setGuardrail: async (request: FastifyRequest, { trx, principalId }: Authorised) =>
      view(await setGuardrail(trx, request.body as GuardrailBody, principalId)),

    retireGuardrail: async (request: FastifyRequest, { trx }: Authorised) => {
      const { id } = request.params as { id: string };
      const retired = await retireGuardrail(trx, id);
      if (!retired) throw notFound();
      return view(retired);
    },
  };
}
