import { promptSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { SpaceParams, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { FacetCountView, idsFilter, listingQuery, listingTotal, nextCursor } from './listing.js';
import { ErrorBody, LowercaseUuid, SPACE_ARCHIVED } from './schemas.js';

export const PromptParams = z.object({ id: LowercaseUuid });
export type PromptParams = z.infer<typeof PromptParams>;

/**
 * A prompt version (generation.md, "Prompts"; the G4 plan, G4-A), the domain's own shape: checked at
 * the door by its shape, and by its rules once the handler runs.
 */
export const CreatePromptBody = z.strictObject({ prompt: promptSchema });
export type CreatePromptBody = z.infer<typeof CreatePromptBody>;

/** A prompt's next version: the whole prompt, from the version it was opened at (API-037). */
export const PromptVersionBody = z.strictObject({
  openedFrom: LowercaseUuid,
  prompt: promptSchema,
});
export type PromptVersionBody = z.infer<typeof PromptVersionBody>;

export const PromptView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  prompt: promptSchema,
  mayEdit: z.boolean().describe('Whether the caller may cut its next version: edit on it'),
});
export type PromptView = z.infer<typeof PromptView>;

export const PromptSummary = z.object({
  id: z.string(),
  title: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  purpose: z.string().describe('The purpose its runs are routed by'),
  version: z.object({ id: z.string(), number: z.string() }),
  changedAt: z.string().describe('When its latest version was made'),
});
export const PromptList = z.object({
  items: z.array(PromptSummary),
  next: nextCursor,
  total: listingTotal,
  facets: z
    .object({ spaces: z.array(FacetCountView) })
    .describe(
      'Each filter the listing takes, counted with the others in force and its own left out',
    ),
});
export type PromptList = z.infer<typeof PromptList>;

export const PromptListQuery = z.object({
  ...listingQuery(['title', 'changed'], 'title'),
  spaces: idsFilter.optional().describe('Only prompts in these spaces, by id'),
});
export type PromptListQuery = z.infer<typeof PromptListQuery>;

/**
 * A prompt refused: by its rules (`prompt_invalid`), each problem named, or the prompt as it now
 * stands where the version it was opened at is no longer the latest (`version_precondition`).
 */
export const PromptRefusal = ErrorBody.extend({
  problems: z
    .array(
      z.object({
        rule: z.literal('prompt_invalid'),
        path: z.string().describe('The member refused, dotted, as `context.2.field`'),
        message: z.string(),
      }),
    )
    .optional(),
  current: PromptView.optional(),
});
export type PromptRefusal = z.infer<typeof PromptRefusal>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such prompt in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const promptRefused = {
  description:
    '`prompt_invalid`: the prompt fails a rule, each problem named: a parameter placed that its context does not declare, a source declared twice, or a definition it names that is not there',
  schema: PromptRefusal,
} as const;

/**
 * Prompts (generation.md, "Prompts"; the G4 plan, G4-A): `edit` in the space makes and changes one;
 * `read` shows one.
 */
export const promptRoutes = {
  listPrompts: {
    operationId: 'listPrompts',
    method: 'GET',
    path: '/v1/prompts',
    summary: 'The prompts the caller may read, each with its space and purpose',
    tenantScoped: true,
    access: { check: 'session' },
    query: PromptListQuery,
    responses: {
      200: { description: 'A page of prompts', schema: PromptList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
    },
  },
  createPrompt: {
    operationId: 'createPrompt',
    method: 'POST',
    path: '/v1/spaces/{space}/prompts',
    summary: 'Make a prompt in this space, at version 0.1',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { space: 'space' } },
    params: SpaceParams,
    body: CreatePromptBody,
    responses: {
      200: { description: 'Made, at version 0.1', schema: PromptView },
      400: promptRefused,
      401: unauthenticated,
      403: { description: 'The caller may not edit in the space', schema: ErrorBody },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: { description: SPACE_ARCHIVED, schema: ErrorBody },
    },
  },
  getPrompt: {
    operationId: 'getPrompt',
    method: 'GET',
    path: '/v1/prompts/{id}',
    summary: 'A prompt at its latest version',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: PromptParams,
    responses: {
      200: { description: 'The prompt', schema: PromptView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a prompt the caller may not read is not found',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  recordPromptVersion: {
    operationId: 'recordPromptVersion',
    method: 'POST',
    path: '/v1/prompts/{id}/versions',
    summary: "Cut a prompt's next version from the one the caller opened",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: PromptParams,
    body: PromptVersionBody,
    responses: {
      200: {
        description:
          'The prompt at its latest version: the one cut, or the one before where nothing changed',
        schema: PromptView,
      },
      400: promptRefused,
      401: unauthenticated,
      403: {
        description: 'The caller may read the prompt but may not edit it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description:
          '`version_precondition`: the prompt has a newer version than the one named, answered with it; ' +
          SPACE_ARCHIVED,
        schema: PromptRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
