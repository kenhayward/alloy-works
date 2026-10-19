// A model endpoint, for development and CI only (the G1 plan, G1-H): Anthropic's Messages API under
// /models/anthropic and OpenAI's chat completions under /models/openai, each streamed as server-sent
// events, flushed an event at a time, behind the invented key `stand-in-model-dev-key`. No suite calls
// a real provider. Every reply is scripted by the first user message: `script:` and a JSON object
// streams what it says, `turns` one a turn; anything else answers `ready.`. No dependency but Node.
//
//   { "items": [{ "text": "..." }, { "tool": { "id", "name", "input" } }, { "pause": ms }, { "cut": true }],
//     "status": 400, "body": "...", "model": "...", "stop": "max_tokens", "usage": false }
//
// `status` answers that status and `body` instead of a stream; `model` names another model in the
// reply; `cut` ends the stream there, without its end; `usage: false` reports no tokens; `cached`
// reports that many of the tokens in as read from a prompt cache (the G6 plan, G6-E): on Anthropic's
// only where the call marked a cache breakpoint, as the provider caches only what is marked.
import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';

/** The key either protocol's header carries. Invented; it opens nothing but this stand-in. */
export const MODEL_KEY = 'stand-in-model-dev-key';

const ANTHROPIC = /^\/models\/anthropic(?:\/.*)?\/v1\/messages$/;
const OPENAI = /^\/models\/openai(?:\/.*)?\/chat\/completions$/;
const EMBEDDINGS = /^\/models\/openai(?:\/.*)?\/embeddings$/;

/** Whether a path is the stand-in model's, which `fake-api.mjs` asks before its own routes. */
export const isModelPath = (pathname) =>
  ANTHROPIC.test(pathname) || OPENAI.test(pathname) || EMBEDDINGS.test(pathname);

/**
 * Words the stand-in takes as meaning the same (the G7 plan): enough that a search by meaning finds a
 * passage holding none of the words asked, which a search by words cannot. Invented, and small.
 */
const SAME = {
  dam: 'weir',
  dams: 'weir',
  weirs: 'weir',
  inundation: 'flood',
  inundates: 'flood',
  floods: 'flood',
  flooding: 'flood',
  deluge: 'flood',
  river: 'stream',
  rivers: 'stream',
  streams: 'stream',
  spring: 'spring',
};

/**
 * A text's vector (the G7 plan): its words, each read as the word it means the same as, counted into
 * as many places as the model's name ends with (384 where it names none), and of length one. Texts
 * sharing words, or words meaning the same, lie near each other; nothing else is modelled.
 */
function vectorOf(text, dims) {
  const vector = new Array(dims).fill(0);
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    const word = SAME[raw] ?? raw;
    let hash = 2166136261;
    for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    vector[hash % dims] += 1;
  }
  const length = Math.hypot(...vector) || 1;
  return vector.map((each) => each / length);
}

/** Answers `/embeddings`, as OpenAI's API does: `script:` in an input scripts a failure, as a call's. */
function answerEmbeddings(call, response, send) {
  const inputs = Array.isArray(call.input) ? call.input : [call.input];
  const failing = inputs.find((each) => typeof each === 'string' && each.startsWith('script:'));
  if (failing) {
    const script = JSON.parse(failing.slice('script:'.length));
    if (script.status !== undefined) return send(script.status, JSON.parse(script.body ?? '{}'));
  }
  const dims = Number(/-(\d+)$/.exec(call.model ?? '')?.[1] ?? 384);
  return send(200, {
    object: 'list',
    model: call.model,
    data: inputs.map((each, index) => ({
      object: 'embedding',
      index,
      embedding: vectorOf(String(each), dims),
    })),
    usage: { prompt_tokens: tokensOf(inputs.join(' ')), total_tokens: tokensOf(inputs.join(' ')) },
  });
}

/** The text of a message, in either protocol's spelling. */
const textOf = (message) => {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text' || typeof block === 'string')
    .map((block) => (typeof block === 'string' ? block : block.text))
    .join('');
};

/** What the tools answered in the latest turn: Anthropic's tool results, or OpenAI's tool messages. */
function toolResultsOf(messages) {
  const found = [];
  for (const message of messages) {
    if (message.role === 'tool' && typeof message.content === 'string') found.push(message.content);
    if (message.role === 'user' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'tool_result') {
          found.push(
            typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          );
        }
      }
    }
  }
  return found;
}

/**
 * The script for this turn (G1-H; the G2 plan, G2-H). The first user message holds it: `script:` and
 * JSON; `turns` holds one script a turn, chosen by how many answers the conversation already has.
 * An `{ "obey": true }` item is the compliant model: every tool call any tool result asks for with
 * `INSTRUCTION:` and a JSON `{ name, input }` is made. Anything else answers `ready.`.
 */
function scriptOf(call, protocol) {
  const messages = Array.isArray(call.messages) ? call.messages : [];
  const first = messages.find((message) => message.role === 'user');
  const text = textOf(first);
  if (!text.startsWith('script:')) return { items: [{ text: 'ready.' }] };
  let script;
  try {
    script = JSON.parse(text.slice('script:'.length));
  } catch {
    return { status: 400, body: JSON.stringify({ error: `${protocol}: the script is not JSON` }) };
  }
  if (Array.isArray(script.turns)) {
    const answered = messages.filter((message) => message.role === 'assistant').length;
    script = { ...script, ...script.turns[Math.min(answered, script.turns.length - 1)] };
  }
  const items = [];
  let obeyed = 0;
  for (const item of Array.isArray(script.items) ? script.items : []) {
    if (!item.obey) {
      items.push(item);
      continue;
    }
    for (const result of toolResultsOf(messages)) {
      for (const match of result.matchAll(/INSTRUCTION:\s*(\{[^\n]*\})/g)) {
        try {
          const asked = JSON.parse(match[1].replace(/&quot;/g, '"'));
          obeyed += 1;
          items.push({
            tool: { id: `obey_${obeyed}`, name: asked.name, input: asked.input ?? {} },
          });
        } catch {
          // Not a call: nothing to obey.
        }
      }
    }
    if (obeyed === 0) items.push({ text: 'Nothing asked me to do anything.' });
  }
  return { ...script, items };
}

const tokensOf = (text) => Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));

/** Answers a call to the stand-in model, writing straight to `response`. */
export async function answerModel(request, url, body, response) {
  const protocol = ANTHROPIC.test(url.pathname) ? 'anthropic' : 'openai';
  const key =
    protocol === 'anthropic'
      ? request.headers['x-api-key']
      : /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
  const refuse = (status, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': String(bytes.length),
    });
    response.end(bytes);
  };
  if (key !== MODEL_KEY) return refuse(401, { error: { type: 'authentication_error' } });
  let call;
  try {
    call = JSON.parse(body);
  } catch {
    return refuse(400, { error: { type: 'invalid_request_error' } });
  }
  if (EMBEDDINGS.test(url.pathname)) return answerEmbeddings(call, response, refuse);
  const script = scriptOf(call, protocol);
  if (script.status !== undefined) {
    const bytes = Buffer.from(script.body ?? '{}');
    response.writeHead(script.status, {
      'content-type': 'application/json',
      'content-length': String(bytes.length),
    });
    return response.end(bytes);
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  response.flushHeaders();
  const model = script.model ?? call.model;
  const items = Array.isArray(script.items) ? script.items : [];
  const tokensIn = tokensOf(body);
  let tokensOut = 0;
  const usage = script.usage !== false;
  const marked = /"cache_control"/.test(body);
  const cached =
    typeof script.cached === 'number' && (protocol === 'openai' || marked)
      ? Math.min(script.cached, tokensIn)
      : 0;
  const send = (event, data) =>
    new Promise((resolve) =>
      response.write(`${event ? `event: ${event}\n` : ''}data: ${data}\n\n`, () => resolve()),
    );
  const hasTool = items.some((item) => item.tool);
  const stop = script.stop ?? (hasTool ? 'tool_use' : 'end');

  if (protocol === 'anthropic') {
    await send(
      'message_start',
      JSON.stringify({
        type: 'message_start',
        message: {
          id: 'msg_stand_in',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          usage: usage
            ? {
                input_tokens: tokensIn - cached,
                cache_read_input_tokens: cached,
                output_tokens: 1,
              }
            : {},
        },
      }),
    );
    let index = 0;
    for (const item of items) {
      if (item.pause) await sleep(item.pause);
      else if (item.cut) return response.destroy();
      else if (item.text !== undefined) {
        tokensOut += tokensOf(item.text);
        await send(
          'content_block_start',
          JSON.stringify({
            type: 'content_block_start',
            index,
            content_block: { type: 'text', text: '' },
          }),
        );
        await send(
          'content_block_delta',
          JSON.stringify({
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text: item.text },
          }),
        );
        await send('content_block_stop', JSON.stringify({ type: 'content_block_stop', index }));
        index += 1;
      } else if (item.tool) {
        const input = JSON.stringify(item.tool.input ?? {});
        tokensOut += tokensOf(input);
        await send(
          'content_block_start',
          JSON.stringify({
            type: 'content_block_start',
            index,
            content_block: { type: 'tool_use', id: item.tool.id, name: item.tool.name, input: {} },
          }),
        );
        // In two pieces, as a provider sends a tool's input.
        const half = Math.floor(input.length / 2);
        for (const piece of [input.slice(0, half), input.slice(half)]) {
          await send(
            'content_block_delta',
            JSON.stringify({
              type: 'content_block_delta',
              index,
              delta: { type: 'input_json_delta', partial_json: piece },
            }),
          );
        }
        await send('content_block_stop', JSON.stringify({ type: 'content_block_stop', index }));
        index += 1;
      }
    }
    const reason = { end: 'end_turn', tool_use: 'tool_use', max_tokens: 'max_tokens' }[stop];
    await send(
      'message_delta',
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: reason },
        usage: usage ? { output_tokens: tokensOut } : {},
      }),
    );
    await send('message_stop', JSON.stringify({ type: 'message_stop' }));
    return response.end();
  }

  const chunk = (delta, finish = null) =>
    send(
      undefined,
      JSON.stringify({
        id: 'chatcmpl-stand-in',
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      }),
    );
  await chunk({ role: 'assistant', content: '' });
  let tool = 0;
  for (const item of items) {
    if (item.pause) await sleep(item.pause);
    else if (item.cut) return response.destroy();
    else if (item.text !== undefined) {
      tokensOut += tokensOf(item.text);
      await chunk({ content: item.text });
    } else if (item.tool) {
      const input = JSON.stringify(item.tool.input ?? {});
      tokensOut += tokensOf(input);
      await chunk({
        tool_calls: [
          {
            index: tool,
            id: item.tool.id,
            type: 'function',
            function: { name: item.tool.name, arguments: '' },
          },
        ],
      });
      const half = Math.floor(input.length / 2);
      for (const piece of [input.slice(0, half), input.slice(half)]) {
        await chunk({ tool_calls: [{ index: tool, function: { arguments: piece } }] });
      }
      tool += 1;
    }
  }
  const reason = { end: 'stop', tool_use: 'tool_calls', max_tokens: 'length' }[stop];
  await chunk({}, reason);
  if (usage && call.stream_options?.include_usage === true) {
    await send(
      undefined,
      JSON.stringify({
        id: 'chatcmpl-stand-in',
        object: 'chat.completion.chunk',
        model,
        choices: [],
        usage: {
          prompt_tokens: tokensIn,
          completion_tokens: tokensOut,
          prompt_tokens_details: { cached_tokens: cached },
        },
      }),
    );
  }
  await send(undefined, '[DONE]');
  return response.end();
}
