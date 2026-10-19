import type { ModelEvent } from '@alloy-works/domain';
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

// 100 tokens out at 15 a million: 1500 millionths of a dollar a run.
const answer: ModelEvent[] = [
  { type: 'text', text: 'Fine.' },
  { type: 'ended', model: 'stand-in-1', stop: 'end', usage: { in: 0, out: 100 } },
];

interface Alert {
  kind: string;
  budget: { threshold: number; spent: string; limit: string; currency: string } | null;
}

describe('the model budget through the service (the G6 plan, G6-B to G6-D)', () => {
  let h: Harness;
  let endpoint: string;

  beforeAll(async () => {
    h = await startHarness();
    endpoint = (
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
    ).json<{ endpoint: { id: string } }>().endpoint.id;
    await h.call('ada', 'PUT', `/v1/model-endpoints/${endpoint}/key`, { key: 'an-invented-key' });
    await h.call('ada', 'PUT', '/v1/model-routes/drafting', { endpoint });
    h.connector.modelFor = () => answer;
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const turn = async (as: string) => {
    const id = (await h.call(as, 'POST', '/v1/conversations', { title: 'Asking' })).json<{
      conversation: { id: string };
    }>().conversation.id;
    return framesOf(
      (await h.call(as, 'POST', `/v1/conversations/${id}/turns`, { ask: 'Hello.' })).body,
    );
  };
  const alerts = async (as: string) =>
    (await h.call(as, 'GET', '/v1/inbox'))
      .json<{ notifications: Alert[] }>()
      .notifications.filter((each) => each.kind === 'budget')
      .map((each) => each.budget!.threshold);
  const budget = async (limit: number, thresholds: number[]) => {
    const set = await h.call('ada', 'PUT', '/v1/model-budget', {
      budget: { currency: 'USD', limit, thresholds },
    });
    expect(set.statusCode, set.body).toBe(200);
    return set.json<{ spent: string; whenSpent: string }>();
  };

  it('ADM-034 tells only those an administrator names, each from inside and administering the environment', async () => {
    expect(
      (
        await h.call('grace', 'PUT', '/v1/model-budget', {
          budget: { currency: 'USD', limit: 1, thresholds: [80] },
        })
      ).statusCode,
    ).toBe(403);
    const refused = await h.call('ada', 'PUT', '/v1/model-budget/recipients', {
      principals: [h.ids.ada, h.ids.grace],
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ code: string; refused: string[] }>()).toMatchObject({
      code: 'recipient_not_administrator',
      refused: [h.ids.grace],
    });
    const named = await h.call('ada', 'PUT', '/v1/model-budget/recipients', {
      principals: [h.ids.ada],
    });
    expect(named.statusCode, named.body).toBe(200);
    expect(named.json<{ recipients: { id: string }[] }>().recipients).toEqual([
      expect.objectContaining({ id: h.ids.ada }),
    ]);
  });

  it('GEN-034 ADM-013 ADM-014 alerts each threshold once a month as spend crosses it, before the limit, again at a changed limit, and stops nothing', async () => {
    const set = await budget(0.003, [50, 100]);
    expect(set.whenSpent).toBe('everything_continues');
    expect(await alerts('ada')).toEqual([]);
    // 1500 of 3000: half, and the alert before the limit.
    expect((await turn('grace')).at(-1)!.event).toBe('ended');
    expect(await alerts('ada')).toEqual([50]);
    // 3000: the limit.
    expect((await turn('grace')).at(-1)!.event).toBe('ended');
    expect(await alerts('ada')).toEqual([100, 50]);
    // Past it, runs carry on, and nothing is told twice.
    expect((await turn('grace')).at(-1)!.event).toBe('ended');
    expect(await alerts('ada')).toEqual([100, 50]);
    // The one who ran them is told nothing: they were not named.
    expect(await alerts('grace')).toEqual([]);
    // A limit raised: 4500 of 9000 crosses half again, at that limit.
    await budget(0.009, [50, 100]);
    expect((await turn('grace')).at(-1)!.event).toBe('ended');
    expect(await alerts('ada')).toEqual([50, 100, 50]);
    const first = (await h.call('ada', 'GET', '/v1/inbox'))
      .json<{
        notifications: Alert[];
      }>()
      .notifications.find((each) => each.kind === 'budget')!;
    expect(first.budget).toMatchObject({
      threshold: 50,
      currency: 'USD',
      spent: '0.006000',
      limit: '0.009000',
    });
    const events = (await h.call('ada', 'GET', '/v1/audit?kind=generation.budget_set')).json<{
      items: { detail: { limit: string | null; recipients: number } }[];
    }>().items;
    expect(events.map((each) => each.detail.limit)).toContain('9000');
  });

  it('GEN-034 counts what testing an endpoint costs towards the budget', async () => {
    const before = (await h.call('ada', 'GET', '/v1/model-budget')).json<{ spent: string }>().spent;
    const tested = await h.call('ada', 'POST', `/v1/model-endpoints/${endpoint}/test`);
    expect(tested.statusCode, tested.body).toBe(200);
    const after = (await h.call('ada', 'GET', '/v1/model-budget')).json<{ spent: string }>().spent;
    expect(Number(after) - Number(before)).toBeCloseTo(0.0015, 6);
  });
});
