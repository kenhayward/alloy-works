import {
  MODEL_ANSWER_MAX_BYTES,
  replyModelMatches,
  type ChildModelRequest,
  type GenerationFailure,
  type ModelCall,
  type ModelEvent,
} from '@alloy-works/domain';

import type { Lookup } from './guard.js';
import { baseUrlParts, stream, type Streamed } from './https.js';

/**
 * A model call in the child (ADR-0064; the G1 plan, G1-C to G1-E): the call spelled for the endpoint's
 * protocol, posted through the guarded client's streaming mode, and the provider's server-sent events
 * read as they arrive into the product's own events, each written as it is made. Exactly one `ended`
 * or `failed` comes last. Nothing the provider sends of itself - an error's words, a header - is ever
 * repeated: a failure is its code and a reason.
 */

/** The most of a provider's stream read, raw: its events' framing on top of what they carry. */
const STREAM_MAX_BYTES = 4 * MODEL_ANSWER_MAX_BYTES;

/** What a provider's 400 says when the context was too long for the model, as each spells it. */
const TOO_LONG =
  /context_length_exceeded|prompt is too long|maximum context length|too many tokens/i;

const unavailable = (reason: GenerationFailure['reason']): GenerationFailure => ({
  code: 'model_unavailable',
  reason,
});

/** A refusing status and its body, read but never repeated, as a failure. */
export function refusalFailure(status: number, body: string): GenerationFailure {
  if (status === 401 || status === 403) return unavailable('key_refused');
  if (status === 429) return unavailable('rate_limited');
  if (status === 413 || (status === 400 && TOO_LONG.test(body)))
    return { code: 'context_too_large' };
  return unavailable('failed');
}

function streamFailure(outcome: Exclude<Streamed, { ok: true }>): GenerationFailure {
  switch (outcome.why) {
    case 'refused':
      return refusalFailure(outcome.status, outcome.body);
    case 'unreached':
      return unavailable('unreachable');
    case 'timeout':
      return { code: 'timeout' };
    default:
      return unavailable('failed');
  }
}

/** Server-sent events, fed text as it arrives and handing on each event's name and data. */
export class EventStream {
  private buffered = '';
  private readonly decoder = new TextDecoder('utf-8');

  feed(chunk: Uint8Array, each: (event: string | undefined, data: string) => void): void {
    this.buffered += this.decoder.decode(chunk, { stream: true });
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffered);
      if (!match) return;
      const block = this.buffered.slice(0, match.index);
      this.buffered = this.buffered.slice(match.index + match[0].length);
      let event: string | undefined;
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
      if (data.length > 0) each(event, data.join('\n'));
    }
  }
}

interface Spelled {
  readonly path: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

/** The call as Anthropic's Messages API takes it. */
function anthropicCall(call: ModelCall, key: string): Spelled {
  return {
    path: '/v1/messages',
    headers: [
      ['x-api-key', key],
      ['anthropic-version', '2023-06-01'],
      ['accept', 'text/event-stream'],
    ],
    body: JSON.stringify({
      model: call.model,
      max_tokens: call.parameters.maxTokens,
      ...(call.parameters.temperature === undefined
        ? {}
        : { temperature: call.parameters.temperature }),
      ...(call.system === undefined ? {} : { system: call.system }),
      messages: call.messages.map((message) => ({
        role: message.role,
        content: message.content.map((block) =>
          block.type === 'text'
            ? { type: 'text', text: block.text }
            : block.type === 'tool_use'
              ? { type: 'tool_use', id: block.id, name: block.name, input: block.input }
              : {
                  type: 'tool_result',
                  tool_use_id: block.toolUseId,
                  content: block.content,
                  ...(block.isError === undefined ? {} : { is_error: block.isError }),
                },
        ),
      })),
      ...(call.tools === undefined
        ? {}
        : {
            tools: call.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema,
            })),
          }),
      stream: true,
    }),
  };
}

/** The call as OpenAI's chat completions take it, a tool's result a message of its own. */
function openaiCall(call: ModelCall, key: string): Spelled {
  const messages: unknown[] = [];
  if (call.system !== undefined) messages.push({ role: 'system', content: call.system });
  for (const message of call.messages) {
    if (message.role === 'assistant') {
      const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
      const calls = message.content.flatMap((block) =>
        block.type === 'tool_use'
          ? [
              {
                id: block.id,
                type: 'function',
                function: { name: block.name, arguments: JSON.stringify(block.input) },
              },
            ]
          : [],
      );
      messages.push({
        role: 'assistant',
        content: text.length === 0 ? null : text.join(''),
        ...(calls.length === 0 ? {} : { tool_calls: calls }),
      });
      continue;
    }
    const text: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') text.push(block.text);
      else messages.push({ role: 'tool', tool_call_id: block.toolUseId, content: block.content });
    }
    if (text.length > 0) messages.push({ role: 'user', content: text.join('') });
  }
  return {
    path: '/chat/completions',
    headers: [
      ['authorization', `Bearer ${key}`],
      ['accept', 'text/event-stream'],
    ],
    body: JSON.stringify({
      model: call.model,
      // OpenAI's newer models take only this; servers that speak the protocol and know only
      // `max_tokens` pass over it, as a field they do not know (the final review).
      max_completion_tokens: call.parameters.maxTokens,
      ...(call.parameters.temperature === undefined
        ? {}
        : { temperature: call.parameters.temperature }),
      messages,
      ...(call.tools === undefined
        ? {}
        : {
            tools: call.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }),
      stream: true,
      stream_options: { include_usage: true },
    }),
  };
}

/** A provider's stream read into the product's events, an event at a time. */
interface Reader {
  read(event: string | undefined, data: string): void;
}

type Emit = (event: ModelEvent) => void;

const parse = (data: string): Record<string, unknown> | undefined => {
  try {
    const value = JSON.parse(data) as unknown;
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const count = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

const parsedInput = (text: string): Record<string, unknown> | undefined => {
  const value = parse(text === '' ? '{}' : text);
  return value !== undefined && !Array.isArray(value) ? value : undefined;
};

function anthropicReader(
  declared: string,
  emit: Emit,
  fail: (failure: GenerationFailure) => void,
): Reader {
  let model: string | undefined;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let stop: 'end' | 'tool_use' | 'max_tokens' = 'end';
  const tools = new Map<number, { id: string; name: string; input: string }>();
  const reader: Reader = {
    read(_event: string | undefined, data: string) {
      const value = parse(data);
      if (!value) return fail(unavailable('failed'));
      switch (value.type) {
        case 'message_start': {
          const message = value.message as Record<string, unknown> | undefined;
          model = typeof message?.model === 'string' ? message.model : undefined;
          if (model === undefined || !replyModelMatches(declared, model)) {
            return fail({ code: 'model_mismatch' });
          }
          const usage = message?.usage as Record<string, unknown> | undefined;
          if (usage && typeof usage.input_tokens === 'number') {
            tokensIn =
              count(usage.input_tokens) +
              count(usage.cache_creation_input_tokens) +
              count(usage.cache_read_input_tokens);
          }
          return;
        }
        case 'content_block_start': {
          const block = value.content_block as Record<string, unknown> | undefined;
          if (
            block?.type === 'tool_use' &&
            typeof block.id === 'string' &&
            typeof block.name === 'string'
          ) {
            tools.set(count(value.index), { id: block.id, name: block.name, input: '' });
          }
          return;
        }
        case 'content_block_delta': {
          const delta = value.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            emit({ type: 'text', text: delta.text });
          } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const tool = tools.get(count(value.index));
            if (tool) tool.input += delta.partial_json;
          }
          return;
        }
        case 'content_block_stop': {
          const tool = tools.get(count(value.index));
          if (!tool) return;
          tools.delete(count(value.index));
          const input = parsedInput(tool.input);
          if (!input) return fail(unavailable('failed'));
          emit({ type: 'tool_call', id: tool.id, name: tool.name, input });
          return;
        }
        case 'message_delta': {
          const delta = value.delta as Record<string, unknown> | undefined;
          stop =
            delta?.stop_reason === 'tool_use'
              ? 'tool_use'
              : delta?.stop_reason === 'max_tokens'
                ? 'max_tokens'
                : 'end';
          const usage = value.usage as Record<string, unknown> | undefined;
          if (usage && typeof usage.output_tokens === 'number')
            tokensOut = count(usage.output_tokens);
          return;
        }
        case 'message_stop':
          if (model === undefined) return fail({ code: 'connector_error' });
          emit({
            type: 'ended',
            model: model!,
            stop,
            usage:
              tokensIn === undefined || tokensOut === undefined
                ? null
                : { in: tokensIn, out: tokensOut },
          });
          return;
        case 'error':
          return fail(unavailable('failed'));
        default:
          return;
      }
    },
  };
  return reader;
}

function openaiReader(
  declared: string,
  emit: Emit,
  fail: (failure: GenerationFailure) => void,
): Reader {
  let model: string | undefined;
  let usage: { in: number; out: number } | null = null;
  let stop: 'end' | 'tool_use' | 'max_tokens' = 'end';
  const tools = new Map<number, { id: string; name: string; input: string }>();
  const reader: Reader = {
    read(_event: string | undefined, data: string) {
      if (data === '[DONE]') {
        if (model === undefined) return fail(unavailable('failed'));
        for (const tool of [...tools.entries()].sort(([a], [b]) => a - b).map(([, each]) => each)) {
          const input = parsedInput(tool.input);
          if (!input) return fail(unavailable('failed'));
          emit({ type: 'tool_call', id: tool.id, name: tool.name, input });
        }
        emit({ type: 'ended', model, stop, usage });
        return;
      }
      const value = parse(data);
      if (!value) return fail(unavailable('failed'));
      if (typeof value.model === 'string' && model === undefined) {
        model = value.model;
        if (!replyModelMatches(declared, model)) return fail({ code: 'model_mismatch' });
      }
      const reported = value.usage as Record<string, unknown> | undefined | null;
      if (reported && typeof reported.prompt_tokens === 'number') {
        usage = { in: count(reported.prompt_tokens), out: count(reported.completion_tokens) };
      }
      const choices = Array.isArray(value.choices)
        ? (value.choices as Record<string, unknown>[])
        : [];
      const choice = choices[0];
      if (!choice) return;
      const delta = choice.delta as Record<string, unknown> | undefined;
      if (typeof delta?.content === 'string' && delta.content !== '') {
        emit({ type: 'text', text: delta.content });
      }
      for (const call of Array.isArray(delta?.tool_calls)
        ? (delta.tool_calls as Record<string, unknown>[])
        : []) {
        const index = count(call.index);
        const fn = call.function as Record<string, unknown> | undefined;
        const tool = tools.get(index) ?? { id: '', name: '', input: '' };
        if (typeof call.id === 'string') tool.id = call.id;
        if (typeof fn?.name === 'string' && fn.name !== '') tool.name = fn.name;
        if (typeof fn?.arguments === 'string') tool.input += fn.arguments;
        tools.set(index, tool);
      }
      if (choice.finish_reason === 'tool_calls') stop = 'tool_use';
      else if (choice.finish_reason === 'length') stop = 'max_tokens';
      else if (choice.finish_reason === 'stop') stop = 'end';
    },
  };
  return reader;
}

/**
 * Makes the call and writes each event it reads, the last `ended` or `failed`. `write` is awaited in
 * order; the stream is ended at the first failure, so nothing follows it.
 */
export async function answerModel(
  input: ChildModelRequest,
  write: (event: ModelEvent) => Promise<void>,
  options: { readonly lookup?: Lookup } = {},
): Promise<void> {
  const { request } = input;
  const { host, port, path, secure } = baseUrlParts(request.endpoint.baseUrl);
  const spelled =
    request.endpoint.protocol === 'anthropic'
      ? anthropicCall(request.call, input.secret)
      : openaiCall(request.call, input.secret);
  let written: Promise<void> = Promise.resolve();
  let last: ModelEvent | undefined;
  const emit: Emit = (event) => {
    if (last !== undefined) return;
    if (event.type === 'ended' || event.type === 'failed') last = event;
    written = written.then(() => write(event));
  };
  const fail = (failure: GenerationFailure) => emit({ type: 'failed', failure });
  const reader =
    request.endpoint.protocol === 'anthropic'
      ? anthropicReader(request.call.model, emit, fail)
      : openaiReader(request.call.model, emit, fail);
  const events = new EventStream();
  const outcome = await stream(
    {
      host,
      port,
      path: `${path}${spelled.path}`,
      method: 'POST',
      headers: spelled.headers,
      body: spelled.body,
      secure,
    },
    {
      deny: input.deny,
      ...(options.lookup ? { lookup: options.lookup } : {}),
      ...(input.ca === undefined ? {} : { ca: input.ca }),
      deadline: Date.now() + request.deadlineMs,
      connectTimeoutMs: input.connectTimeoutMs,
      maxBytes: STREAM_MAX_BYTES,
    },
    (chunk) => {
      events.feed(chunk, (event, data) => reader.read(event, data));
      // Ended, or failed: nothing more of the stream is wanted.
      return last === undefined;
    },
  );
  if (last === undefined) {
    // The stream ended, or failed, before its own end said it had.
    fail(outcome.ok ? unavailable('failed') : streamFailure(outcome));
  }
  await written;
}
