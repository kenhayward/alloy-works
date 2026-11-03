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

/** A model that calls one tool and then says what it is given to say. */
const calling =
  (name: string, input: Json, says = 'Done.') =>
  (request: ModelRequest): ModelEvent[] =>
    request.call.messages.some((message) => message.role === 'assistant')
      ? [{ type: 'text', text: says }, ended()]
      : [{ type: 'tool_call', id: 't1', name, input }, ended('tool_use')];

describe('finding a part from inside a document', () => {
  let h: Harness;
  let placed: { id: string; version: string };
  let outside: { id: string; version: string };
  let secret: { id: string; version: string };
  let document: { id: string };

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
    placed = await h.component(h.general, 'Placed');
    await h.place(placed, { type: 'text', value: 'Sluice gates in the placed part.', marks: [] });
    outside = await h.component(h.general, 'Outside');
    await h.place(outside, { type: 'text', value: 'Sluice gates in another part.', marks: [] });
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    secret = await h.component(h.quality, 'Quality notes');
    await h.place(secret, { type: 'text', value: 'Sluice gates, confidential.', marks: [] });
    document = await h.documentReferencing([placed.id]);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const run = async (as: string, name: string, input: Json, says?: string) => {
    h.connector.modelFor = calling(name, input, says);
    const response = await h.call(as, 'POST', `/v1/documents/${document.id}/assistant/runs`, {
      ask: 'Is there a part on sluices?',
    });
    expect(response.statusCode, response.body).toBe(200);
    const frames = framesOf(response.body);
    return {
      result: frames.find((frame) => frame.event === 'tool_result')!.data,
      ended: frames.find((frame) => frame.event === 'ended')?.data,
      proposal: frames.find((frame) => frame.event === 'proposal')?.data,
    };
  };

  it('GEN-014 searches the parts the person may read, saying which are in this document', async () => {
    const { result } = await run('grace', 'search_components', { query: 'sluice' });
    const answered = String(result.result);
    expect(answered).toContain(`Component ${placed.id} (in this document):`);
    expect(answered).toContain(`Component ${outside.id} (elsewhere):`);
    expect(answered).not.toContain('confidential');
    expect(answered).not.toContain(secret.id);
  });

  it('GEN-014 reads a part outside the document at its latest, saying it is elsewhere, and none the person may not read', async () => {
    const { result } = await run('grace', 'read_component', { component: outside.id });
    expect(result).toMatchObject({ ok: true });
    expect(String(result.result)).toContain('Sluice gates in another part.');
    expect(String(result.result)).toMatch(/^This part is not in the open document/);
    const refused = await run('grace', 'read_component', { component: secret.id });
    expect(refused.result).toMatchObject({ ok: false, said: { code: 'no_such_component' } });
    expect(JSON.stringify(refused.result)).not.toContain('confidential');
  });

  it('GEN-011 keeps a citation of a part outside the document, once read', async () => {
    const { ended: end } = await run(
      'grace',
      'read_component',
      { component: outside.id },
      `It says so [[${outside.id}#p1]].`,
    );
    expect(end).toMatchObject({ citations: [{ component: outside.id, block: 'p1' }] });
  });

  it('proposes nothing on a part outside the document, reading it or not', async () => {
    const edited = await run('grace', 'propose_edit', {
      component: outside.id,
      edits: [{ in: 'p1', find: 'Sluice', to: 'Weir' }],
    });
    expect(edited.result).toMatchObject({ ok: false, said: { code: 'no_such_component' } });
    expect(edited.proposal).toBeUndefined();
    const cited = await run('grace', 'cite_reference', {
      component: outside.id,
      block: 'p1',
      source: 'crossref',
      identifier: '10.5555/marsh.2021.017',
    });
    expect(cited.result).toMatchObject({ ok: false, said: { code: 'no_such_component' } });
  });

  it('leaves a part read from outside off a conversation’s reading, so no later turn lists it as gone', async () => {
    const id = (
      await h.call('grace', 'POST', '/v1/conversations', {
        title: 'Sluices',
        document: document.id,
      })
    ).json<{ conversation: { id: string } }>().conversation.id;
    h.connector.modelFor = calling('read_component', { component: outside.id });
    const turn = await h.call('grace', 'POST', `/v1/conversations/${id}/turns`, {
      ask: 'Read it.',
    });
    expect(turn.statusCode, turn.body).toBe(200);
    const tray = (await h.call('grace', 'GET', `/v1/conversations/${id}/context`)).json<{
      items: { component: string; readable?: boolean }[];
    }>().items;
    expect(tray.map((each) => each.component)).not.toContain(outside.id);
  });

  it('changes words of a paragraph holding a citation, through to acceptance', async () => {
    const cited = await h.component(h.general, 'Cited');
    const entry = (
      await h.call('ada', 'POST', `/v1/spaces/${h.general}/bibliography-entries`, {
        entry: { csl: { type: 'book', title: 'Invented Weirs' } },
        despiteMatches: true,
      })
    ).json<{ entry: { id: string } }>().entry.id;
    await h.place(
      cited,
      { type: 'text', value: 'Weirs flood.', marks: [] },
      { type: 'citation', entry },
      { type: 'text', value: ' Marshes accrete.', marks: [] },
    );
    const holding = await h.documentReferencing([cited.id]);
    h.connector.modelFor = calling('propose_edit', {
      component: cited.id,
      edits: [{ in: 'p1', find: 'Weirs flood', to: 'Weirs hold' }],
    });
    const response = await h.call('ada', 'POST', `/v1/documents/${holding.id}/assistant/runs`, {
      ask: 'Reword it.',
    });
    const proposal = framesOf(response.body).find((frame) => frame.event === 'proposal')?.data;
    expect(proposal, response.body).toBeDefined();
    const accepted = await h.call(
      'ada',
      'POST',
      `/v1/assistant/proposals/${String(proposal!.id)}/acceptance`,
    );
    expect(accepted.statusCode, accepted.body).toBe(200);
    const now = (await h.call('ada', 'GET', `/v1/components/${cited.id}`)).json<{
      content: { content: { content: Json[] }[] };
    }>();
    expect(now.content.content[0]!.content).toEqual([
      { type: 'text', value: 'Weirs hold.', marks: [] },
      { type: 'citation', entry },
      { type: 'text', value: ' Marshes accrete.', marks: [] },
    ]);
  });
});
