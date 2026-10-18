import type { PersonalPromptBody, PromotionBody } from '@alloy-works/api-contract';
import {
  changePersonalPrompt,
  createPrompt,
  deletePersonalPrompt,
  listPersonalPrompts,
  readPersonalPrompt,
  recordPromotion,
  savePersonalPrompt,
  type PersonalPrompt,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';

import { authoriseAt, callerOf, notFound } from '../access.js';
import { contextOf } from '../audit.js';
import { AppError } from '../errors.js';
import type { SessionPrincipal } from '../sessions.js';
import { refused } from '../wire-codes.js';

/**
 * Personal prompts (the G5 plan, G5-G; GEN-054, GEN-055): a session's own, each route deciding who
 * owns one, anybody else's answered as none. Promoting one makes a new prompt at draft in a space its
 * owner may edit, the one path from a personal prompt to a shared one.
 */

const view = (prompt: PersonalPrompt) => ({
  id: prompt.id,
  title: prompt.title,
  instructions: prompt.instructions,
  changedAt: prompt.changedAt.toISOString(),
  promotedTo: prompt.promotedTo,
});

export function personalPromptHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  const asOwner = <T>(
    request: FastifyRequest,
    work: (trx: TenantTransaction, owner: string) => Promise<T>,
  ) =>
    db.withTenant(
      tenantOf(request),
      (trx) => work(trx, principalOf(request).principalId),
      contextOf(request),
    );

  return {
    listPersonalPrompts: (request: FastifyRequest) =>
      asOwner(request, async (trx, owner) => ({
        items: (await listPersonalPrompts(trx, owner)).map(view),
      })),

    savePersonalPrompt: (request: FastifyRequest) =>
      asOwner(request, async (trx, owner) => {
        const saved = await savePersonalPrompt(trx, owner, request.body as PersonalPromptBody);
        if (saved === 'full') {
          throw new AppError(409, 'personal_prompts_full', 'You keep as many prompts as one may.');
        }
        return view(saved);
      }),

    changePersonalPrompt: (request: FastifyRequest) =>
      asOwner(request, async (trx, owner) => {
        const { id } = request.params as { id: string };
        const changed = await changePersonalPrompt(
          trx,
          owner,
          id,
          request.body as PersonalPromptBody,
        );
        if (!changed) throw notFound();
        return view(changed);
      }),

    removePersonalPrompt: (request: FastifyRequest) =>
      asOwner(request, async (trx, owner) => {
        const { id } = request.params as { id: string };
        if (!(await deletePersonalPrompt(trx, owner, id))) throw notFound();
        return { removed: true as const };
      }),

    promotePersonalPrompt: (request: FastifyRequest) =>
      asOwner(request, async (trx, owner) => {
        const { id } = request.params as { id: string };
        const personal = await readPersonalPrompt(trx, owner, id);
        if (!personal) throw notFound();
        // Promoted once: the prompt it became goes its own way, and another is made by saving anew.
        if (personal.promotedTo !== null) {
          throw new AppError(409, 'already_promoted', 'This prompt has been promoted already.');
        }
        const body = request.body as PromotionBody;
        // A deliberate act, decided at the space as making any prompt is (GEN-055).
        await authoriseAt(trx, callerOf(request), 'edit', { kind: 'space', id: body.space });
        const made = await createPrompt(trx, {
          author: owner,
          spaceId: body.space,
          prompt: {
            schemaVersion: 1,
            title: personal.title,
            description: body.description ?? '',
            instructions: personal.instructions,
            context: body.context,
            output: body.output,
            models: body.models,
          },
        });
        if (made.answer === 'prompt.refused') {
          throw refused(400, 'prompt.invalid', 'The prompt is not valid.', {
            problems: made.problems,
          });
        }
        if (made.answer !== 'created') throw notFound();
        await recordPromotion(trx, owner, id, made.prompt.id);
        const promoted = (await readPersonalPrompt(trx, owner, id))!;
        return {
          personal: view(promoted),
          prompt: { id: made.prompt.id, space: made.prompt.space },
        };
      }),
  };
}
