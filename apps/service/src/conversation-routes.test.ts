import { assistantEvents } from '@alloy-works/api-contract';
import { listModelEndpoints, readRun, removeGrant, startRun } from '@alloy-works/db';
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

const ended: ModelEvent = {
  type: 'ended',
  model: 'stand-in-1',
  stop: 'end',
  usage: { in: 10, out: 3 },
};
const text = (value: string): ModelEvent => ({ type: 'text', text: value });

describe('conversations through the service (the G5 plan, G5-A to G5-C)', () => {
  let h: Harness;
  let drafting: string;
  let inside: string;
  let document: { id: string; nodes: string[] };
  let sitesId: string;
  /** What the connector was asked, each call in order. */
  const asked: ModelRequest[] = [];

  beforeAll(async () => {
    h = await startHarness();
    const endpoint = async (name: string, boundary: 'inside' | 'outside') => {
      const made = (
        await h.call('ada', 'POST', '/v1/model-endpoints', {
          name,
          protocol: 'anthropic',
          baseUrl: 'https://models.example.test',
          model: 'stand-in-1',
          contextWindow: 200_000,
          priceIn: 3,
          priceOut: 15,
          currency: 'USD',
          boundary,
        })
      ).json<{ endpoint: { id: string } }>().endpoint;
      await h.call('ada', 'PUT', `/v1/model-endpoints/${made.id}/key`, { key: 'an-invented-key' });
      return made.id;
    };
    drafting = await endpoint('Drafting', 'outside');
    inside = await endpoint('Ours', 'inside');
    await h.call('ada', 'PUT', '/v1/model-routes/drafting', { endpoint: drafting });
    h.connector.modelFor = (request) => {
      asked.push(request);
      return [text(`Answer ${asked.length}.`), ended];
    };
    const made = await h.component(h.general, 'Sites');
    sitesId = made.id;
    await h.place(made, { type: 'text', value: 'The north weir floods each spring.', marks: [] });
    document = await h.documentReferencing([made.id]);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const start = async (as: string, over: Json = {}) => {
    const made = await h.call(as, 'POST', '/v1/conversations', {
      title: 'About the weir',
      ...over,
    });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ conversation: { id: string } }>().conversation.id;
  };
  const turn = (as: string, conversation: string, body: Json) =>
    h.call(as, 'POST', `/v1/conversations/${conversation}/turns`, body);

  it('lists a conversation only once its owner keeps it, and lets only them name it (the DQ plan)', async () => {
    const id = await start('grace');
    const listed = async () =>
      (await h.call('grace', 'GET', '/v1/conversations')).json<{ items: { id: string }[] }>().items;
    const change = (as: string, body: Json) => h.call(as, 'PATCH', `/v1/conversations/${id}`, body);
    // Started, and not kept: held, but listed nowhere.
    const opened = (await h.call('grace', 'GET', `/v1/conversations/${id}`)).json<{
      conversation: { kept: boolean };
    }>();
    expect(opened.conversation.kept).toBe(false);
    expect((await listed()).map((each) => each.id)).not.toContain(id);
    const kept = await change('grace', { kept: true });
    expect(kept.statusCode, kept.body).toBe(200);
    expect(kept.json()).toMatchObject({ id, title: 'About the weir', kept: true });
    expect((await listed()).find((each) => each.id === id)).toMatchObject({ kept: true });
    // Named, its words trimmed.
    expect((await change('grace', { title: '  Floods  ' })).json()).toMatchObject({
      title: 'Floods',
      kept: true,
    });
    // Let go: listed nowhere again.
    expect((await change('grace', { kept: false })).json()).toMatchObject({ kept: false });
    expect((await listed()).map((each) => each.id)).not.toContain(id);
    // Asked for nothing, an empty name, or anything else: refused.
    for (const body of [{}, { title: '   ' }, { title: 'x', made: 'now' }]) {
      expect((await change('grace', body)).statusCode).toBe(400);
    }
    // Anybody else is told there is none.
    expect((await change('ada', { kept: true })).statusCode).toBe(404);
  });

  it('GEN-047 holds a conversation: a second turn carries the first turn’s words, and each is kept', async () => {
    const id = await start('grace', { document: document.id });
    const first = await turn('grace', id, { ask: 'What floods?' });
    expect(first.statusCode, first.body).toBe(200);
    const before = asked.length;
    const second = await turn('grace', id, { ask: 'And when?' });
    expect(second.statusCode, second.body).toBe(200);
    const sent = asked[before]!.call.messages;
    expect(sent.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(sent)).toContain('What floods?');
    expect(JSON.stringify(sent)).toContain(`Answer ${before}.`);
    const read = (await h.call('grace', 'GET', `/v1/conversations/${id}`)).json<{
      conversation: { document: string; turns: { ask: string; reply: string; outcome: string }[] };
    }>().conversation;
    expect(read.document).toBe(document.id);
    expect(read.turns.map((each) => [each.ask, each.outcome])).toEqual([
      ['What floods?', 'finished'],
      ['And when?', 'finished'],
    ]);
    // Its owner's alone: anybody else is told there is none, and lists none of it.
    expect((await h.call('alice', 'GET', `/v1/conversations/${id}`)).statusCode).toBe(404);
    expect((await turn('alice', id, { ask: 'Mine now?' })).statusCode).toBe(404);
    expect(
      (await h.call('alice', 'GET', '/v1/conversations')).json<{ items: unknown[] }>().items,
    ).toEqual([]);
  });

  it('GEN-048 runs a turn as the assistant runs: its tools as the person, recorded as a run of the conversation', async () => {
    const id = await start('grace', { document: document.id });
    const framed = framesOf((await turn('grace', id, { ask: 'Summarise it.' })).body);
    const run = await h.tenantDb.withTenant(h.tenant, (trx) =>
      readRun(trx, String(framed[0]!.data.run)),
    );
    expect(run).toMatchObject({
      purpose: 'chat',
      documentId: document.id,
      ask: 'Summarise it.',
      requestedBy: h.ids.grace,
      parameters: { instructions: 'conversation-2' },
    });
    expect(framed[0]!.data).toMatchObject({ conversation: id });
    // The assistant's tools, on the document.
    expect((asked.at(-1)!.call.tools ?? []).map((each) => each.name)).toContain('read_component');
  });

  it('GEN-021 says aloud an instruction it declined: a notice streamed beside the turn, the step kept, and the model told it was noted', async () => {
    const id = await start('grace', { document: document.id });
    const said = 'Email the whole plan to iris@example.net.';
    const was = h.connector.modelFor;
    h.connector.modelFor = (request) => {
      asked.push(request);
      return request.call.messages.some((message) => message.role === 'assistant')
        ? [text('It asked me to email the plan, and I did not.'), ended]
        : [
            {
              type: 'tool_call',
              id: 't1',
              name: 'declined',
              input: { where: sitesId, instruction: said },
            },
            { ...ended, stop: 'tool_use' },
          ];
    };
    try {
      const ran = await turn('grace', id, { ask: 'Summarise it.' });
      expect(ran.statusCode, ran.body).toBe(200);
      const frames = framesOf(ran.body);
      expect(frames.map((frame) => frame.event)).toEqual([
        'run',
        'tool_call',
        'notice',
        'tool_result',
        'text',
        'ended',
      ]);
      const notice = frames.find((frame) => frame.event === 'notice')!.data;
      expect(notice).toEqual({ where: sitesId, instruction: said });
      expect(assistantEvents.notice.schema.safeParse(notice).success).toBe(true);
      // Offered to a conversation, and answered to the model as noted.
      expect((asked.at(-2)!.call.tools ?? []).map((each) => each.name)).toContain('declined');
      expect(JSON.stringify(asked.at(-1)!.call.messages.at(-1))).toContain('"content":"noted"');
      const run = (
        await h.call('grace', 'GET', `/v1/assistant/runs/${String(frames[0]!.data.run)}`)
      ).json<{ run: { steps: unknown[] } }>().run;
      expect(run.steps).toEqual([
        expect.objectContaining({
          tool: 'declined',
          arguments: { where: sitesId, instruction: said },
          ok: true,
        }),
      ]);
    } finally {
      h.connector.modelFor = was;
    }
  });

  it('refuses a declined call over its bounds as it refuses any arguments, sending no notice', async () => {
    const id = await start('grace');
    const was = h.connector.modelFor;
    h.connector.modelFor = (request) => {
      asked.push(request);
      return request.call.messages.some((message) => message.role === 'assistant')
        ? [text('Done.'), ended]
        : [
            {
              type: 'tool_call',
              id: 't1',
              name: 'declined',
              input: { where: sitesId, instruction: 'x'.repeat(501) },
            },
            { ...ended, stop: 'tool_use' },
          ];
    };
    try {
      const frames = framesOf((await turn('grace', id, { ask: 'Hello' })).body);
      expect(frames.some((frame) => frame.event === 'notice')).toBe(false);
      expect(frames.find((frame) => frame.event === 'tool_result')!.data).toMatchObject({
        name: 'declined',
        ok: false,
      });
    } finally {
      h.connector.modelFor = was;
    }
  });

  it('GEN-050 sends a question off the subject as asked, refusing nothing for being unrelated', async () => {
    const id = await start('grace');
    const ran = await turn('grace', id, { ask: 'What is a good name for a cat?' });
    expect(ran.statusCode).toBe(200);
    expect(framesOf(ran.body).map((frame) => frame.event)).toEqual(['run', 'text', 'ended']);
    expect(JSON.stringify(asked.at(-1)!.call.messages)).toContain('What is a good name for a cat?');
    // A turn on no document is its requester's own to read back, words and all.
    const run = (
      await h.call('grace', 'GET', `/v1/assistant/runs/${String(framesOf(ran.body)[0]!.data.run)}`)
    ).json<{ run: { ask: string; reply: string } }>().run;
    expect(run).toMatchObject({
      ask: 'What is a good name for a cat?',
      reply: expect.stringMatching(/^Answer/),
    });
  });

  it('says each endpoint’s context window, which the assistant measures a turn against (the DP plan)', async () => {
    const offered = (await h.call('grace', 'GET', '/v1/conversation-endpoints')).json<{
      items: { id: string; contextWindow: number }[];
    }>().items;
    expect(offered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: drafting, contextWindow: 200_000 }),
        expect.objectContaining({ id: inside, contextWindow: 200_000 }),
      ]),
    );
  });

  it('GEN-051 runs a turn on the endpoint chosen among those in use, saying which and where it sits', async () => {
    const offered = (await h.call('grace', 'GET', '/v1/conversation-endpoints')).json<{
      items: { id: string; boundary: string; isDefault: boolean }[];
    }>().items;
    expect(offered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: drafting, boundary: 'outside', isDefault: true }),
        expect.objectContaining({ id: inside, boundary: 'inside', isDefault: false }),
      ]),
    );
    const id = await start('grace');
    const chosen = framesOf((await turn('grace', id, { ask: 'Hello', endpoint: inside })).body);
    expect(chosen[0]!.data).toMatchObject({ endpoint: { name: 'Ours', boundary: 'inside' } });
    const plain = framesOf((await turn('grace', id, { ask: 'Hello again' })).body);
    expect(plain[0]!.data).toMatchObject({ endpoint: { name: 'Drafting', boundary: 'outside' } });
    const elsewhere = await turn('grace', id, {
      ask: 'Hello',
      endpoint: '0b6f6a4e-8f4e-4c2b-9a51-3a3b1d1f2c09',
    });
    expect(elsewhere.statusCode).toBe(409);
    expect(elsewhere.json<{ code: string }>().code).toBe('endpoint_unusable');
  });

  it('takes one turn at a time, and refuses a conversation on a document its person may not read', async () => {
    const id = await start('grace');
    // A turn still running, as one would be mid-answer.
    await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const endpoint = (await listModelEndpoints(trx))[0]!;
      await startRun(trx, {
        purpose: 'chat',
        endpoint,
        parameters: {},
        contextDigest: 'c'.repeat(64),
        by: h.ids.grace!,
        ask: 'Still going',
        conversationId: id,
      });
    });
    const busy = await turn('grace', id, { ask: 'Another' });
    expect(busy.statusCode).toBe(409);
    expect(busy.json<{ code: string }>().code).toBe('turn_running');
    expect(
      (await h.call('ivy', 'POST', '/v1/conversations', { title: 'Peek', document: document.id }))
        .statusCode,
    ).toBe(404);
  });

  it('GEN-053 reads what the tray holds, each part re-read as the person every turn: added, removed, and one no longer readable left out', async () => {
    const id = await start('grace');
    // Grace reads Quality for now, and its notes join the tray beside the weir's.
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    const notes = await h.component(h.quality, 'Quality notes');
    await h.place(notes, { type: 'text', value: 'A confidential finding.', marks: [] });
    const access = await h.allow(h.ids.grace!, h.roles.Reader!, { kind: 'space', id: h.quality });
    const sites = sitesId;
    for (const component of [sites, notes.id]) {
      const added = await h.call('grace', 'POST', `/v1/conversations/${id}/context`, { component });
      expect(added.statusCode, added.body).toBe(200);
    }
    const sentOf = () => JSON.stringify(asked.at(-1)!.call.messages);
    await turn('grace', id, { ask: 'What do these say?' });
    expect(sentOf()).toContain('The north weir floods each spring.');
    expect(sentOf()).toContain('A confidential finding.');

    // Her access to Quality ends: the next turn leaves its notes out, and says so.
    await h.tenantDb.withTenant(h.tenant, (trx) => removeGrant(trx, access));
    const after = framesOf((await turn('grace', id, { ask: 'And now?' })).body);
    expect(sentOf()).toContain('The north weir floods each spring.');
    expect(sentOf()).not.toContain('A confidential finding.');
    expect(after[0]!.data).toMatchObject({ tray: { read: [sites], dropped: [notes.id] } });
    const tray = (await h.call('grace', 'GET', `/v1/conversations/${id}/context`)).json<{
      items: { component: string; readable: boolean }[];
    }>().items;
    expect(tray).toEqual([
      expect.objectContaining({ component: sites, readable: true }),
      expect.objectContaining({ component: notes.id, readable: false }),
    ]);

    // Removed, a part is sent no more; one she may not read is not added.
    await h.call('grace', 'POST', `/v1/conversations/${id}/context/${sites}/removal`);
    await turn('grace', id, { ask: 'Anything?' });
    expect(sentOf()).not.toContain('The north weir floods each spring.');
    expect(
      (await h.call('grace', 'POST', `/v1/conversations/${id}/context`, { component: notes.id }))
        .statusCode,
    ).toBe(404);
  });

  it('gives a conversation with no document its own tools, and keeps what a tool read in its tray', async () => {
    const id = await start('grace');
    const sites = sitesId;
    const was = h.connector.modelFor;
    let calls = 0;
    h.connector.modelFor = (request) => {
      asked.push(request);
      calls += 1;
      return calls === 1
        ? [
            { type: 'tool_call', id: 't1', name: 'read_component', input: { component: sites } },
            { type: 'ended', model: 'stand-in-1', stop: 'tool_use', usage: { in: 1, out: 1 } },
          ]
        : [text('It floods.'), ended];
    };
    try {
      await turn('grace', id, { ask: 'Read the weir part.' });
      expect((asked.at(-1)!.call.tools ?? []).map((each) => each.name)).toEqual([
        'search_components',
        'read_component',
        'propose_edit',
        'propose_component',
        'search_references',
        'cite_reference',
        'declined',
      ]);
      const tray = (await h.call('grace', 'GET', `/v1/conversations/${id}/context`)).json<{
        items: { component: string }[];
      }>().items;
      expect(tray.map((each) => each.component)).toEqual([sites]);
    } finally {
      h.connector.modelFor = was;
    }
  });

  it('says how much context the turn’s last call took, apart from the tokens it took in all (the DP plan)', async () => {
    const id = await start('grace');
    const was = h.connector.modelFor;
    let calls = 0;
    h.connector.modelFor = (request) => {
      asked.push(request);
      calls += 1;
      return calls === 1
        ? [
            { type: 'tool_call', id: 't1', name: 'read_component', input: { component: sitesId } },
            { type: 'ended', model: 'stand-in-1', stop: 'tool_use', usage: { in: 1, out: 1 } },
          ]
        : [text('It floods.'), ended];
    };
    try {
      const frames = framesOf((await turn('grace', id, { ask: 'Read the weir part.' })).body);
      // Each call sends the whole conversation again: the last call's is what the window holds.
      expect(frames.at(-1)).toMatchObject({
        event: 'ended',
        data: { tokensIn: 11, contextTokens: 10 },
      });
    } finally {
      h.connector.modelFor = was;
    }
  });

  it('GEN-052 proposes a component to be made, made at 0.1 only once accepted, and reported as generated once placed', async () => {
    const id = await start('grace');
    const was = h.connector.modelFor;
    let calls = 0;
    const proposing = (title: string) => (request: ModelRequest) => {
      asked.push(request);
      calls += 1;
      return calls % 2 === 1
        ? [
            {
              type: 'tool_call' as const,
              id: `p${calls}`,
              name: 'propose_component',
              input: { space: h.general, title, markdown: 'The south weir holds.' },
            },
            {
              type: 'ended' as const,
              model: 'stand-in-1',
              stop: 'tool_use' as const,
              usage: { in: 1, out: 1 },
            },
          ]
        : [text('Proposed.'), ended];
    };
    try {
      h.connector.modelFor = proposing('South weir');
      const frames = framesOf(
        (await turn('grace', id, { ask: 'Write a part on the south weir.' })).body,
      );
      const proposed = frames.find((frame) => frame.event === 'proposal')!.data;
      expect(proposed).toMatchObject({
        component: null,
        against: null,
        creates: { space: h.general, title: 'South weir' },
      });
      // Nothing is made yet, and a proposal to make a component is never kept as a suggestion.
      const kept = await h.call(
        'grace',
        'POST',
        `/v1/assistant/proposals/${String(proposed.id)}/keeping`,
      );
      expect(kept.statusCode).toBe(409);
      expect(kept.json<{ code: string }>().code).toBe('proposal_creates');
      const accepted = await h.call(
        'grace',
        'POST',
        `/v1/assistant/proposals/${String(proposed.id)}/acceptance`,
      );
      expect(accepted.statusCode, accepted.body).toBe(200);
      const made = accepted.json<{ proposal: { state: string; component: string } }>().proposal;
      expect(made.state).toBe('accepted');
      const component = (await h.call('grace', 'GET', `/v1/components/${made.component}`)).json<{
        version: { number: string };
        content: { title: string; content: { content: { value: string }[] }[] };
      }>();
      expect(component.version.number).toBe('0.1');
      expect(JSON.stringify(component.content)).toContain('The south weir holds.');

      // Placed in a document, the report says a model made it, and who accepted it.
      const placed = await h.documentReferencing([made.component]);
      const report = (await h.call('ada', 'GET', `/v1/documents/${placed.id}/generated`)).json<{
        placements: { items: { kind: string; state: string; actedBy: { name: string } }[] }[];
      }>();
      expect(report.placements[0]!.items).toEqual([
        expect.objectContaining({
          kind: 'creation',
          state: 'accepted',
          actedBy: expect.objectContaining({ name: 'Grace' }),
        }),
      ]);

      // Alice may not make a component in General: her proposal is refused to the model.
      const theirs = await start('alice');
      calls = 0;
      h.connector.modelFor = proposing('Not hers');
      const refused = framesOf((await turn('alice', theirs, { ask: 'Write one.' })).body);
      expect(refused.find((frame) => frame.event === 'tool_result')!.data).toMatchObject({
        ok: false,
        summary: 'Not yours to make',
        said: { code: 'not_yours_to_make' },
      });
      expect(refused.map((frame) => frame.event)).not.toContain('proposal');
    } finally {
      h.connector.modelFor = was;
    }
  });

  describe("the model's settings and the context chosen", () => {
    const keyed = async (over: Json) => {
      const made = await h.call('ada', 'POST', '/v1/model-endpoints', {
        protocol: 'openai',
        baseUrl: 'https://models.example.test',
        model: 'stand-in-1',
        contextWindow: 200_000,
        priceIn: 0,
        priceOut: 0,
        currency: 'USD',
        boundary: 'inside',
        ...over,
      });
      expect(made.statusCode, made.body).toBe(200);
      const { id } = made.json<{ endpoint: { id: string } }>().endpoint;
      await h.call('ada', 'PUT', `/v1/model-endpoints/${id}/key`, { key: 'an-invented-key' });
      return id;
    };

    it('offers no embedding model for a conversation, and refuses a turn on one', async () => {
      const embedder = await keyed({ name: 'Vectors', kind: 'embedding' });
      const offered = (await h.call('grace', 'GET', '/v1/conversation-endpoints')).json<{
        items: { id: string }[];
      }>().items;
      expect(offered.map((each) => each.id)).not.toContain(embedder);
      expect(offered.map((each) => each.id)).toContain(inside);
      const refused = await turn('grace', await start('grace'), {
        ask: 'Hello',
        endpoint: embedder,
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'endpoint_kind_mismatch' });
    });

    it('calls the model within its own timeout, or the default where it names none', async () => {
      const slow = await keyed({ name: 'Slow chat', timeoutSeconds: 200 });
      const id = await start('grace');
      await turn('grace', id, { ask: 'Hello', endpoint: slow });
      expect(asked.at(-1)!.deadlineMs).toBe(200_000);
      await turn('grace', id, { ask: 'Hello again', endpoint: inside });
      expect(asked.at(-1)!.deadlineMs).toBe(120_000);
    });

    it('makes no more tool calls a run than its model allows (issue #872)', async () => {
      const one = await keyed({ name: 'One call', toolCallsPerRun: 1 });
      const id = await start('grace');
      const was = h.connector.modelFor;
      let calls = 0;
      h.connector.modelFor = (request) => {
        asked.push(request);
        calls += 1;
        return calls === 1
          ? [
              {
                type: 'tool_call',
                id: 't1',
                name: 'read_component',
                input: { component: sitesId },
              },
              {
                type: 'tool_call',
                id: 't2',
                name: 'read_component',
                input: { component: sitesId },
              },
              { ...ended, stop: 'tool_use' },
            ]
          : [text('It floods.'), ended];
      };
      try {
        const frames = framesOf(
          (await turn('grace', id, { ask: 'Read it twice.', endpoint: one })).body,
        );
        const results = frames.filter((frame) => frame.event === 'tool_result');
        expect(results.map((frame) => frame.data.ok)).toEqual([true, false]);
        expect(results[1]!.data).toMatchObject({ said: { code: 'too_many_calls' } });
      } finally {
        h.connector.modelFor = was;
      }
    });

    it('sends no tools to a model that does not call them', async () => {
      const toolless = await keyed({ name: 'No tools', supportsTools: false });
      await turn('grace', await start('grace', { document: document.id }), {
        ask: 'Summarise it.',
        endpoint: toolless,
      });
      expect(asked.at(-1)!.call).not.toHaveProperty('tools');
    });

    it('gives the turn the component open, or every component of the document, as chosen', async () => {
      const other = await h.component(h.general, 'Gardens');
      await h.place(other, { type: 'text', value: 'Roses in the borders.', marks: [] });
      const both = await h.documentReferencing([sitesId, other.id]);
      const id = await start('grace', { document: both.id });
      const sent = () => JSON.stringify(asked.at(-1)!.call.messages.at(-1));

      await turn('grace', id, { ask: 'What is here?', component: sitesId, context: 'component' });
      expect(sent()).toContain('The north weir floods each spring.');
      expect(sent()).not.toContain('Roses in the borders.');

      await turn('grace', id, { ask: 'And here?', component: sitesId, context: 'document' });
      expect(sent()).toContain('The north weir floods each spring.');
      expect(sent()).toContain('Roses in the borders.');

      const refused = await turn('grace', id, { ask: 'Hm?', context: 'everything' });
      expect(refused.statusCode).toBe(400);
    });

    it('counts the tokens received as the reply streams', async () => {
      const was = h.connector.modelFor;
      h.connector.modelFor = (request) => {
        asked.push(request);
        return [text('One'), text(' two'), text(' three.'), ended];
      };
      try {
        const framed = framesOf(
          (await turn('grace', await start('grace'), { ask: 'Count.' })).body,
        );
        expect(
          framed.filter((frame) => frame.event === 'text').map((frame) => frame.data.tokens),
        ).toEqual([1, 2, 3]);
      } finally {
        h.connector.modelFor = was;
      }
    });
  });
});
