import { contentDocumentSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { rateLimited } from './model-limits.js';

import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * The drafting assistant (generation.md, "The assistant" and "Proposals"; the G2 plan): a run
 * against the open document, streamed; its proposals acted on by its requester; a run read back by
 * its requester alone; and what their runs cost this month.
 */
export const AssistantRunParams = z.object({ id: LowercaseUuid });
export type AssistantRunParams = z.infer<typeof AssistantRunParams>;

export const AssistantRunBody = z.strictObject({
  ask: z.string().trim().min(1).max(8000).describe('What the author asks the assistant'),
  component: LowercaseUuid.optional().describe('The component the author has open, if one is'),
});
export type AssistantRunBody = z.infer<typeof AssistantRunBody>;

export const ProposalParams = z.object({ id: LowercaseUuid });
export type ProposalParams = z.infer<typeof ProposalParams>;

export const ProposalActed = z.object({
  proposal: z.object({
    id: z.string(),
    state: z.enum(['accepted', 'kept', 'discarded']),
    suggestion: z
      .string()
      .nullable()
      .describe('The suggestion made from it: accepted at once, or kept for review'),
    component: z
      .string()
      .optional()
      .describe('A proposal to make a component, accepted: the component made, at 0.1'),
  }),
});
export type ProposalActed = z.infer<typeof ProposalActed>;

export const AssistantRunView = z.object({
  run: z.object({
    id: z.string(),
    document: z.string().nullable(),
    purpose: z
      .string()
      .describe('What it ran for: `drafting` for the assistant, a prompt’s purpose, or `trial`'),
    promptVersion: z
      .string()
      .nullable()
      .describe('The prompt version it ran, or null for the assistant (GEN-006)'),
    parameters: z
      .record(z.string(), z.unknown())
      .describe('What it was run with: its reply’s limit, and the instructions’ version'),
    endpoint: z.object({ name: z.string(), boundary: z.string() }),
    ask: z.string().nullable().describe('What the person asked, or null for a prompt run (GN-I)'),
    reply: z
      .string()
      .nullable()
      .describe('What the model wrote, set as the run ended; null while it runs (GN-I)'),
    model: z.string().nullable(),
    outcome: z.string(),
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    tokensIn: z.number().int().nullable(),
    tokensOut: z.number().int().nullable(),
    cost: z.string().nullable(),
    currency: z.string(),
    contextDigest: z
      .string()
      .describe(
        'SHA-256 of what the model was last given, which a suggestion made from it carries',
      ),
    read: z.array(z.unknown()).describe('Each component version the run read, and its blocks'),
    steps: z.array(z.unknown()).describe('Each tool call, its arguments, and what came back'),
    proposals: z.array(
      z.object({
        id: z.string(),
        number: z.number().int(),
        component: z.string().nullable(),
        state: z.enum(['open', 'accepted', 'kept', 'discarded', 'resolved']),
        suggestion: z.string().nullable(),
      }),
    ),
  }),
});
export type AssistantRunView = z.infer<typeof AssistantRunView>;

export const AssistantUsage = z.object({
  runs: z.number().int().describe('Your runs of the assistant this calendar month, UTC'),
  costs: z.array(z.object({ currency: z.string(), cost: z.string() })),
});
export type AssistantUsage = z.infer<typeof AssistantUsage>;

/** The proposed content a `proposal` event carries, as the AsyncAPI document declares it. */
export const ProposedContent = contentDocumentSchema;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const proposalMissing = {
  description: 'No such proposal of yours in this environment',
  schema: ErrorBody,
} as const;
const SESSION = { check: 'session', credential: 'session' } as const;
const tokenRefused = {
  description: '`token_not_allowed`: the assistant takes a signed-in session alone',
  schema: ErrorBody,
} as const;

const actOn = (operationId: string, path: string, summary: string, needs: string) =>
  ({
    operationId,
    method: 'POST',
    path,
    summary,
    tenantScoped: true,
    access: SESSION,
    params: ProposalParams,
    idempotencyKey: false,
    responses: {
      200: { description: 'Acted on, once', schema: ProposalActed },
      400: {
        description:
          'A save’s checks: `term_unreadable` or `citation_unreadable`, its content naming a term or an entry of the component’s space the caller may not read',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: `The caller may not ${needs} the component; or \`entry_not_writable\`: a citation of a source accepted, no entry of the component’s space holds it, and the caller may not make one there`,
        schema: ErrorBody,
      },
      404: proposalMissing,
      409: {
        description:
          '`proposal_resolved`; `proposal_cites`: a citation of a source kept, which is accepted or discarded alone; `entry_refused`: its entry could not be made; or the suggestion’s own refusals: `suggestion.empty`, `suggestion.limit`, `suggestion.stale`, `lock.held`, `edits.pending`, `values.invalid`',
        schema: ErrorBody,
      },
    },
  }) as const;

export const assistantRoutes = {
  startAssistantRun: {
    operationId: 'startAssistantRun',
    method: 'POST',
    path: '/v1/documents/{id}/assistant/runs',
    summary: 'Ask the assistant about the open document, its answer streamed as it is made',
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'read',
      target: { artifact: 'id' },
      credential: 'session',
    },
    params: AssistantRunParams,
    body: AssistantRunBody,
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'Server-sent events, as the AsyncAPI document’s `assistantRun` channel declares them: `run`, then `text`, `tool_call`, `tool_result` and `proposal` as they come, and `ended` or `failed`',
        stream: true,
      },
      401: unauthenticated,
      403: {
        description: 'A personal token: the assistant takes a session alone',
        schema: ErrorBody,
      },
      404: { description: 'No such document you may read', schema: ErrorBody },
      409: {
        description:
          '`model_unconfigured`: no endpoint is set up for drafting; `endpoint_unusable`: it is retired or has no key',
        schema: ErrorBody,
      },
      429: rateLimited,
      503: { description: '`connector_unavailable`', schema: ErrorBody },
    },
  },
  getAssistantRun: {
    operationId: 'getAssistantRun',
    method: 'GET',
    path: '/v1/assistant/runs/{id}',
    summary: 'A run of the assistant you made: each call, what it read and what came back',
    tenantScoped: true,
    access: SESSION,
    params: AssistantRunParams,
    responses: {
      200: { description: 'The run', schema: AssistantRunView },
      401: unauthenticated,
      403: tokenRefused,
      404: { description: 'No such run of yours in this environment', schema: ErrorBody },
    },
  },
  getAssistantUsage: {
    operationId: 'getAssistantUsage',
    method: 'GET',
    path: '/v1/me/assistant-usage',
    summary: 'Your runs of the assistant this month, and what they cost',
    tenantScoped: true,
    access: SESSION,
    responses: {
      200: { description: 'This month, by currency', schema: AssistantUsage },
      401: unauthenticated,
      403: tokenRefused,
    },
  },
  acceptProposal: actOn(
    'acceptProposal',
    '/v1/assistant/proposals/{id}/acceptance',
    'Accept a proposal: a suggestion made from it and accepted at once, as you',
    'edit',
  ),
  keepProposal: actOn(
    'keepProposal',
    '/v1/assistant/proposals/{id}/keeping',
    'Keep a proposal as a suggestion, marked generated, for review',
    'suggest changes to',
  ),
  discardProposal: actOn(
    'discardProposal',
    '/v1/assistant/proposals/{id}/discarding',
    'Discard a proposal: it is kept, recorded as discarded by you',
    'read',
  ),
} as const satisfies Record<string, RouteContract>;
