// A model endpoint, for development and CI only (the G1 plan, G1-H): Anthropic's Messages API under
// /models/anthropic and OpenAI's chat completions under /models/openai, each streamed as server-sent
// events, flushed an event at a time, behind the invented key `stand-in-model-dev-key`. No suite calls
// a real provider. Every reply is scripted by the last user message: `script:` and a JSON object
// streams what it says; anything else answers `ready.`. No dependency but Node.
//
//   { "items": [{ "text": "..." }, { "tool": { "id", "name", "input" } }, { "pause": ms }, { "cut": true }],
//     "status": 400, "body": "...", "model": "...", "stop": "max_tokens", "usage": false }
//
// `status` answers that status and `body` instead of a stream; `model` names another model in the
// reply; `cut` ends the stream there, without its end; `usage: false` reports no tokens.
import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';

/** The key either protocol's header carries. Invented; it opens nothing but this stand-in. */
export const MODEL_KEY = 'stand-in-model-dev-key';

const ANTHROPIC = /^\/models\/anthropic(?:\/.*)?\/v1\/messages$/;
const OPENAI = /^\/models\/openai(?:\/.*)?\/chat\/completions$/;

/** Whether a path is the stand-in model's, which `fake-api.mjs` asks before its own routes. */
export const isModelPath = (pathname) => ANTHROPIC.test(pathname) || OPENAI.test(pathname);

/** The script in a call's last user message, or the default reply. */
function scriptOf(call, protocol) {
  const messages = Array.isArray(call.messages) ? call.messages : [];
  const users = messages.filter((message) => message.role === 'user');
  const last = users.at(-1);
  const content = last?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((block) => block.type === 'text' || typeof block === 'string')
            .map((block) => (typeof block === 'string' ? block : block.text))
            .join('')
        : '';
  if (!text.startsWith('script:')) return { items: [{ text: 'ready.' }] };
  try {
    return JSON.parse(text.slice('script:'.length));
  } catch {
    return { status: 400, body: JSON.stringify({ error: `${protocol}: the script is not JSON` }) };
  }
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
          usage: usage ? { input_tokens: tokensIn, output_tokens: 1 } : {},
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
        usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut },
      }),
    );
  }
  await send(undefined, '[DONE]');
  return response.end();
}
