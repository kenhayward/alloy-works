import { grant } from '@alloy-works/db';
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

const calling =
  (name: string, input: Json) =>
  (request: ModelRequest): ModelEvent[] =>
    request.call.messages.some((message) => message.role === 'assistant')
      ? [{ type: 'text', text: 'Done.' }, ended()]
      : [{ type: 'tool_call', id: 't1', name, input }, ended('tool_use')];

describe('reading the comments on a part', () => {
  let h: Harness;
  let part: { id: string; version: string };
  let document: { id: string };

  const thread = async (as: string, parts: Json[], over: Json = {}) => {
    const started = await h.call(as, 'POST', `/v1/components/${part.id}/threads`, {
      version: part.version,
      anchor: { kind: 'span', block: 'p1', quote: 'The weir', before: '' },
      parts,
      ...over,
    });
    expect(started.statusCode, started.body).toBe(200);
    return started.json<{ id: string; comments: { id: string }[] }>();
  };

  const read = async (as: string, input: Json = { component: part.id }) => {
    h.connector.modelFor = calling('read_comments', input);
    const response = await h.call(as, 'POST', `/v1/documents/${document.id}/assistant/runs`, {
      ask: 'What do the comments say?',
    });
    expect(response.statusCode, response.body).toBe(200);
    const result = framesOf(response.body).find((frame) => frame.event === 'tool_result')!.data;
    return { result, content: String(result.result) };
  };

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
    part = await h.component(h.general, 'Sites');
    await h.place(part, { type: 'text', value: 'The weir floods.', marks: [] });
    document = await h.documentReferencing([part.id]);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('GEN-061 reads each thread’s quote, state and latest words, its authors unnamed and its mentions gone', async () => {
    const started = await thread('grace', [
      { text: 'Is it this high, ' },
      { mention: h.ids.ada! },
      { text: '?' },
    ]);
    await h.call('ada', 'POST', `/v1/threads/${started.id}/comments`, {
      parts: [{ text: 'First words of the reply.' }],
    });
    const { comments } = (await h.call('ada', 'GET', `/v1/threads/${started.id}`)).json<{
      comments: { id: string }[];
    }>();
    const edited = await h.call(
      'ada',
      'PUT',
      `/v1/threads/${started.id}/comments/${comments[1]!.id}`,
      { parts: [{ text: 'It is that high.' }] },
    );
    expect(edited.statusCode, edited.body).toBe(200);
    const { result, content } = await read('grace');
    expect(result).toMatchObject({ ok: true, said: { code: 'found', count: 1 } });
    expect(content).toMatch(/^<content source="comments:/);
    expect(content).toContain('on "The weir"');
    expect(content).toContain('open');
    expect(content).toContain('Reviewer 1: Is it this high, ?');
    expect(content).toContain('Reviewer 2: It is that high.');
    expect(content).not.toContain('First words');
    expect(content).not.toContain(h.ids.ada!);
    expect(content).not.toContain(h.ids.grace!);
    for (const name of ['Ada', 'Grace']) expect(content).not.toContain(name);
    await h.call('ada', 'POST', `/v1/threads/${started.id}/resolution`, {});
  });

  it('reads only the threads in the state asked for', async () => {
    const open = await thread('grace', [{ text: 'Still open words.' }]);
    const resolvedOnly = await read('grace', { component: part.id, state: 'resolved' });
    expect(resolvedOnly.content).toContain('resolved');
    expect(resolvedOnly.content).not.toContain('Still open words.');
    const openOnly = await read('grace', { component: part.id, state: 'open' });
    expect(openOnly.content).toContain('Still open words.');
    await h.call('ada', 'POST', `/v1/threads/${open.id}/resolution`, {});
  });

  it('GEN-061 reads an internal thread to one inside, marked, and none to one from outside', async () => {
    const started = await thread('grace', [{ text: 'Kept inside words.' }], { internal: true });
    const inside = await read('grace');
    expect(inside.content).toContain('internal');
    expect(inside.content).toContain('Kept inside words.');
    // Somebody from outside reads only by a grant that ends (IAM-049).
    await h.tenantDb.withTenant(h.tenant, async (trx) => {
      await grant(trx, {
        roleId: h.roles.Reader!,
        subject: { principal: h.ids.ivy! },
        level: { kind: 'space', id: h.general },
        effect: 'allow',
        grantedBy: h.ids.ada!,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await trx
        .updateTable('principal')
        .set({ kind: 'external' })
        .where('id', '=', h.ids.ivy!)
        .execute();
    });
    const outside = await read('ivy');
    expect(outside.result).toMatchObject({ ok: true });
    expect(outside.content).not.toContain('Kept inside words.');
    await h.call('ada', 'POST', `/v1/threads/${started.id}/resolution`, {});
  });

  it('GEN-014 answers nothing of a part the person may not read', async () => {
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    const hidden = await h.component(h.quality, 'Hidden');
    await h.place(hidden, { type: 'text', value: 'Hidden words.', marks: [] });
    const said = await h.call('ada', 'POST', `/v1/components/${hidden.id}/threads`, {
      version: hidden.version,
      anchor: { kind: 'component' },
      parts: [{ text: 'A hidden comment.' }],
    });
    expect(said.statusCode, said.body).toBe(200);
    const { result, content } = await read('grace', { component: hidden.id });
    expect(result).toMatchObject({ ok: false });
    expect(content).not.toContain('A hidden comment.');
  });

  it('says so where a part holds no comments', async () => {
    const quiet = await h.component(h.general, 'Quiet');
    const { result, content } = await read('grace', { component: quiet.id });
    expect(result).toMatchObject({ ok: true, said: { code: 'found', count: 0 } });
    expect(content).toContain('There are none.');
  });
});
