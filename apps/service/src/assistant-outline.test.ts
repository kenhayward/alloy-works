import { placeHold, removeGrant } from '@alloy-works/db';
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

interface Doc {
  id: string;
  nodes: string[];
}

interface Read {
  version: { id: string };
  outline: { nodes: { id: string; component?: string; title?: { value: string }[] }[] };
}

describe('proposing a change of the outline', () => {
  let h: Harness;
  let first: { id: string; version: string };
  let second: { id: string; version: string };
  let third: { id: string; version: string };

  const part = async (title: string) => {
    const made = await h.component(h.general, title);
    await h.place(made, { type: 'text', value: `${title} words.`, marks: [] });
    return made;
  };

  const propose = async (document: Doc, steps: Json[], as = 'ada') => {
    h.connector.modelFor = calling('propose_outline', { steps });
    const response = await h.call(as, 'POST', `/v1/documents/${document.id}/assistant/runs`, {
      ask: 'Change the outline.',
    });
    expect(response.statusCode, response.body).toBe(200);
    const frames = framesOf(response.body);
    return {
      result: frames.find((frame) => frame.event === 'tool_result')!.data,
      proposal: frames.find((frame) => frame.event === 'proposal')?.data as
        { id: string; component: null; outline: { says: Json[] } } | undefined,
    };
  };

  const act = (id: string, how: string, as = 'ada') =>
    h.call(as, 'POST', `/v1/assistant/proposals/${id}/${how}`);

  const read = async (document: Doc, as = 'ada') =>
    (await h.call(as, 'GET', `/v1/documents/${document.id}`)).json<Read>();

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
    first = await part('First');
    second = await part('Second');
    third = await part('Third');
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('GEN-062 proposes steps that change nothing until accepted, then makes one version of them all', async () => {
    const document = await h.documentReferencing([first.id, second.id]);
    const before = await read(document);
    const { result, proposal } = await propose(document, [
      { do: 'place', component: third.id, after: 'start' },
      { do: 'move', node: document.nodes[1], after: document.nodes[0] },
      { do: 'section', title: 'Results' },
    ]);
    expect(result).toMatchObject({ ok: true, said: { code: 'proposal', number: 1 } });
    expect(proposal!.component).toBeNull();
    expect(proposal!.outline.says).toMatchObject([
      { do: 'place', what: 'Readings', first: true },
      { do: 'move', what: 'Readings' },
      { do: 'section', what: 'Results' },
    ]);
    expect((await read(document)).version.id).toBe(before.version.id);
    const accepted = await act(proposal!.id, 'acceptance');
    expect(accepted.statusCode, accepted.body).toBe(200);
    const after = await read(document);
    expect(after.version.id).not.toBe(before.version.id);
    expect(accepted.json()).toMatchObject({
      proposal: { state: 'accepted', version: after.version.id },
    });
    expect(after.outline.nodes[0]!.component).toBe(third.id);
    expect(after.outline.nodes.at(-1)!.title?.[0]?.value).toBe('Results');
    const events = (await h.call('ada', 'GET', '/v1/audit?kind=generation.accepted&limit=5')).json<{
      items: { subject: Json; detail: Json }[];
    }>().items;
    expect(events[0]).toMatchObject({
      subject: { kind: 'document', id: document.id },
      detail: { proposal: proposal!.id, version: after.version.id },
    });
  });

  it('GEN-062 refuses to accept where the document has moved on since, changing nothing', async () => {
    const document = await h.documentReferencing([first.id]);
    const { proposal } = await propose(document, [{ do: 'section', title: 'Later' }]);
    const opened = await read(document);
    const moved = await h.call('ada', 'POST', `/v1/documents/${document.id}/outline`, {
      openedFrom: opened.version.id,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'section', title: [{ type: 'text', value: 'Sooner', marks: [] }] },
      },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const refused = await act(proposal!.id, 'acceptance');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'outline_moved' });
    expect(JSON.stringify((await read(document)).outline)).not.toContain('Later');
  });

  it('refuses to accept under a legal hold', async () => {
    const document = await h.documentReferencing([first.id]);
    const { proposal } = await propose(document, [{ do: 'section', title: 'Held' }]);
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      placeHold(trx, {
        target: { artifact: document.id },
        reason: 'An invented reason.',
        by: h.ids.ada!,
      }),
    );
    const refused = await act(proposal!.id, 'acceptance');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'document_held' });
  });

  it('GEN-014 refuses to place a part the person may not read', async () => {
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    const hidden = await h.component(h.quality, 'Hidden');
    const document = await h.documentReferencing([first.id]);
    const { result, proposal } = await propose(
      document,
      [{ do: 'place', component: hidden.id }],
      'grace',
    );
    expect(result).toMatchObject({ ok: false, said: { code: 'edit_refused' } });
    expect(proposal).toBeUndefined();
  });

  it('holds a place to what may be referenced as it is accepted, not as it was proposed', async () => {
    const elsewhere = await h.component(h.quality, 'Elsewhere');
    const document = await h.documentReferencing([first.id]);
    const allowed = await h.allow(h.ids.grace!, h.roles.Reader!, {
      kind: 'space',
      id: h.quality,
    });
    const { proposal } = await propose(
      document,
      [{ do: 'place', component: elsewhere.id }],
      'grace',
    );
    expect(proposal).toBeDefined();
    await h.tenantDb.withTenant(h.tenant, (trx) => removeGrant(trx, allowed));
    const refused = await act(proposal!.id, 'acceptance', 'grace');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'outline_refused' });
  });

  it('GEN-040 records a discard, and an outline is never kept as a suggestion', async () => {
    const document = await h.documentReferencing([first.id]);
    const { proposal } = await propose(document, [{ do: 'section', title: 'Dropped' }]);
    const kept = await act(proposal!.id, 'keeping');
    expect(kept.statusCode).toBe(409);
    expect(kept.json()).toMatchObject({ code: 'proposal_outline' });
    const discarded = await act(proposal!.id, 'discarding');
    expect(discarded.statusCode, discarded.body).toBe(200);
    const events = (
      await h.call('ada', 'GET', '/v1/audit?kind=generation.discarded&limit=5')
    ).json<{ items: { subject: Json; detail: Json }[] }>().items;
    expect(events[0]).toMatchObject({
      subject: { kind: 'document', id: document.id },
      detail: { proposal: proposal!.id },
    });
  });

  it('refuses one who may not suggest on the document', async () => {
    const document = await h.documentReferencing([first.id]);
    const { result, proposal } = await propose(document, [{ do: 'section', title: 'No' }], 'alice');
    expect(result).toMatchObject({ ok: false, said: { code: 'not_yours_to_change' } });
    expect(proposal).toBeUndefined();
  });

  it('lets a proposal to accept be acted on only by who asked', async () => {
    const document = await h.documentReferencing([first.id]);
    const { proposal } = await propose(document, [{ do: 'section', title: 'Mine' }]);
    expect((await act(proposal!.id, 'acceptance', 'grace')).statusCode).toBe(404);
  });

  it('GEN-062 places a new part where a conversation on a document names, as it is accepted', async () => {
    const document = await h.documentReferencing([first.id]);
    const id = (
      await h.call('ada', 'POST', '/v1/conversations', {
        title: 'Placing',
        document: document.id,
      })
    ).json<{ conversation: { id: string } }>().conversation.id;
    h.connector.modelFor = calling('propose_component', {
      space: h.general,
      title: 'Fresh',
      markdown: 'Fresh words.',
      place: { after: 'start' },
    });
    const turn = await h.call('ada', 'POST', `/v1/conversations/${id}/turns`, { ask: 'Make it.' });
    const proposal = framesOf(turn.body).find((frame) => frame.event === 'proposal')!.data as {
      id: string;
    };
    const accepted = await act(proposal.id, 'acceptance');
    expect(accepted.statusCode, accepted.body).toBe(200);
    const made = accepted.json<{ proposal: { component: string } }>().proposal.component;
    expect((await read(document)).outline.nodes[0]!.component).toBe(made);
  });
});
