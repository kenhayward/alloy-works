import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const ConversationParams = z.object({ id: LowercaseUuid });

export const StartConversationBody = z.strictObject({
  document: LowercaseUuid.optional().describe('The document it is about, or none'),
  title: z.string().trim().min(1).max(200).describe('What it is called: its first words, say'),
});
export type StartConversationBody = z.infer<typeof StartConversationBody>;

export const TurnBody = z.strictObject({
  ask: z.string().trim().min(1).max(8000).describe('What the person says'),
  endpoint: LowercaseUuid.optional().describe(
    'The endpoint the turn runs on, among those in use: the chat route’s where none is named, else drafting’s',
  ),
  component: LowercaseUuid.optional().describe('The component the author has open, if one is'),
});
export type TurnBody = z.infer<typeof TurnBody>;

const Endpoint = z.object({ name: z.string(), boundary: z.string() });

export const TurnView = z.object({
  run: z.string(),
  ask: z.string().nullable(),
  reply: z.string().nullable().describe('Null while it runs'),
  outcome: z.string(),
  endpoint: Endpoint,
  model: z.string().nullable(),
  startedAt: z.string(),
});

export const ConversationView = z.object({
  conversation: z.object({
    id: z.string(),
    document: z.string().nullable(),
    title: z.string(),
    madeAt: z.string(),
    turns: z.array(TurnView).describe('Each turn, oldest first'),
  }),
});
export type ConversationView = z.infer<typeof ConversationView>;

export const ConversationList = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        document: z.string().nullable(),
        title: z.string(),
        madeAt: z.string(),
      }),
    )
    .describe('The caller’s own, the newest first, at most 200'),
});

export const ConversationListQuery = z.object({
  document: LowercaseUuid.optional().describe('Only those about this document'),
});

export const ConversationEndpoints = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        model: z.string(),
        boundary: z.string().describe('`outside` where it sits outside the data boundary'),
        isDefault: z.boolean().describe('The one a turn naming none runs on'),
      }),
    )
    .describe('Every endpoint in use with its key set'),
});

const SESSION = { check: 'session', credential: 'session' } as const;
const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const token = {
  description: 'A personal token: a conversation takes a session',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No conversation of the caller’s by that id: anybody else’s is not found',
  schema: ErrorBody,
} as const;

/**
 * Conversations (generation.md, "The conversation"; the G5 plan, G5-A to G5-C): a person's own, on a
 * document or on none, each turn a run governed as the assistant's is.
 */
export const conversationRoutes = {
  listConversationEndpoints: {
    operationId: 'listConversationEndpoints',
    method: 'GET',
    path: '/v1/conversation-endpoints',
    summary: 'The endpoints a conversation may run on, the default marked',
    tenantScoped: true,
    access: SESSION,
    responses: {
      200: { description: 'The endpoints', schema: ConversationEndpoints },
      401: unauthenticated,
      403: token,
    },
  },
  startConversation: {
    operationId: 'startConversation',
    method: 'POST',
    path: '/v1/conversations',
    summary: 'Start a conversation, on a document the caller may read or on none',
    tenantScoped: true,
    access: SESSION,
    body: StartConversationBody,
    responses: {
      200: { description: 'Started, with no turns', schema: ConversationView },
      401: unauthenticated,
      403: token,
      404: { description: 'No such document the caller may read', schema: ErrorBody },
    },
  },
  listConversations: {
    operationId: 'listConversations',
    method: 'GET',
    path: '/v1/conversations',
    summary: 'The caller’s conversations, the newest first',
    tenantScoped: true,
    access: SESSION,
    query: ConversationListQuery,
    responses: {
      200: { description: 'Their conversations', schema: ConversationList },
      401: unauthenticated,
      403: token,
    },
  },
  getConversation: {
    operationId: 'getConversation',
    method: 'GET',
    path: '/v1/conversations/{id}',
    summary: 'A conversation of the caller’s, with its turns',
    tenantScoped: true,
    access: SESSION,
    params: ConversationParams,
    responses: {
      200: { description: 'The conversation', schema: ConversationView },
      401: unauthenticated,
      403: token,
      404: notFound,
    },
  },
  takeTurn: {
    operationId: 'takeTurn',
    method: 'POST',
    path: '/v1/conversations/{id}/turns',
    summary: 'Say something in a conversation, the answer streamed as it is made',
    tenantScoped: true,
    access: SESSION,
    params: ConversationParams,
    body: TurnBody,
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'Server-sent events, as the AsyncAPI document’s `assistantRun` channel declares them: `run`, then `text`, `tool_call`, `tool_result` and `proposal` as they come, and `ended` or `failed`',
        stream: true as const,
      },
      401: unauthenticated,
      403: token,
      404: {
        description:
          'No conversation of the caller’s by that id, or its document no longer one they may read',
        schema: ErrorBody,
      },
      409: {
        description:
          '`turn_running`: a turn of it has not ended; `conversation_too_long`: it has as many turns as one takes; `model_unconfigured`: no endpoint named or routed; `endpoint_unusable`: the one named is retired, has no key, or is not this environment’s',
        schema: ErrorBody,
      },
      503: { description: '`connector_unavailable`', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
