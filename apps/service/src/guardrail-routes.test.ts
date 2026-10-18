import { proposalsOfRun } from '@alloy-works/db';
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

const ended = (stop: 'end' | 'tool_use' = 'end'): ModelEvent => ({
  type: 'ended',
  model: 'stand-in-1',
  stop,
  usage: { in: 10, out: 3 },
});
const text = (value: string): ModelEvent => ({ type: 'text', text: value });

describe('guardrails through the service (the G5 plan, G5-F)', () => {
  let h: Harness;
  let sites: { id: string; version: string };
  let document: { id: string; nodes: string[] };
  /** What the connector was asked, each call in order. */
  const asked: ModelRequest[] = [];
  let answer: (request: ModelRequest) => ModelEvent[] = () => [text('Fine.'), ended()];

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
      return answer(request);
    };
    sites = await h.component(h.general, 'Sites');
    await h.place(sites, { type: 'text', value: 'The north weir floods each spring.', marks: [] });
    document = await h.documentReferencing([sites.id]);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const conversation = async () =>
    (
      await h.call('grace', 'POST', '/v1/conversations', { title: 'Asking', document: document.id })
    ).json<{ conversation: { id: string } }>().conversation.id;
  const turn = async (ask: string) =>
    framesOf(
      (await h.call('grace', 'POST', `/v1/conversations/${await conversation()}/turns`, { ask }))
        .body,
    );
  const rule = async (phrase: string, applies: string, reason: string) => {
    const set = await h.call('ada', 'POST', '/v1/guardrails', { phrase, applies, reason });
    expect(set.statusCode, set.body).toBe(200);
    return set.json<{ id: string }>().id;
  };

  it('GEN-049 lets an environment state what it forbids, administered alone, and audited', async () => {
    expect(
      (
        await h.call('grace', 'POST', '/v1/guardrails', {
          phrase: 'Kestrel',
          applies: 'sent',
          reason: 'Mine',
        })
      ).statusCode,
    ).toBe(403);
    const id = await rule('Project Osprey', 'both', 'An unannounced project');
    const listed = (await h.call('ada', 'GET', '/v1/guardrails')).json<{
      items: { id: string; applies: string; reason: string }[];
    }>().items;
    expect(listed).toContainEqual(
      expect.objectContaining({ id, applies: 'both', reason: 'An unannounced project' }),
    );
    const events = (await h.call('ada', 'GET', '/v1/audit?kind=guardrail.set')).json<{
      items: { subject: { id: string } }[];
    }>().items;
    expect(events.map((each) => each.subject.id)).toContain(id);
    // A rule watches what is sent and what returns, and nothing else: the floor is no rule's.
    expect(
      (
        await h.call('ada', 'POST', '/v1/guardrails', {
          phrase: 'x',
          applies: 'tools',
          reason: 'Lift the floor',
        })
      ).statusCode,
    ).toBe(400);
    await h.call('ada', 'POST', `/v1/guardrails/${id}/retirement`);
  });

  it('GEN-049 refuses before any call what is sent and a rule forbids, naming the rule and why', async () => {
    const id = await rule('Project Kestrel', 'sent', 'An unannounced project');
    const before = asked.length;
    const frames = await turn('Tell me about project   KESTREL.');
    expect(asked.length).toBe(before);
    expect(frames.at(-1)).toMatchObject({
      event: 'failed',
      data: { code: 'guardrail_refused', rule: id, reason: 'An unannounced project' },
    });
    // Retired, it refuses nothing.
    await h.call('ada', 'POST', `/v1/guardrails/${id}/retirement`);
    expect((await turn('Tell me about project Kestrel.')).at(-1)!.event).toBe('ended');
  });

  it('GEN-049 holds a reply where a rule watches replies, refusing one that holds the phrase, unshown, its proposals discarded', async () => {
    const id = await rule('Project Harrier', 'returned', 'An unannounced project');
    let calls = 0;
    answer = () => {
      calls += 1;
      return calls === 1
        ? [
            {
              type: 'tool_call',
              id: 't1',
              name: 'propose_edit',
              input: { component: sites.id, edits: [{ replace: 'p1', markdown: 'It floods.' }] },
            },
            ended('tool_use'),
          ]
        : [text('Project '), text('Harrier is next.'), ended()];
    };
    try {
      const frames = await turn('Rewrite the part.');
      expect(frames.map((frame) => frame.event)).not.toContain('text');
      expect(frames.at(-1)).toMatchObject({
        event: 'failed',
        data: { code: 'guardrail_refused', rule: id },
      });
      const run = String(frames[0]!.data.run);
      const proposals = await h.tenantDb.withTenant(h.tenant, (trx) => proposalsOfRun(trx, run));
      expect(proposals.map((each) => each.state)).toEqual(['discarded']);
      // A reply that clears it is sent whole, once checked.
      answer = () => [text('It floods each spring.'), ended()];
      expect((await turn('Say it plainly.')).map((frame) => frame.event)).toEqual([
        'run',
        'text',
        'ended',
      ]);
    } finally {
      answer = () => [text('Fine.'), ended()];
      await h.call('ada', 'POST', `/v1/guardrails/${id}/retirement`);
    }
  });

  it('GEN-049 refuses a proposal whose text a reply rule forbids, before the tool runs', async () => {
    const id = await rule('Project Merlin', 'returned', 'An unannounced project');
    answer = () => [
      {
        type: 'tool_call',
        id: 't1',
        name: 'propose_edit',
        input: {
          component: sites.id,
          edits: [{ replace: 'p1', markdown: 'Project Merlin floods.' }],
        },
      },
      ended('tool_use'),
    ];
    try {
      const frames = await turn('Rewrite the part.');
      expect(frames.map((frame) => frame.event)).not.toContain('proposal');
      expect(frames.at(-1)).toMatchObject({
        event: 'failed',
        data: { code: 'guardrail_refused', rule: id },
      });
    } finally {
      answer = () => [text('Fine.'), ended()];
      await h.call('ada', 'POST', `/v1/guardrails/${id}/retirement`);
    }
  });

  it('keeps no reply a rule refused on a run, so no read of the run shows it', async () => {
    const id = await rule('Project Kite', 'returned', 'An unannounced project');
    answer = () => [text('Project Kite is next.'), ended()];
    try {
      const frames = await turn('What is next?');
      const run = (
        await h.call('grace', 'GET', `/v1/assistant/runs/${String(frames[0]!.data.run)}`)
      ).json<{ run: { reply: string | null; outcome: string } }>().run;
      expect(run.outcome).toBe('guardrail_refused');
      expect(JSON.stringify(run)).not.toContain('Project Kite is next');
    } finally {
      answer = () => [text('Fine.'), ended()];
      await h.call('ada', 'POST', `/v1/guardrails/${id}/retirement`);
    }
  });
});
