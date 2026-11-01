import { z } from 'zod';
import { rateLimited } from './model-limits.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const ConversationParams = z.object({ id: LowercaseUuid });

export const StartConversationBody = z.strictObject({
  document: LowercaseUuid.optional().describe('The document it is about, or none'),
  title: z.string().trim().min(1).max(200).describe('What it is called: its first words, say'),
});
export type StartConversationBody = z.infer<typeof StartConversationBody>;

export const UpdateConversationBody = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional().describe('Its new name'),
    kept: z
      .boolean()
      .optional()
      .describe('Whether it is kept, and so listed; naming one keeps it unless this says not'),
  })
  .refine((body) => body.title !== undefined || body.kept !== undefined, {
    message: 'Name it, or say whether it is kept',
  })
  .meta({ minProperties: 1 });
export type UpdateConversationBody = z.infer<typeof UpdateConversationBody>;

const kept = z
  .boolean()
  .describe('Whether its owner kept it: one not kept is held with its runs, and never listed');

/** A conversation as a list shows it, and as a change to it answers. */
export const ConversationItem = z.object({
  id: z.string(),
  document: z.string().nullable(),
  title: z.string(),
  madeAt: z.string(),
  kept,
});

export const TurnBody = z.strictObject({
  ask: z.string().trim().min(1).max(8000).describe('What the person says'),
  endpoint: LowercaseUuid.optional().describe(
    'The endpoint the turn runs on, among those in use: the chat route’s where none is named, else drafting’s',
  ),
  component: LowercaseUuid.optional().describe('The component the author has open, if one is'),
  context: z
    .enum(['component', 'document'])
    .optional()
    .describe(
      'What the assistant is given to read with the ask: `component`, the component open; `document`, every component of the document the person may read. Neither where unsaid: it reads what its tools find',
    ),
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
    kept,
    turns: z.array(TurnView).describe('Each turn, oldest first'),
  }),
});
export type ConversationView = z.infer<typeof ConversationView>;

export const ConversationList = z.object({
  items: z
    .array(ConversationItem)
    .describe('The caller’s own they kept, the newest first, at most 200'),
});

export const ConversationListQuery = z.object({
  document: LowercaseUuid.optional().describe('Only those about this document'),
});

export const TrayParams = z.object({ id: LowercaseUuid, component: LowercaseUuid });

export const TrayBody = z.strictObject({
  component: LowercaseUuid.describe(
    'A component the person may read, placed in the document where it has one',
  ),
});

export const ConversationTray = z.object({
  items: z
    .array(
      z.object({
        component: z.string(),
        version: z
          .string()
          .nullable()
          .describe(
            'The version the next turn reads, or null where the person may no longer read it',
          ),
        readable: z.boolean(),
      }),
    )
    .describe(
      'Each part the conversation reads, re-read as the person now: the oldest added first',
    ),
});

export const ConversationEndpoints = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        model: z.string(),
        contextWindow: z
          .number()
          .int()
          .positive()
          .describe('The most tokens its model takes in one call: what a turn is measured against'),
        boundary: z.string().describe('`outside` where it sits outside the data boundary'),
        isDefault: z.boolean().describe('The one a turn naming none runs on'),
      }),
    )
    .describe('Every LLM in use with its key set: never an embedding model, which answers nothing'),
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
  updateConversation: {
    operationId: 'updateConversation',
    method: 'PATCH',
    path: '/v1/conversations/{id}',
    summary: 'Names a conversation of the caller’s, or keeps or lets it go',
    tenantScoped: true,
    access: SESSION,
    params: ConversationParams,
    body: UpdateConversationBody,
    responses: {
      200: { description: 'As it now stands', schema: ConversationItem },
      400: {
        description: 'Asked for nothing, a name empty or too long, or anything else',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: token,
      404: notFound,
    },
  },
  getConversationContext: {
    operationId: 'getConversationContext',
    method: 'GET',
    path: '/v1/conversations/{id}/context',
    summary: 'What a conversation of the caller’s reads, as they may read it now',
    tenantScoped: true,
    access: SESSION,
    params: ConversationParams,
    responses: {
      200: { description: 'Its tray', schema: ConversationTray },
      401: unauthenticated,
      403: token,
      404: notFound,
    },
  },
  addConversationContext: {
    operationId: 'addConversationContext',
    method: 'POST',
    path: '/v1/conversations/{id}/context',
    summary: 'Add a part to what a conversation reads',
    tenantScoped: true,
    access: SESSION,
    params: ConversationParams,
    body: TrayBody,
    responses: {
      200: { description: 'Its tray, with the part', schema: ConversationTray },
      401: unauthenticated,
      403: token,
      404: {
        description:
          'No conversation of the caller’s by that id, or no component they may read by that id, placed in its document where it has one',
        schema: ErrorBody,
      },
      409: { description: '`tray_full`: it reads as many parts as one may', schema: ErrorBody },
    },
  },
  removeConversationContext: {
    operationId: 'removeConversationContext',
    method: 'POST',
    path: '/v1/conversations/{id}/context/{component}/removal',
    summary: 'Remove a part from what a conversation reads',
    tenantScoped: true,
    access: SESSION,
    params: TrayParams,
    responses: {
      200: { description: 'Its tray, without the part', schema: ConversationTray },
      401: unauthenticated,
      403: token,
      404: { description: 'No conversation of the caller’s holding that part', schema: ErrorBody },
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
          'Server-sent events, as the AsyncAPI document’s `assistantRun` channel declares them: `run`, then `text`, `tool_call`, `tool_result`, `proposal` and `notice` as they come, and `ended` or `failed`',
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
          '`turn_running`: a turn of it has not ended; `conversation_too_long`: it has as many turns as one takes; `model_unconfigured`: no endpoint named or routed; `endpoint_unusable`: the one named is retired, has no key, or is not this environment’s; `endpoint_kind_mismatch`: the one named is an embedding model',
        schema: ErrorBody,
      },
      429: rateLimited,
      503: { description: '`connector_unavailable`', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
