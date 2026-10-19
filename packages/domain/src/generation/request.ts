import { z } from 'zod';

import { SEALED, SEALED_MAX_BYTES } from '../data/protocol.js';
import { MODEL_PROTOCOLS, modelEndpointSchema } from './endpoint.js';

/**
 * The connector's model request and the events it answers with (ADR-0064; the G1 plan, G1-C), parsed
 * on both sides: by the connector when a request arrives, and by the service as each event does.
 * The call is provider-neutral; the connector's adapter spells it for the endpoint's protocol.
 */

/** The most a model request's body may be, in bytes: a large model's whole window of text. */
export const MODEL_REQUEST_MAX_BYTES = 16 * 1024 * 1024;

/** The most of a model's answer the connector relays, in bytes, before it ends the call. */
export const MODEL_ANSWER_MAX_BYTES = 8 * 1024 * 1024;

/**
 * A call's deadline, in milliseconds: long enough for a long answer, never open ended, and under the
 * 300 s a fetch waits between two chunks of a body before it gives up (the G1 plan, G1-C).
 */
export const MODEL_DEADLINE_MS = { least: 1000, most: 240_000 } as const;

const tenant = z.string().regex(/^[0-9a-z]{1,40}$/);

/** A JSON object, as a tool's input or its schema is. */
const jsonObject = z.record(z.string(), z.unknown());

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const textBlock = z.strictObject({ type: z.literal('text'), text: z.string().min(1) });
const toolUseBlock = z.strictObject({
  type: z.literal('tool_use'),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  name: z.string().regex(TOOL_NAME),
  input: jsonObject,
});
const toolResultBlock = z.strictObject({
  type: z.literal('tool_result'),
  toolUseId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  content: z.string(),
  isError: z.boolean().optional(),
});

export const modelMessageSchema = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('user'),
    content: z.array(z.discriminatedUnion('type', [textBlock, toolResultBlock])).min(1),
  }),
  z.strictObject({
    role: z.literal('assistant'),
    content: z.array(z.discriminatedUnion('type', [textBlock, toolUseBlock])).min(1),
  }),
]);
export type ModelMessage = z.infer<typeof modelMessageSchema>;

export const modelToolSchema = z.strictObject({
  name: z.string().regex(TOOL_NAME),
  description: z.string().min(1).max(4000),
  inputSchema: jsonObject,
});
export type ModelTool = z.infer<typeof modelToolSchema>;

/** What the model is given (G1-F): this, as canonical JSON, is what a run's digest is taken over. */
export const modelCallSchema = z.strictObject({
  model: modelEndpointSchema.shape.model,
  system: z.string().min(1).optional(),
  messages: z.array(modelMessageSchema).min(1),
  tools: z.array(modelToolSchema).max(64).optional(),
  parameters: z.strictObject({
    maxTokens: z.number().int().min(1).max(200_000),
    temperature: z.number().min(0).max(2).optional(),
  }),
});
export type ModelCall = z.infer<typeof modelCallSchema>;

const sealed = z.string().max(SEALED_MAX_BYTES).regex(SEALED);

export const modelRequestSchema = z.strictObject({
  requestId: z.uuid(),
  tenant,
  endpoint: z.strictObject({
    id: z.uuid(),
    protocol: z.enum(MODEL_PROTOCOLS),
    baseUrl: modelEndpointSchema.shape.baseUrl,
  }),
  sealed,
  call: modelCallSchema,
  deadlineMs: z.number().int().min(MODEL_DEADLINE_MS.least).max(MODEL_DEADLINE_MS.most),
});
export type ModelRequest = z.infer<typeof modelRequestSchema>;

/** An endpoint's key: what a header carries, printable ASCII with no space either side (G1-B). */
export const MODEL_KEY_MAX_BYTES = 4096;
export const modelKeySchema = z
  .string()
  .min(1)
  .max(MODEL_KEY_MAX_BYTES)
  .regex(/^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/, {
    message: 'A key is printable ASCII, with no space before or after it',
  });

export const modelSealRequestSchema = z.strictObject({
  tenant,
  endpoint: modelRequestSchema.shape.endpoint,
  secret: modelKeySchema,
});
export type ModelSealRequest = z.infer<typeof modelSealRequestSchema>;

/** Why a model call ended without an answer (G1-E). Never the provider's own words. */
export const GENERATION_FAILURE_CODES = [
  'model_unavailable',
  'model_mismatch',
  'context_too_large',
  'timeout',
  'connector_error',
  'connector_busy',
  'connector_unavailable',
] as const;
export type GenerationFailureCode = (typeof GENERATION_FAILURE_CODES)[number];

/** What `model_unavailable` was, which says nothing the provider sent. */
export const UNAVAILABLE_REASONS = [
  'unreachable',
  'key_refused',
  'rate_limited',
  'failed',
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export const generationFailureSchema = z.strictObject({
  code: z.enum(GENERATION_FAILURE_CODES),
  reason: z.enum(UNAVAILABLE_REASONS).optional(),
});
export type GenerationFailure = z.infer<typeof generationFailureSchema>;

const usage = z.strictObject({
  in: z.number().int().min(0),
  out: z.number().int().min(0),
  /** Of those in, how many the provider read from its prompt cache (G6-E). */
  cached: z.number().int().min(0).optional(),
});

/** One line of a model call's answer; the last is `ended` or `failed`. */
export const modelEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string() }),
  z.strictObject({
    type: z.literal('tool_call'),
    id: toolUseBlock.shape.id,
    name: toolUseBlock.shape.name,
    input: jsonObject,
  }),
  z.strictObject({
    type: z.literal('ended'),
    model: modelEndpointSchema.shape.model,
    stop: z.enum(['end', 'tool_use', 'max_tokens']),
    // Null where the provider reported no tokens: a run then records none, never a guess.
    usage: usage.nullable(),
  }),
  z.strictObject({ type: z.literal('failed'), failure: generationFailureSchema }),
]);
export type ModelEvent = z.infer<typeof modelEventSchema>;

/**
 * Whether the model a reply names is the endpoint's (G1-E): the same, or it followed by `-` and more,
 * as providers name a dated release of an alias (`claude-x` answered by `claude-x-20260101`).
 */
export function replyModelMatches(declared: string, replied: string): boolean {
  return replied === declared || replied.startsWith(`${declared}-`);
}

/**
 * A call as canonical JSON (G1-F): members in code-unit order, no whitespace, strings and numbers as
 * JavaScript writes them, which is RFC 8785's for every value a call holds. The caller hashes it, once,
 * before the call.
 */
export function canonicalCall(call: ModelCall): string {
  return emit(call);
}

function emit(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(emit).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${emit(member)}`).join(',')}}`;
  }
  throw new Error(`Cannot canonicalise a value of type ${typeof value}`);
}

/**
 * The one line the supervisor writes to a model call's child: the request, its one opened key, the
 * guard's ranges and the connect timeout. Never the sealing key, and no failure floor (G1-C).
 */
export const childModelRequestSchema = z.strictObject({
  kind: z.literal('model'),
  request: modelRequestSchema,
  secret: modelKeySchema,
  ca: z
    .string()
    .max(256 * 1024)
    .optional(),
  deny: z.array(z.string()),
  connectTimeoutMs: z.number().int().min(1).max(60_000),
});
export type ChildModelRequest = z.infer<typeof childModelRequestSchema>;

/** The most inputs one embedding call carries, and the longest each may be (the G7 plan, G7-F). */
export const EMBED_INPUTS_MOST = 96;
export const EMBED_INPUT_CHARS_MOST = 8000;
/** The dimensions a vector may have: each has its own index (G7-D). */
export const EMBEDDING_DIMENSIONS = [384, 768, 1024, 1536, 3072] as const;
/** The most an embedding answer may be: 96 vectors of 3,072 numbers, written out, as a model's. */
export const EMBED_ANSWER_MAX_BYTES = MODEL_ANSWER_MAX_BYTES;
export const EMBED_REQUEST_MAX_BYTES = 4 * 1024 * 1024;

/** What an embedding call gives the model (G7-A): its texts, in order. */
export const embedCallSchema = z.strictObject({
  model: modelEndpointSchema.shape.model,
  inputs: z.array(z.string().min(1).max(EMBED_INPUT_CHARS_MOST)).min(1).max(EMBED_INPUTS_MOST),
});
export type EmbedCall = z.infer<typeof embedCallSchema>;

export const embedRequestSchema = z.strictObject({
  requestId: z.uuid(),
  tenant,
  endpoint: modelRequestSchema.shape.endpoint,
  sealed,
  call: embedCallSchema,
  deadlineMs: modelRequestSchema.shape.deadlineMs,
});
export type EmbedRequest = z.infer<typeof embedRequestSchema>;

/** An embedding call's answer: a vector an input, in order, the model the reply named, and its tokens. */
export const embedAnswerSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('embedded'),
    model: z.string().min(1).max(200),
    vectors: z.array(z.array(z.number())).min(1).max(EMBED_INPUTS_MOST),
    usage: z.strictObject({ in: z.number().int().min(0) }).nullable(),
  }),
  z.strictObject({ type: z.literal('failed'), failure: generationFailureSchema }),
]);
export type EmbedAnswer = z.infer<typeof embedAnswerSchema>;

/** The line the supervisor writes to an embedding call's child, as a model call's (G1-C). */
export const childEmbedRequestSchema = z.strictObject({
  kind: z.literal('embed'),
  request: embedRequestSchema,
  secret: modelKeySchema,
  ca: z
    .string()
    .max(256 * 1024)
    .optional(),
  deny: z.array(z.string()),
  connectTimeoutMs: z.number().int().min(1).max(60_000),
});
export type ChildEmbedRequest = z.infer<typeof childEmbedRequestSchema>;
