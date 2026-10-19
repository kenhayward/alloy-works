import { readRun } from '@alloy-works/db';
import { canonicalCall, modelRequestSchema, type ModelEvent } from '@alloy-works/domain';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/** An invented provider key: it opens nothing, and must appear in no answer. */
const KEY = 'sk-invented-model-key-0123456789';

const endpoint = (over: Json = {}) => ({
  name: 'Drafting',
  protocol: 'anthropic',
  baseUrl: 'https://models.example.test',
  model: 'stand-in-1',
  contextWindow: 200_000,
  priceIn: 3,
  priceOut: 15,
  currency: 'USD',
  boundary: 'outside',
  ...over,
});

interface EndpointBody {
  endpoint: {
    id: string;
    name: string;
    boundary: string;
    retiredAt: string | null;
    key: { set: boolean; needsSetting?: boolean };
  };
}

describe('model endpoints through the service (the G1 plan)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const make = async (over: Json = {}) => {
    const made = await h.call('ada', 'POST', '/v1/model-endpoints', endpoint(over));
    if (made.statusCode !== 200) throw new Error(`${made.statusCode} ${made.body}`);
    return made.json<EndpointBody>().endpoint;
  };
  const keyed = async (over: Json = {}) => {
    const made = await make(over);
    const set = await h.call('ada', 'PUT', `/v1/model-endpoints/${made.id}/key`, { key: KEY });
    if (set.statusCode !== 200) throw new Error(`${set.statusCode} ${set.body}`);
    return set.json<EndpointBody>().endpoint;
  };
  const events = async (kind: string) =>
    (await h.call('ada', 'GET', `/v1/audit?kind=${kind}&limit=100`)).json<{
      items: { subject: { id: string } | null; detail: Json }[];
    }>().items;

  it('GEN-031 says where an endpoint sits outside the data boundary, as its administrator stated it', async () => {
    const outside = await make({ name: 'Hosted' });
    const inside = await make({
      name: 'Ours',
      protocol: 'openai',
      baseUrl: 'http://10.0.4.7:11434/v1',
      boundary: 'inside',
    });
    const listed = (await h.call('ada', 'GET', '/v1/model-endpoints')).json<{
      items: { id: string; boundary: string }[];
    }>().items;
    expect(listed.find((each) => each.id === outside.id)?.boundary).toBe('outside');
    expect(listed.find((each) => each.id === inside.id)?.boundary).toBe('inside');
    const unstated = await h.call('ada', 'POST', '/v1/model-endpoints', {
      ...endpoint({ name: 'Unstated' }),
      boundary: undefined,
    });
    expect(unstated.statusCode).toBe(400);
  });

  it('GEN-029 seals a key through the connector and answers only that it is set, never the key or its sealing', async () => {
    const made = await keyed({ name: 'Keyed' });
    expect(made.key).toMatchObject({ set: true, needsSetting: false });
    const asked = h.connector.asked.filter((each) => each.path === '/v1/model/seal');
    expect(asked.at(-1)?.body).toMatchObject({ endpoint: { id: made.id }, secret: KEY });
    for (const url of ['/v1/model-endpoints', `/v1/model-endpoints/${made.id}`]) {
      const read = await h.call('ada', 'GET', url);
      expect(read.body).not.toContain(KEY);
      expect(read.body).not.toMatch(/v1\.[A-Za-z0-9_-]{16}\./);
    }
    const stored = await h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'detail'])
        .where('subject', '=', made.id)
        .execute(),
    );
    expect(stored.map((row) => row.kind)).toEqual([
      'model_endpoint.made',
      'model_endpoint.credential_set',
    ]);
    expect(JSON.stringify(stored)).not.toContain(KEY);
    expect(h.lines.join('\n')).not.toContain(KEY);
  });

  it("needs a key set again once the base URL moves to another host, and keeps an endpoint's protocol", async () => {
    const made = await keyed({ name: 'Moving' });
    const moved = await h.call(
      'ada',
      'PUT',
      `/v1/model-endpoints/${made.id}`,
      endpoint({ name: 'Moving', baseUrl: 'https://elsewhere.example.test' }),
    );
    expect(moved.json<EndpointBody>().endpoint.key).toMatchObject({
      set: true,
      needsSetting: true,
    });
    const tested = await h.call('ada', 'POST', `/v1/model-endpoints/${made.id}/test`);
    expect(tested.statusCode).toBe(409);
    expect(tested.json()).toMatchObject({ code: 'endpoint_unusable' });
    const switched = await h.call(
      'ada',
      'PUT',
      `/v1/model-endpoints/${made.id}`,
      endpoint({ name: 'Moving', protocol: 'openai', baseUrl: 'https://elsewhere.example.test' }),
    );
    expect(switched.statusCode).toBe(409);
    expect(switched.json()).toMatchObject({ code: 'endpoint_protocol_fixed' });
    expect(
      (await events('model_endpoint.changed'))
        .filter((each) => each.subject?.id === made.id)
        .map((each) => each.detail),
    ).toEqual([{ settings: ['baseUrl'] }]);
  });

  it('GEN-028 routes each purpose to one endpoint or none, refusing one retired or without a key', async () => {
    const one = await keyed({ name: 'Routed one' });
    const two = await keyed({ name: 'Routed two' });
    const bare = await make({ name: 'No key' });
    const set = async (purpose: string, id: string | null) =>
      h.call('ada', 'PUT', `/v1/model-routes/${purpose}`, { endpoint: id });
    expect((await set('drafting', one.id)).statusCode).toBe(200);
    const routed = (await set('summarising', two.id)).json<{
      items: { purpose: string; endpoint: string | null }[];
    }>();
    expect(routed.items.map((each) => [each.purpose, each.endpoint])).toEqual([
      ['drafting', one.id],
      ['chat', null],
      ['summarising', two.id],
      ['embedding', null],
    ]);
    expect((await set('chat', bare.id)).json()).toMatchObject({ code: 'endpoint_unusable' });
    expect((await set('test', one.id)).statusCode).toBe(400);
    await h.call('ada', 'POST', `/v1/model-endpoints/${two.id}/retirement`);
    expect((await set('summarising', two.id)).json()).toMatchObject({ code: 'endpoint_unusable' });
    const now = (await h.call('ada', 'GET', '/v1/model-routes')).json<{
      items: { purpose: string; endpoint: string | null }[];
    }>();
    expect(now.items.find((each) => each.purpose === 'summarising')?.endpoint).toBeNull();
    expect(
      (await set('drafting', null)).json<{ items: { endpoint: string | null }[] }>().items[0]
        ?.endpoint,
    ).toBeNull();
    expect((await events('model_route.set')).map((each) => each.detail)).toContainEqual({
      purpose: 'summarising',
      endpoint: null,
    });
  });

  it('GEN-038 routes embedding to an endpoint speaking the OpenAI protocol alone, which a self-hosted model inside the boundary speaks', async () => {
    const anthropic = await keyed({ name: 'Messages only' });
    const refused = await h.call('ada', 'PUT', '/v1/model-routes/embedding', {
      endpoint: anthropic.id,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'embedding_unsupported' });
    const inside = await keyed({
      name: 'Embedding inside',
      protocol: 'openai',
      boundary: 'inside',
      model: 'stand-in-embed-768',
    });
    const routed = await h.call('ada', 'PUT', '/v1/model-routes/embedding', {
      endpoint: inside.id,
    });
    expect(routed.statusCode, routed.body).toBe(200);
    await h.call('ada', 'PUT', '/v1/model-routes/embedding', { endpoint: null });
  });

  it('tests an endpoint with one fixed call, recorded as a run with its digest, tokens and cost', async () => {
    const made = await keyed({ name: 'Tested' });
    const tested = await h.call('ada', 'POST', `/v1/model-endpoints/${made.id}/test`);
    expect(tested.statusCode, tested.body).toBe(200);
    const answer = tested.json<{
      run: string;
      outcome: string;
      reply: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      cost: string;
    }>();
    expect(answer).toMatchObject({
      outcome: 'passed',
      reply: 'ready.',
      model: 'stand-in-1-20260101',
      tokensIn: 12,
      tokensOut: 2,
      cost: '0.000066',
    });
    const sent = h.connector.asked.filter((each) => each.path === '/v1/model').at(-1)!.body;
    const request = modelRequestSchema.parse(sent);
    expect(request.endpoint).toEqual({
      id: made.id,
      protocol: 'anthropic',
      baseUrl: 'https://models.example.test',
    });
    const run = await h.tenantDb.withTenant(h.tenant, (trx) => readRun(trx, answer.run));
    expect(run).toMatchObject({
      purpose: 'test',
      endpointId: made.id,
      outcome: 'finished',
      model: 'stand-in-1-20260101',
      tokensIn: 12,
      tokensOut: 2,
      costMicros: 66n,
      requestedBy: h.ids.ada,
      documentId: null,
      contextDigest: createHash('sha256').update(canonicalCall(request.call), 'utf8').digest('hex'),
    });
    expect((await events('model_endpoint.tested')).map((each) => each.detail)).toContainEqual({
      run: answer.run,
      outcome: 'passed',
    });
  });

  it('GEN-032 answers a failed test by its code and reason, recorded as the run failed', async () => {
    const made = await keyed({ name: 'Failing' });
    const failing: ModelEvent[] = [
      { type: 'failed', failure: { code: 'model_unavailable', reason: 'key_refused' } },
    ];
    const before = h.connector.model;
    h.connector.model = failing;
    try {
      const tested = await h.call('ada', 'POST', `/v1/model-endpoints/${made.id}/test`);
      expect(tested.statusCode).toBe(200);
      const answer = tested.json<{ run: string; outcome: string; failure: Json }>();
      expect(answer).toMatchObject({
        outcome: 'failed',
        failure: {
          code: 'model_unavailable',
          reason: 'key_refused',
          message: 'The endpoint refused the key.',
        },
      });
      const run = await h.tenantDb.withTenant(h.tenant, (trx) => readRun(trx, answer.run));
      expect(run).toMatchObject({ outcome: 'model_unavailable', tokensIn: null, costMicros: null });
    } finally {
      h.connector.model = before;
    }
  });

  it('refuses every model endpoint route to anybody who does not administer the environment', async () => {
    const made = await keyed({ name: 'Guarded' });
    for (const [method, url, body] of [
      ['GET', '/v1/model-endpoints', undefined],
      ['POST', '/v1/model-endpoints', endpoint({ name: 'Theirs' })],
      ['GET', `/v1/model-endpoints/${made.id}`, undefined],
      ['PUT', `/v1/model-endpoints/${made.id}`, endpoint({ name: 'Theirs' })],
      ['POST', `/v1/model-endpoints/${made.id}/retirement`, undefined],
      ['PUT', `/v1/model-endpoints/${made.id}/key`, { key: KEY }],
      ['POST', `/v1/model-endpoints/${made.id}/test`, undefined],
      ['GET', '/v1/model-routes', undefined],
      ['PUT', '/v1/model-routes/drafting', { endpoint: made.id }],
    ] as const) {
      const refused = await h.call('alice', method, url, body as Json | undefined);
      expect(refused.statusCode, `${method} ${url}`).toBe(403);
      expect(refused.body).not.toContain(KEY);
    }
  });
});
