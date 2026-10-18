import { contextSourceSchema, promptSchema } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { PromptRefusal } from './prompts.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const PersonalPromptParams = z.object({ id: LowercaseUuid });

export const PersonalPromptBody = z.strictObject({
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(20000),
});
export type PersonalPromptBody = z.infer<typeof PersonalPromptBody>;

export const PersonalPromptView = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  changedAt: z.string(),
  promotedTo: z.string().nullable().describe('The prompt it became, once promoted'),
});

export const PersonalPromptList = z.object({
  items: z.array(PersonalPromptView).describe('Your own, the latest changed first, at most 200'),
});

/** What promoting needs beyond the words: where, and what the prompt declares (GEN-055). */
export const PromotionBody = z.strictObject({
  space: LowercaseUuid.describe('A space you may edit in, where the prompt is made at draft'),
  description: promptSchema.shape.description.optional(),
  context: z.array(contextSourceSchema).min(1).max(16),
  output: promptSchema.shape.output,
  models: promptSchema.shape.models,
});
export type PromotionBody = z.infer<typeof PromotionBody>;

export const PromotionView = z.object({
  personal: PersonalPromptView,
  prompt: z
    .object({ id: z.string(), space: z.object({ id: z.string(), name: z.string() }) })
    .describe('The prompt made, at 0.1 and draft, which review and a trial govern like any other'),
});

const SESSION = { check: 'session', credential: 'session' } as const;
const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const token = {
  description: 'A personal token: your prompts take a session',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No personal prompt of yours by that id: anybody else’s is not found',
  schema: ErrorBody,
} as const;

/**
 * Personal prompts (generation.md, "The conversation"; the G5 plan, G5-G; GEN-054, GEN-055): your own
 * saved words, which nobody else reads or runs, and which a template never binds. Promoting one is the
 * one path to a shared prompt.
 */
export const personalPromptRoutes = {
  listPersonalPrompts: {
    operationId: 'listPersonalPrompts',
    method: 'GET',
    path: '/v1/me/prompts',
    summary: 'Your personal prompts',
    tenantScoped: true,
    access: SESSION,
    responses: {
      200: { description: 'Your own', schema: PersonalPromptList },
      401: unauthenticated,
      403: token,
    },
  },
  savePersonalPrompt: {
    operationId: 'savePersonalPrompt',
    method: 'POST',
    path: '/v1/me/prompts',
    summary: 'Save a personal prompt',
    tenantScoped: true,
    access: SESSION,
    body: PersonalPromptBody,
    responses: {
      200: { description: 'Saved', schema: PersonalPromptView },
      401: unauthenticated,
      403: token,
      409: {
        description: '`personal_prompts_full`: you keep as many as one may',
        schema: ErrorBody,
      },
    },
  },
  changePersonalPrompt: {
    operationId: 'changePersonalPrompt',
    method: 'PUT',
    path: '/v1/me/prompts/{id}',
    summary: 'Change a personal prompt',
    tenantScoped: true,
    access: SESSION,
    params: PersonalPromptParams,
    body: PersonalPromptBody,
    responses: {
      200: { description: 'Changed', schema: PersonalPromptView },
      401: unauthenticated,
      403: token,
      404: notFound,
    },
  },
  removePersonalPrompt: {
    operationId: 'removePersonalPrompt',
    method: 'POST',
    path: '/v1/me/prompts/{id}/removal',
    summary: 'Delete a personal prompt',
    tenantScoped: true,
    access: SESSION,
    params: PersonalPromptParams,
    responses: {
      200: { description: 'Deleted', schema: z.object({ removed: z.literal(true) }) },
      401: unauthenticated,
      403: token,
      404: notFound,
    },
  },
  promotePersonalPrompt: {
    operationId: 'promotePersonalPrompt',
    method: 'POST',
    path: '/v1/me/prompts/{id}/promotion',
    summary: 'Promote a personal prompt into a space, as a new prompt at draft',
    tenantScoped: true,
    access: SESSION,
    params: PersonalPromptParams,
    body: PromotionBody,
    responses: {
      200: { description: 'Promoted', schema: PromotionView },
      400: {
        description: '`prompt_invalid`: the prompt it would make fails a rule, each problem named',
        schema: PromptRefusal,
      },
      401: unauthenticated,
      403: { description: 'A personal token, or you may not edit in the space', schema: ErrorBody },
      404: notFound,
      409: { description: '`already_promoted`: it has been promoted once', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
