import { z } from 'zod';
import { rateLimited } from './model-limits.js';
import type { RouteContract } from './contract.js';
import { ListedPromptView } from './prompt-libraries.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const PromptRunParams = z.object({ id: LowercaseUuid });
export const DocumentPromptsQuery = z.object({
  node: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('A part, by its node: only the approved prompts that write its component type'),
});
export type DocumentPromptsQuery = z.infer<typeof DocumentPromptsQuery>;
export const PromptRunBody = z.strictObject({
  prompt: LowercaseUuid.describe("A prompt the document's template's library lists"),
  node: z.string().min(1).max(64).describe('The part it writes, by its node in the outline'),
  fresh: z
    .boolean()
    .optional()
    .describe(
      'True calls the model, never reusing your own identical run of the last 24 hours (GEN-036)',
    ),
});
export type PromptRunBody = z.infer<typeof PromptRunBody>;

export const PromptTrialParams = z.object({ id: LowercaseUuid, version: LowercaseUuid });
export const PromptTrialBody = z.strictObject({
  document: LowercaseUuid.describe('A document the trial reads, as its runner may read it'),
  node: z.string().min(1).max(64).describe('The part it would write, by its node in the outline'),
});
export type PromptTrialBody = z.infer<typeof PromptTrialBody>;

export const DocumentPrompts = z.object({
  library: z.object({ id: z.string(), isDefault: z.boolean() }),
  prompts: z
    .array(ListedPromptView)
    .describe(
      'Each prompt the library lists, at the revision a run of it runs, as the caller reads it',
    ),
});
export type DocumentPrompts = z.infer<typeof DocumentPrompts>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const refusedBeforeAnyCall = {
  description:
    '`model_unconfigured`: no endpoint is set up for its purpose; `endpoint_unusable`: it is retired or has no key; ' +
    '`model_mismatch`: the endpoint’s model is not one the prompt accepts; `context_empty`: its context resolved to nothing; ' +
    '`context_too_large`: more than the endpoint takes, both sizes named; `part_not_writable`: the part holds what a proposal cannot write; ' +
    '`prompt_output_mismatch`: the part is of another component type than the prompt writes. ' +
    'Each before any call',
  schema: ErrorBody,
} as const;
const stream = (what: string) => ({
  description: `Server-sent events, as the AsyncAPI document’s \`assistantRun\` channel declares them: \`run\`, then \`text\` as it comes, ${what}, and \`ended\` or \`failed\``,
  stream: true as const,
});

/**
 * A prompt's runs (generation.md, "Prompts"; the G4 plan, G4-I): on a part of a document, its output a
 * proposal; or as a trial of a version, its output kept on the run and proposed nowhere.
 */
export const promptRunRoutes = {
  listDocumentPrompts: {
    operationId: 'listDocumentPrompts',
    method: 'GET',
    path: '/v1/documents/{id}/prompts',
    summary: "The prompts a document may run: its template's library, each at the revision it runs",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: PromptRunParams,
    query: DocumentPromptsQuery,
    responses: {
      200: { description: 'The library and its prompts', schema: DocumentPrompts },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may not read is not found',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document you may read, or no part you may read at that node',
        schema: ErrorBody,
      },
    },
  },
  startPromptRun: {
    operationId: 'startPromptRun',
    method: 'POST',
    path: '/v1/documents/{id}/prompt-runs',
    summary: "Run a prompt of the document's library on one of its parts, its output a proposal",
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'read',
      target: { artifact: 'id' },
      credential: 'session',
    },
    params: PromptRunParams,
    body: PromptRunBody,
    idempotencyKey: false,
    responses: {
      200: stream('one `proposal` of the part’s whole text'),
      401: unauthenticated,
      403: {
        description:
          'A personal token, or the caller may not suggest on the part: a run takes a session, and proposes',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such document you may read, no part you may read at that node, or no approved prompt its library lists by that id',
        schema: ErrorBody,
      },
      409: refusedBeforeAnyCall,
      429: rateLimited,
      503: { description: '`connector_unavailable`', schema: ErrorBody },
    },
  },
  startPromptTrial: {
    operationId: 'startPromptTrial',
    method: 'POST',
    path: '/v1/prompts/{id}/versions/{version}/trials',
    summary: 'Try a version of a prompt on a part of a document, proposing nothing',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'read',
      target: { artifact: 'id' },
      credential: 'session',
    },
    params: PromptTrialParams,
    body: PromptTrialBody,
    idempotencyKey: false,
    responses: {
      200: stream('its output kept on the run, and proposed nowhere'),
      401: unauthenticated,
      403: { description: 'A personal token: a trial takes a session', schema: ErrorBody },
      404: {
        description:
          'No such prompt version you may read, no such document you may read, or no part you may read at that node',
        schema: ErrorBody,
      },
      409: refusedBeforeAnyCall,
      429: rateLimited,
      503: { description: '`connector_unavailable`', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
