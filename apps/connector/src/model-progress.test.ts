import type { ModelEvent } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { anthropicReader, openaiReader } from './model.js';

const chunk = (delta: unknown) =>
  JSON.stringify({ model: 'stand-in-1', choices: [{ index: 0, delta }] });

const readOpenai = (...lines: string[]) => {
  const events: ModelEvent[] = [];
  const reader = openaiReader(
    'stand-in-1',
    (event) => events.push(event),
    () => undefined,
  );
  for (const line of lines) reader.read(undefined, line);
  return events;
};

const readAnthropic = (...values: unknown[]) => {
  const events: ModelEvent[] = [];
  const reader = anthropicReader(
    'stand-in-1',
    (event) => events.push(event),
    () => undefined,
  );
  for (const value of values) reader.read(undefined, JSON.stringify(value));
  return events;
};

describe('a reply that is not yet words, read as it streams', () => {
  it('counts an OpenAI-protocol reply thinking, under either name servers give it, and never passes its words on', () => {
    const events = readOpenai(
      chunk({ reasoning_content: 'Secret thought' }),
      chunk({ reasoning: 'Another' }),
      chunk({ reasoning_content: '' }),
      chunk({ content: 'Yes.' }),
    );
    expect(events).toEqual([
      { type: 'progress' },
      { type: 'progress' },
      { type: 'text', text: 'Yes.' },
    ]);
  });

  it("counts an OpenAI-protocol tool call's arguments as they are written, the call still read whole", () => {
    const events = readOpenai(
      chunk({
        tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_component', arguments: '' } }],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"component":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"c1"}' } }] }),
      '[DONE]',
    );
    expect(events).toEqual([
      { type: 'progress' },
      { type: 'progress' },
      { type: 'tool_call', id: 'c1', name: 'read_component', input: { component: 'c1' } },
      { type: 'ended', model: 'stand-in-1', stop: 'end', usage: null },
    ]);
  });

  it("counts an Anthropic reply's thinking and a tool call's arguments as they are written", () => {
    const events = readAnthropic(
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Secret' },
      },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'c1', name: 'read_outline' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
      { type: 'content_block_stop', index: 1 },
    );
    expect(events).toEqual([
      { type: 'progress' },
      { type: 'progress' },
      { type: 'tool_call', id: 'c1', name: 'read_outline', input: {} },
    ]);
  });
});
