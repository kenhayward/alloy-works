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
      parameters: { instructions: 'assistant-1' },
    });
    expect(framed[0]!.data).toMatchObject({ conversation: id });
    // The assistant's tools, on the document.
    expect((asked.at(-1)!.call.tools ?? []).map((each) => each.name)).toContain('read_component');
  });

  it('GEN-050 sends a question off the subject as asked, refusing nothing for being unrelated', async () => {
    const id = await start('grace');
    const ran = await turn('grace', id, { ask: 'What is a good name for a cat?' });
    expect(ran.statusCode).toBe(200);
    expect(framesOf(ran.body).map((frame) => frame.event)).toEqual(['run', 'text', 'ended']);
    expect(JSON.stringify(asked.at(-1)!.call.messages)).toContain('What is a good name for a cat?');
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
      ]);
      const tray = (await h.call('grace', 'GET', `/v1/conversations/${id}/context`)).json<{
        items: { component: string }[];
      }>().items;
      expect(tray.map((each) => each.component)).toEqual([sites]);
    } finally {
      h.connector.modelFor = was;
    }
  });
});
