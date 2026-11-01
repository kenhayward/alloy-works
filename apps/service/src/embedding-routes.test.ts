import { embeddingModels } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

interface View {
  serving: { model: string; dims: number } | null;
  pending: {
    model: string;
    dims: number | null;
    confirmed: boolean;
    texts: number;
    missing: number;
    estimate: { tokens: number; cost: string | null; currency: string | null };
  } | null;
}

describe('embedding a corpus, costed and confirmed first (the G7 plan, G7-J)', () => {
  let h: Harness;
  let endpoint = '';
  let dims = 384;

  beforeAll(async () => {
    h = await startHarness();
    endpoint = (
      await h.call('ada', 'POST', '/v1/model-endpoints', {
        name: 'Embedding',
        protocol: 'openai',
        kind: 'embedding',
        timeoutSeconds: 200,
        baseUrl: 'https://models.example.test',
        model: 'stand-in-embed-384',
        contextWindow: 8192,
        priceIn: 2,
        priceOut: 0,
        currency: 'USD',
        boundary: 'inside',
      })
    ).json<{ endpoint: { id: string } }>().endpoint.id;
    await h.call('ada', 'PUT', `/v1/model-endpoints/${endpoint}/key`, { key: 'an-invented-key' });
    h.connector.embedFor = (request) => ({
      type: 'embedded',
      model: request.call.model,
      vectors: request.call.inputs.map(() => new Array<number>(dims).fill(0.1)),
      usage: { in: 12 },
    });
    for (const words of ['The north weir floods each spring.', 'Roses in the borders.']) {
      const made = await h.component(h.general, 'Part');
      await h.place(made, { type: 'text', value: words, marks: [] });
    }
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const view = async () => (await h.call('ada', 'GET', '/v1/embedding')).json<View>();
  const models = () => h.tenantDb.withTenant(h.tenant, (trx) => embeddingModels(trx));

  it('GEN-044 shows what embedding the corpus would cost before it runs, and embeds nothing until an administrator confirms it', async () => {
    const routed = await h.call('ada', 'PUT', '/v1/model-routes/embedding', { endpoint });
    expect(routed.statusCode, routed.body).toBe(200);
    const waiting = await view();
    expect(waiting.serving).toBeNull();
    expect(waiting.pending).toMatchObject({
      model: 'stand-in-embed-384',
      confirmed: false,
      dims: null,
      texts: 2,
      missing: 2,
      estimate: { currency: 'USD' },
    });
    // 34 and 21 characters: 14 tokens at two dollars a million.
    expect(waiting.pending!.estimate).toEqual({ tokens: 14, cost: '0.000028', currency: 'USD' });
    // Nothing is embedded for it, at indexing or by a job, until it is confirmed.
    expect(await models()).toEqual([]);
    expect(
      (await h.call('grace', 'POST', '/v1/embedding/confirmation', { model: 'stand-in-embed-384' }))
        .statusCode,
    ).toBe(403);

    const asked = h.connector.asked.length;
    const confirmed = await h.call('ada', 'POST', '/v1/embedding/confirmation', {
      model: 'stand-in-embed-384',
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    // One sample, to learn its dimensions.
    expect(h.connector.asked.slice(asked).map((each) => each.path)).toEqual(['/v1/embed']);
    // Within the endpoint's own timeout.
    expect(h.connector.asked.at(-1)?.body).toMatchObject({ deadlineMs: 200_000 });
    // The sample's run, ended and recorded as the administrator who confirmed it.
    const runs = (await h.call('ada', 'GET', '/v1/audit?kind=generation.run&limit=50')).json<{
      items: { actor: string | null; detail: { purpose: string; outcome: string } }[];
    }>().items;
    expect(runs.filter((each) => each.detail.purpose === 'embedding')).toEqual([
      expect.objectContaining({
        actor: h.ids.ada,
        detail: expect.objectContaining({ outcome: 'finished' }),
      }),
    ]);
    expect(confirmed.json<View>().pending).toMatchObject({ confirmed: true, dims: 384 });
    expect(await models()).toEqual([
      { model: 'stand-in-embed-384', dims: 384, endpointId: endpoint },
    ]);
    const events = (
      await h.call('ada', 'GET', '/v1/audit?kind=generation.embedding_confirmed')
    ).json<{ items: { subject: { id: string }; detail: { dims: number } }[] }>().items;
    expect(events).toEqual([
      expect.objectContaining({
        subject: expect.objectContaining({ id: endpoint }),
        detail: { dims: 384 },
      }),
    ]);
  });

  it('refuses a model whose vectors are of a length meaning cannot index, confirming nothing', async () => {
    const other = (
      await h.call('ada', 'POST', '/v1/model-endpoints', {
        name: 'Odd',
        protocol: 'openai',
        kind: 'embedding',
        baseUrl: 'https://models.example.test',
        model: 'stand-in-embed-100',
        contextWindow: 8192,
        priceIn: 1,
        priceOut: 0,
        currency: 'USD',
        boundary: 'inside',
      })
    ).json<{ endpoint: { id: string } }>().endpoint.id;
    await h.call('ada', 'PUT', `/v1/model-endpoints/${other}/key`, { key: 'an-invented-key' });
    await h.call('ada', 'PUT', '/v1/model-routes/embedding', { endpoint: other });
    dims = 100;
    try {
      const refused = await h.call('ada', 'POST', '/v1/embedding/confirmation', {
        model: 'stand-in-embed-100',
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'embedding_dimensions_unsupported' });
      expect((await view()).pending).toMatchObject({ confirmed: false });
    } finally {
      dims = 384;
    }
  });

  it("says why a model did not answer its sample, and ends the sample's run", async () => {
    const other = (
      await h.call('ada', 'POST', '/v1/model-endpoints', {
        name: 'Sleepy',
        protocol: 'openai',
        kind: 'embedding',
        baseUrl: 'https://models.example.test',
        model: 'stand-in-embed-sleepy',
        contextWindow: 8192,
        priceIn: 1,
        priceOut: 0,
        currency: 'USD',
        boundary: 'inside',
      })
    ).json<{ endpoint: { id: string } }>().endpoint.id;
    await h.call('ada', 'PUT', `/v1/model-endpoints/${other}/key`, { key: 'an-invented-key' });
    await h.call('ada', 'PUT', '/v1/model-routes/embedding', { endpoint: other });
    const was = h.connector.embedFor;
    h.connector.embedFor = () => ({ type: 'failed', failure: { code: 'timeout' } });
    try {
      const refused = await h.call('ada', 'POST', '/v1/embedding/confirmation', {
        model: 'stand-in-embed-sleepy',
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        code: 'embedding_unavailable',
        message: 'The model did not answer a sample: The endpoint did not finish in time.',
      });
      const runs = (await h.call('ada', 'GET', '/v1/audit?kind=generation.run&limit=50')).json<{
        items: { actor: string | null; detail: { outcome: string } }[];
      }>().items;
      expect(runs[0]).toMatchObject({ actor: h.ids.ada, detail: { outcome: 'timeout' } });
    } finally {
      h.connector.embedFor = was;
    }
  });
});
