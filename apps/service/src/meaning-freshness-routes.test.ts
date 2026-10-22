import { setServingEmbedding, storeEmbeddings, textHash } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

const MODEL = 'stand-in-embed-384';
const WORDS = 'The north weir floods each spring.';

/** Meaning's lag, shown (the FR plan, FR-E). */
describe("meaning's freshness over the last seven days", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    const endpoint = (
      await h.call('ada', 'POST', '/v1/model-endpoints', {
        name: 'Embedding',
        protocol: 'openai',
        baseUrl: 'https://models.example.test',
        model: MODEL,
        contextWindow: 8192,
        priceIn: 2,
        priceOut: 0,
        currency: 'USD',
        boundary: 'inside',
      })
    ).json<{ endpoint: { id: string } }>().endpoint.id;
    await h.tenantDb.withTenant(h.tenant, async (trx) => {
      await setServingEmbedding(trx, { model: MODEL, dims: 384, endpointId: endpoint });
      await storeEmbeddings(trx, [
        {
          textHash: textHash(WORDS),
          model: MODEL,
          modelVersion: MODEL,
          dims: 384,
          vector: new Array<number>(384).fill(0.1),
        },
      ]);
    });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const freshness = (who: string) => h.call(who, 'GET', '/v1/search/meaning/freshness');

  it('SCH-067 answers the p95 and most of how long versions took to be findable by meaning, to an administrator alone', async () => {
    expect((await freshness('ada')).json()).toEqual({
      versions: 0,
      p95Seconds: null,
      maxSeconds: null,
    });
    // Its words already embedded: findable by meaning as it is indexed.
    const made = await h.component(h.general, 'Reused');
    await h.place(made, { type: 'text', value: WORDS, marks: [] });
    const answered = await freshness('ada');
    expect(answered.statusCode, answered.body).toBe(200);
    const body = answered.json<{ versions: number; p95Seconds: number; maxSeconds: number }>();
    expect(body.versions).toBe(1);
    expect(body.p95Seconds).toBeGreaterThanOrEqual(0);
    expect(body.maxSeconds).toBe(body.p95Seconds);
    expect((await freshness('grace')).statusCode).toBe(403);
  });
});
