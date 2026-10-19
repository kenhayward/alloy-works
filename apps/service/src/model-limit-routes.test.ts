import type { ModelEvent, ModelRequest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/** Server-sent events as the route wrote them: each frame's event and its data. */
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

const answer: ModelEvent[] = [
  { type: 'text', text: 'Fine.' },
  { type: 'ended', model: 'stand-in-1', stop: 'end', usage: { in: 10, out: 3 } },
];

describe('rate limits through the service (the G6 plan, G6-A)', () => {
  let h: Harness;
  /** What the connector was asked, each call in order. */
  const asked: ModelRequest[] = [];

  beforeAll(async () => {
    h = await startHarness();
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
    h.connector.modelFor = (request) => {
      asked.push(request);
      return answer;
    };
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  /** A turn of a new conversation on no document: its status and its frames. */
  const turn = async (as: string) => {
    const id = (await h.call(as, 'POST', '/v1/conversations', { title: 'Asking' })).json<{
      conversation: { id: string };
    }>().conversation.id;
    const answered = await h.call(as, 'POST', `/v1/conversations/${id}/turns`, { ask: 'Hello.' });
    return { status: answered.statusCode, body: answered.body, frames: framesOf(answered.body) };
  };
  const limit = async (perHour: number | null) => {
    const set = await h.call('ada', 'PUT', '/v1/model-limits', { perHour });
    expect(set.statusCode, set.body).toBe(200);
  };

  it('GEN-035 lets an administrator set runs an hour per person, refusing the next run before any call and saying when one is free', async () => {
    expect((await h.call('grace', 'PUT', '/v1/model-limits', { perHour: 1 })).statusCode).toBe(403);
    await limit(2);
    try {
      expect((await turn('grace')).frames.at(-1)!.event).toBe('ended');
      expect((await turn('grace')).frames.at(-1)!.event).toBe('ended');
      const before = asked.length;
      const refused = await turn('grace');
      expect(refused.status).toBe(429);
      const body = JSON.parse(refused.body) as { code: string; resetsAt: string };
      expect(body.code).toBe('model_rate_limited');
      // Free again an hour after the oldest of the two it counted started.
      expect(Date.parse(body.resetsAt) - Date.now()).toBeGreaterThan(59 * 60_000);
      expect(Date.parse(body.resetsAt) - Date.now()).toBeLessThanOrEqual(3_600_000);
      expect(asked.length).toBe(before);
      const events = (await h.call('ada', 'GET', '/v1/audit?kind=generation.limit_set')).json<{
        items: { detail: { perHour: number | null } }[];
      }>().items;
      expect(events.map((each) => each.detail.perHour)).toContain(2);
    } finally {
      await limit(null);
    }
  });

  it("GEN-035 sets one person's limit in place of the environment's, and removing it restores theirs", async () => {
    await limit(1);
    try {
      expect((await turn('ivy')).frames.at(-1)!.event).toBe('ended');
      expect((await turn('ivy')).status).toBe(429);
      const raised = await h.call('ada', 'PUT', `/v1/model-limits/people/${h.ids.ivy}`, {
        perHour: 5,
      });
      expect(raised.statusCode, raised.body).toBe(200);
      expect(
        raised.json<{ people: { person: { id: string }; perHour: number }[] }>().people,
      ).toEqual([{ person: expect.objectContaining({ id: h.ids.ivy }), perHour: 5 }]);
      expect((await turn('ivy')).frames.at(-1)!.event).toBe('ended');
      await h.call('ada', 'PUT', `/v1/model-limits/people/${h.ids.ivy}`, { perHour: null });
      expect((await turn('ivy')).status).toBe(429);
      expect(
        (
          await h.call(
            'ada',
            'PUT',
            '/v1/model-limits/people/00000000-0000-4000-8000-000000000000',
            {
              perHour: 5,
            },
          )
        ).statusCode,
      ).toBe(404);
    } finally {
      await limit(null);
    }
  });

  it('GEN-035 counts runs started at once one after another, so no more than the limit start', async () => {
    await limit(1);
    try {
      const before = asked.length;
      const turns = await Promise.all([turn('alice'), turn('alice'), turn('alice')]);
      expect(asked.length - before).toBe(1);
      const refused = turns.filter(
        (each) => each.status === 429 || each.frames.at(-1)?.data.code === 'model_rate_limited',
      );
      expect(refused).toHaveLength(2);
    } finally {
      await limit(null);
    }
  });
});
