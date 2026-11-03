import { findRole, grant } from '@alloy-works/db';
import type { ModelEvent, ModelRequest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { binding, startHarness, type Harness } from './test/bindings-harness.js';

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

describe('inserting what stays live', () => {
  let h: Harness;
  let sites: { id: string; version: string };
  let other: { id: string; version: string };
  let bound: { id: string; version: string };
  let document: { id: string; nodes: string[] };

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
    await h.tenantDb.withTenant(h.tenant, async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Definitions manager'))!.id,
        subject: { principal: h.ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: h.ids.ada!,
      }),
    );
    const variable = await h.call('ada', 'POST', '/v1/definitions', {
      kind: 'variable',
      definition: {
        schemaVersion: 1,
        name: 'Region',
        key: 'region',
        type: { base: 'text' },
        sources: { parameter: 'region' },
      },
    });
    expect(variable.statusCode, variable.body).toBe(200);
    sites = await h.component(h.general, 'Sites');
    await h.place(sites, { type: 'text', value: 'The weir floods. It holds.', marks: [] });
    other = await h.component(h.general, 'Other');
    await h.place(other, { type: 'text', value: 'Another part.', marks: [] });
    const connection = await h.connection('Readings');
    const definition = await h.definition(connection.id);
    bound = await h.component(h.general, 'Bound');
    await h.place(
      bound,
      { type: 'text', value: 'The height is ', marks: [] },
      binding('b1', definition.id, { take: { column: 'name' } }),
    );
    document = await h.documentReferencing([sites.id, other.id, bound.id]);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const insert = async (
    item: Json,
    as = 'ada',
    block = 'p1',
    after: string | undefined = 'floods.',
  ) => {
    h.connector.modelFor = calling('propose_insert', {
      component: sites.id,
      block,
      ...(after === undefined ? {} : { after }),
      item,
    });
    const response = await h.call(as, 'POST', `/v1/documents/${document.id}/assistant/runs`, {
      ask: 'Insert it.',
    });
    expect(response.statusCode, response.body).toBe(200);
    const frames = framesOf(response.body);
    return {
      result: frames.find((frame) => frame.event === 'tool_result')!.data,
      proposal: frames.find((frame) => frame.event === 'proposal')?.data as
        { id: string; proposed: { content: { content: Json[] }[] } } | undefined,
    };
  };
  const insertedBy = (proposal: { proposed: { content: { content: Json[] }[] } } | undefined) =>
    proposal!.proposed.content[0]!.content[1]!;

  it('lists the variables of the environment by key', async () => {
    h.connector.modelFor = calling('read_variables', {});
    const response = await h.call('ada', 'POST', `/v1/documents/${document.id}/assistant/runs`, {
      ask: 'Which variables are there?',
    });
    const result = framesOf(response.body).find((frame) => frame.event === 'tool_result')!.data;
    expect(result).toMatchObject({ ok: true, said: { code: 'found', count: 1 } });
    expect(String(result.result)).toContain('region: Region (text)');
  });

  it('proposes a variable the environment declares, and refuses another, naming those there are', async () => {
    const { proposal } = await insert({ variable: 'region' });
    expect(insertedBy(proposal)).toEqual({ type: 'variable', name: 'region' });
    const refused = await insert({ variable: 'invented' });
    expect(refused.result).toMatchObject({ ok: false, said: { code: 'edit_refused' } });
    expect(String(refused.result.result)).toBe('There is no variable invented. There are: region.');
    expect(refused.proposal).toBeUndefined();
  });

  it('proposes a bound value copied from one in the document, by a new identity, its query never the model’s', async () => {
    const node = document.nodes[2]!;
    const { proposal } = await insert({ value: { node, binding: 'b1' } });
    const copied = insertedBy(proposal) as Json;
    expect(copied).toMatchObject({ type: 'binding', take: { column: 'name' } });
    expect(copied.id).not.toBe('b1');
    const missing = await insert({ value: { node, binding: 'b9' } });
    expect(String(missing.result.result)).toBe(
      'There is no single bound value b9 at that place: read_values names those there are.',
    );
    const unplaced = await insert({ value: { node: 'n-invented', binding: 'b1' } });
    expect(unplaced.result).toMatchObject({ ok: false, said: { code: 'edit_refused' } });
  });

  it('CNT-027 proposes a cross-reference holding its target and what to display, never a number', async () => {
    const block = await insert({ reference: { block: 'p1' } });
    expect(insertedBy(block.proposal)).toMatchObject({
      type: 'crossReference',
      target: { kind: 'block', block: 'p1' },
      display: 'number',
    });
    const part = await insert({
      reference: { block: 'p1', component: other.id },
      display: 'title',
    });
    expect(insertedBy(part.proposal)).toMatchObject({
      target: { kind: 'component', component: other.id, block: 'p1' },
      display: 'title',
    });
    const node = await insert({ reference: { node: document.nodes[1]! } });
    expect(insertedBy(node.proposal)).toMatchObject({
      target: { kind: 'node', node: document.nodes[1]! },
    });
  });

  it('refuses a cross-reference to what the document does not hold', async () => {
    for (const reference of [
      { block: 'p-invented' },
      { block: 'p-invented', component: other.id },
      { block: 'p1', component: '00000000-0000-4000-8000-00000000bbbb' },
      { node: '00000000-0000-4000-8000-00000000cccc' },
    ]) {
      const { result, proposal } = await insert({ reference });
      expect(result).toMatchObject({ ok: false, said: { code: 'edit_refused' } });
      expect(proposal).toBeUndefined();
    }
  });

  it('proposes a footnote from Markdown, marks and all, refusing what a note cannot hold', async () => {
    const { proposal } = await insert({ footnote: 'Measured in **spring**.' });
    expect(insertedBy(proposal)).toMatchObject({
      type: 'footnote',
      anchor: { kind: 'span' },
      content: [{ type: 'paragraph', content: [{ type: 'text', value: 'Measured in ' }, {}, {}] }],
    });
    const refused = await insert({ footnote: '| a | b |\n| --- | --- |\n| 1 | 2 |' });
    expect(refused.result).toMatchObject({ ok: false, said: { code: 'edit_refused' } });
    expect(String(refused.result.result)).toBe('A footnote holds paragraphs alone (CNT-129).');
  });

  it('makes an accepted insert a version the service keeps, the words either side standing', async () => {
    const { proposal } = await insert({ variable: 'region' });
    const accepted = await h.call(
      'ada',
      'POST',
      `/v1/assistant/proposals/${proposal!.id}/acceptance`,
    );
    expect(accepted.statusCode, accepted.body).toBe(200);
    const now = (await h.call('ada', 'GET', `/v1/components/${sites.id}`)).json<{
      content: { content: { content: Json[] }[] };
    }>();
    expect(now.content.content[0]!.content).toEqual([
      { type: 'text', value: 'The weir floods.', marks: [] },
      { type: 'variable', name: 'region' },
      { type: 'text', value: ' It holds.', marks: [] },
    ]);
  });

  it('says each value’s binding, and each node, so the model can name them', async () => {
    const reading = async (name: string) => {
      h.connector.modelFor = calling(name, {});
      const response = await h.call('ada', 'POST', `/v1/documents/${document.id}/assistant/runs`, {
        ask: 'Read it.',
      });
      return String(
        framesOf(response.body).find((frame) => frame.event === 'tool_result')!.data.result,
      );
    };
    expect(await reading('read_values')).toContain(`At ${document.nodes[2]!}, binding b1,`);
    expect(await reading('read_outline')).toContain(`(node ${document.nodes[1]!})`);
  });

  it('refuses one who may not suggest on the part', async () => {
    const { result, proposal } = await insert({ variable: 'region' }, 'alice');
    expect(result).toMatchObject({ ok: false });
    expect(proposal).toBeUndefined();
  });

  it('refuses a value or a node where a conversation has no document', async () => {
    const id = (await h.call('ada', 'POST', '/v1/conversations', { title: 'Loose' })).json<{
      conversation: { id: string };
    }>().conversation.id;
    h.connector.modelFor = calling('propose_insert', {
      component: sites.id,
      block: 'p1',
      item: { value: { node: 'n1', binding: 'b1' } },
    });
    const turn = await h.call('ada', 'POST', `/v1/conversations/${id}/turns`, { ask: 'Insert.' });
    const result = framesOf(turn.body).find((frame) => frame.event === 'tool_result')!.data;
    expect(result).toMatchObject({ ok: false, said: { code: 'edit_refused' } });
    expect(String(result.result)).toBe('A bound value or a section is named only on a document.');
  });
});
