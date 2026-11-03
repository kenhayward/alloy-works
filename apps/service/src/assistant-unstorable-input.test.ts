import type { ModelEvent, ModelRequest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

function framesOf(body: string): { event: string; data: Json }[] {
  return body
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return event && data ? { event, data: JSON.parse(data) as Json } : undefined;
    })
    .filter((frame): frame is { event: string; data: Json } => frame !== undefined);
}

const ended = (stop: 'end' | 'tool_use' = 'end'): ModelEvent => ({
  type: 'ended',
  model: 'stand-in-1',
  stop,
  usage: { in: 10, out: 5 },
});

// Built, so that no such character stands in this file.
const NUL = String.fromCharCode(0);
const HALF = String.fromCharCode(0xd800);

describe('what Postgres cannot store, from a model', () => {
  let h: Harness;
  let document: { id: string };

  beforeAll(async () => {
    h = await startHarness({ development: true });
    const made = (
      await h.call('ada', 'POST', '/v1/model-endpoints', {
        name: 'Drafting',
        protocol: 'anthropic',
        baseUrl: 'https://models.example.test',
        model: 'stand-in-1',
        contextWindow: 200_000,
        priceIn: 3,
        priceOut: 15,
        currency: 'USD',
        boundary: 'outside',
      })
    ).json<{ endpoint: { id: string } }>().endpoint;
    await h.call('ada', 'PUT', `/v1/model-endpoints/${made.id}/key`, { key: 'an-invented-key' });
    await h.call('ada', 'PUT', '/v1/model-routes/drafting', { endpoint: made.id });
    const part = await h.component(h.general, 'Sites');
    await h.place(part, { type: 'text', value: 'The weir floods.', marks: [] });
    document = await h.documentReferencing([part.id]);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const run = async (modelFor: (request: ModelRequest) => ModelEvent[]) => {
    h.connector.modelFor = modelFor;
    const response = await h.call('ada', 'POST', `/v1/documents/${document.id}/assistant/runs`, {
      ask: 'Search it.',
    });
    expect(response.statusCode, response.body).toBe(200);
    return framesOf(response.body);
  };

  const askedThen = (first: ModelEvent[], then: ModelEvent[]) => (request: ModelRequest) =>
    request.call.messages.some((message) => message.role === 'assistant') ? then : first;

  const runId = (frames: { event: string; data: Json }[]) =>
    String(frames.find((frame) => frame.event === 'run')!.data.run);

  for (const [what, character] of [
    ['a NUL', NUL],
    ['half a surrogate pair', HALF],
  ] as const) {
    it(`refuses a tool call holding ${what}, the model told, the step kept and the run going on`, async () => {
      const frames = await run(
        askedThen(
          [
            {
              type: 'tool_call',
              id: 't1',
              name: 'search_document',
              input: { query: `weir${character}` },
            },
            ended('tool_use'),
          ],
          [{ type: 'text', text: 'Written again.' }, ended()],
        ),
      );
      expect(frames.find((frame) => frame.event === 'tool_result')!.data).toMatchObject({
        ok: false,
        said: { code: 'arguments_refused' },
      });
      expect(frames.some((frame) => frame.event === 'failed')).toBe(false);
      expect(frames.at(-1)!.event).toBe('ended');
      const read = await h.call('ada', 'GET', `/v1/assistant/runs/${runId(frames)}`);
      expect(read.json()).toMatchObject({
        run: { steps: [{ tool: 'search_document', ok: false }] },
      });
    });

    it(`keeps a reply holding ${what} as a run that ended`, async () => {
      const frames = await run(() => [{ type: 'text', text: `It floods${character}.` }, ended()]);
      expect(frames.some((frame) => frame.event === 'failed')).toBe(false);
      expect(frames.at(-1)!.event).toBe('ended');
    });
  }
});
