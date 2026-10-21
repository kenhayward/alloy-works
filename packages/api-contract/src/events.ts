import { z } from 'zod';

/**
 * **The stream's events** (API-015; the PL plan, PL-E): what `GET /v1/stream` sends, each frame's
 * `event` name and the shape of its `data`, declared here once and published as AsyncAPI 3.0 beside
 * `openapi.json`, which cannot say it (API-014): presence, locks and notifications (API-063). Events carry ids and states, never content: what
 * something says is fetched through the API, as the viewer may read it.
 */

const Id = z.string().describe('An id, as the API names the thing elsewhere');

export const LockEvent = z
  .object({
    component: Id,
    holder: z
      .object({ id: Id, name: z.string().nullable() })
      .nullable()
      .describe('Who holds it; null once it is free'),
    expectedRelease: z
      .string()
      .nullable()
      .describe('When it is free unless its holder goes on working, in UTC; null once it is free'),
    taking: z
      .object({ by: z.object({ id: Id, name: z.string().nullable() }), until: z.string() })
      .nullable()
      .describe(
        "Somebody asking to take it over, and when its holder's grace to keep it ends (COL-047); null where nobody is",
      ),
  })
  .describe("A component's lock, as it now stands (COL-007)");

export const PresenceEvent = z
  .object({
    viewer: Id.describe('The window, as its own beats name it'),
    person: z.object({
      id: Id,
      name: z.string().nullable(),
      external: z.literal(true).optional().describe('From outside the organisation (IAM-045)'),
    }),
    component: Id.nullable().describe(
      'Where they are; null between components, or where the viewer may not read it',
    ),
    mode: z
      .enum(['read', 'review', 'author'])
      .nullable()
      .describe('What they are doing; null where the viewer may not read where'),
    beatAt: z
      .string()
      .describe(
        'When their window last said so, in UTC: live for 30 seconds, stale to 60, then absent',
      ),
    ageMs: z
      .int()
      .describe(
        "How long before this was sent it beat, by the service's clock: what a viewer ages it by",
      ),
  })
  .describe('Somebody in the document, as the viewer may see them (COL-001 to COL-003, COL-055)');

export const PresenceLeftEvent = z
  .object({ viewer: Id })
  .describe('A window left the document, or fell silent past a minute');

export const SampleEvent = z
  .object({ kind: z.literal('sample'), id: Id, state: z.string() })
  .describe("A development sample's state");

export const OutlineEvent = z
  .object({ document: Id })
  .describe("The stream's document has a new version: read its outline again (STR-066)");

export const WorkflowEvent = z
  .object({
    artifact: Id.describe('The component or the document'),
    state: z.object({ key: z.string(), name: z.string() }),
  })
  .describe('A component or a document moved to another workflow state (LIF-005)');

export const InboxEvent = z
  .object({})
  .describe(
    'A notification waits for the viewer: read the inbox (COL-063). It names nothing, so it says nothing the inbox would not',
  );

export const PermissionsEvent = z
  .object({})
  .describe(
    "Somebody's access changed; the stream ends after this, and its next connection is authorised afresh (API-016)",
  );

export const ScopedSnapshot = z
  .object({
    locks: z.array(LockEvent).describe('Every held lock in the scope the viewer may read'),
  })
  .describe("A document's or a component's stream, as it stands when it opens");

export const EnvironmentSnapshot = z
  .object({ samples: z.array(z.object({ id: Id, state: z.string() })) })
  .describe("The environment's own stream, as it stands when it opens");

/** Each event by the name its frames carry, and where it is sent. */
export const streamEvents = {
  snapshot: {
    summary: 'The state now, sent first on every connection; events follow and apply as state',
    schema: z.union([ScopedSnapshot, EnvironmentSnapshot]),
  },
  lock: {
    summary:
      "A lock claimed, moved, released, or its expected release moved to another minute; sent on a document's or a component's stream to whoever may read the component",
    schema: LockEvent,
  },
  presence: {
    summary:
      "Somebody's window beat or moved in the document; sent on its stream to everyone, redacted",
    schema: PresenceEvent,
  },
  presence_left: {
    summary: "A window left the stream's document",
    schema: PresenceLeftEvent,
  },
  outline: {
    summary: "The document's outline changed; sent on its stream",
    schema: OutlineEvent,
  },
  workflow: {
    summary:
      "A component or a document moved to another workflow state, its own or a save's; sent on its stream, and on a document's stream for a component in it, to whoever may read it",
    schema: WorkflowEvent,
  },
  inbox: {
    summary:
      'A notification was made for the viewer, at once or as a digest; sent on every stream they hold, and to nobody else',
    schema: InboxEvent,
  },
  permissions: {
    summary: 'Access changed in the environment; sent on every stream, which then ends',
    schema: PermissionsEvent,
  },
  sample: {
    summary: "A development sample's state; sent on the environment's own stream alone",
    schema: SampleEvent,
  },
} as const;

export type StreamEventName = keyof typeof streamEvents;

const Citation = z.object({ component: Id, block: z.string() });

/**
 * What a run of the assistant sends (API-064; the G2 plan, G2-A), by each frame's `event`: its own
 * channel, apart from the stream's, its messages named with the prefix `assistant_` in the document.
 */
export const assistantEvents = {
  run: {
    summary:
      'The run began: its identifier, and the endpoint it calls and whether that sits outside the data boundary',
    schema: z.object({
      run: Id,
      endpoint: z.object({ name: z.string(), boundary: z.enum(['inside', 'outside']) }),
      cachedFrom: Id.optional().describe(
        'Your own earlier run this one reuses, calling nothing and costing nothing (GEN-036)',
      ),
    }),
  },
  text: {
    summary: "The model's answer, a piece at a time, as it is made",
    schema: z.object({ text: z.string() }),
  },
  tool_call: {
    summary: 'The model called one of its tools, with these arguments',
    schema: z.object({
      id: z.string(),
      name: z.string(),
      input: z.record(z.string(), z.unknown()),
    }),
  },
  tool_result: {
    summary: 'What the tool answered, as the model was given it, and a summary for a person',
    schema: z.object({
      id: z.string(),
      name: z.string(),
      ok: z.boolean(),
      summary: z.string(),
      result: z.string(),
    }),
  },
  proposal: {
    summary:
      'An edit proposed to a component, or a component proposed to be made, which changes nothing until its requester acts on it',
    schema: z.object({
      id: Id,
      number: z.number().int(),
      component: Id.nullable().describe('The component edited; null for one proposed to be made'),
      against: Id.nullable().describe('The version edited; null for one proposed to be made'),
      creates: z
        .object({ space: Id, title: z.string() })
        .passthrough()
        .nullable()
        .optional()
        .describe('Where, and under what title, a proposed component would be made'),
      proposed: z.record(z.string(), z.unknown()),
    }),
  },
  notice: {
    summary:
      'In a conversation, the model declined an instruction found in what it read, and says so: where, and what it asked. Its words are data, never done (GEN-021)',
    schema: z.object({
      where: z.string().describe('Where it asked: a component, or what else the model read'),
      instruction: z.string().max(500).describe('What it asked, in the model’s words'),
    }),
  },
  ended: {
    summary: 'The run ended: the model, its tokens and cost, and the citations kept and dropped',
    schema: z.object({
      outcome: z.string(),
      model: z.string().nullable(),
      tokensIn: z.number().int().nullable(),
      tokensOut: z.number().int().nullable(),
      cost: z.string().nullable(),
      currency: z.string(),
      citations: z.array(Citation),
      dropped: z.array(Citation),
    }),
  },
  failed: {
    summary: 'The run failed, by code and reason, in the product\u2019s words',
    schema: z.object({
      code: z.string(),
      reason: z.string().optional(),
      message: z.string(),
      resetsAt: z
        .string()
        .optional()
        .describe('With `model_rate_limited`: when a run is free again'),
    }),
  },
} as const;

export type AssistantEventName = keyof typeof assistantEvents;

/**
 * The AsyncAPI 3.0 document: one channel, the stream, its three scopes as parameters, and one message
 * per event. Built from `streamEvents` as `openapi.json` is from the routes, committed, and held to
 * them by a test.
 */
export function buildAsyncApi() {
  const messages: Record<
    string,
    { name: string; summary: string; contentType: string; payload: unknown }
  > = Object.fromEntries([
    ...Object.entries(streamEvents).map(([name, event]) => [
      name,
      {
        name,
        summary: event.summary,
        contentType: 'application/json',
        payload: z.toJSONSchema(event.schema, { io: 'output' }),
      },
    ]),
    ...Object.entries(assistantEvents).map(([name, event]) => [
      `assistant_${name}`,
      {
        name,
        summary: event.summary,
        contentType: 'application/json',
        payload: z.toJSONSchema(event.schema, { io: 'output' }),
      },
    ]),
  ]);
  return {
    asyncapi: '3.0.0',
    info: {
      title: 'Alloy Works stream',
      version: '1',
      description:
        "What `GET /v1/stream` sends, as Server-Sent Events: each frame's `event` is a message's name, and its `data` that message's payload. Opened with a signed-in session alone, never a token. Every connection begins with `snapshot`; events are not replayed, so a reconnect is a connect (API-017). `?document=` or `?component=` scopes it to one thing the viewer may read, else it is answered 404; without either it is the environment's own stream.",
    },
    channels: {
      stream: {
        address: '/v1/stream',
        messages: Object.fromEntries(
          Object.keys(streamEvents).map((name) => [
            name,
            { $ref: `#/components/messages/${name}` },
          ]),
        ),
      },
      assistantRun: {
        address: '/v1/documents/{id}/assistant/runs',
        description:
          "What `POST /v1/documents/{id}/assistant/runs` answers, as Server-Sent Events: `run` first, then the model's text, its tool calls and their results, its proposals and, in a conversation, its notices as they come, and `ended` or `failed` last. Closing the request ends the run.",
        parameters: { id: { description: 'The document' } },
        messages: Object.fromEntries(
          Object.keys(assistantEvents).map((name) => [
            name,
            { $ref: `#/components/messages/assistant_${name}` },
          ]),
        ),
      },
    },
    operations: {
      receive: {
        action: 'receive',
        channel: { $ref: '#/channels/stream' },
        messages: Object.keys(streamEvents).map((name) => ({
          $ref: `#/channels/stream/messages/${name}`,
        })),
      },
      receiveAssistantRun: {
        action: 'receive',
        channel: { $ref: '#/channels/assistantRun' },
        messages: Object.keys(assistantEvents).map((name) => ({
          $ref: `#/channels/assistantRun/messages/${name}`,
        })),
      },
    },
    components: { messages },
  };
}
