import {
  embedIndexed,
  setServingEmbedding,
  storeEmbeddings,
  textHash,
  runsThisMonth,
} from '@alloy-works/db';
import type { EmbedRequest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

/** Words taken as meaning the same, as the stand-in model takes them. Invented. */
const SAME: Record<string, string> = {
  dam: 'weir',
  dams: 'weir',
  inundation: 'flood',
  floods: 'flood',
};

/** A text's vector of 384 places: its words, each as the word it means, counted, of length one. */
function vectorOf(text: string): number[] {
  const vector = new Array<number>(384).fill(0);
  for (const raw of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const word = SAME[raw] ?? raw;
    let hash = 2166136261;
    for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    vector[hash % 384]! += 1;
  }
  const length = Math.hypot(...vector) || 1;
  return vector.map((each) => each / length);
}

interface Item {
  artifactId: string;
  found: string;
}

describe('searching by meaning through the service (the G7 plan, G7-G to G7-I)', () => {
  let h: Harness;
  let endpoint = '';
  const id: Record<string, string> = {};
  const embedded: EmbedRequest[] = [];

  beforeAll(async () => {
    h = await startHarness();
    endpoint = (
      await h.call('ada', 'POST', '/v1/model-endpoints', {
        name: 'Embedding',
        protocol: 'openai',
        baseUrl: 'https://models.example.test',
        model: 'stand-in-embed-384',
        contextWindow: 8192,
        priceIn: 0.02,
        priceOut: 0,
        currency: 'USD',
        boundary: 'inside',
      })
    ).json<{ endpoint: { id: string } }>().endpoint.id;
    await h.call('ada', 'PUT', `/v1/model-endpoints/${endpoint}/key`, { key: 'an-invented-key' });
    h.connector.embedFor = (request) => {
      embedded.push(request);
      return {
        type: 'embedded',
        model: request.call.model,
        vectors: request.call.inputs.map(vectorOf),
        usage: { in: 4 },
      };
    };
    // Parts in General, which Grace reads, and one in Quality, which she may not.
    const part = async (space: string, title: string, words: string) => {
      const made = await h.component(space, title);
      await h.place(made, { type: 'text', value: words, marks: [] });
      id[title] = made.id;
      return made.id;
    };
    const parts = [
      await part(h.general, 'Sites', 'The north weir floods each spring.'),
      await part(h.general, 'Gardens', 'Roses and tulips in the borders.'),
    ];
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    parts.push(await part(h.quality, 'Quality weir', 'A confidential dam inspection.'));
    // Embedded as the worker would: each block's words, then the passages copied.
    await h.tenantDb.withTenant(h.tenant, async (trx) => {
      await setServingEmbedding(trx, {
        model: 'stand-in-embed-384',
        dims: 384,
        endpointId: endpoint,
      });
      for (const words of [
        'The north weir floods each spring.',
        'Roses and tulips in the borders.',
        'A confidential dam inspection.',
      ]) {
        await storeEmbeddings(trx, [
          {
            textHash: textHash(words),
            model: 'stand-in-embed-384',
            modelVersion: 'stand-in-embed-384',
            dims: 384,
            vector: vectorOf(words),
          },
        ]);
      }
      for (const id of parts) await embedIndexed(trx, id, { queue: false });
    });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const search = async (q: string) =>
    (await h.call('grace', 'GET', `/v1/search?q=${encodeURIComponent(q)}`)).json<{
      outcome: string;
      count: number;
      meaning: string;
      items: Item[];
    }>();

  it('SCH-013 finds by meaning what its words do not hold, over what the searcher may read alone', async () => {
    const answer = await search('dam');
    expect(answer.meaning).toBe('used');
    // No part holds the word; Sites means it. Quality's part, nearer still, is not Grace's to read.
    expect(answer.items.map((each) => [each.artifactId, each.found])).toEqual([
      [id.Sites, 'meaning'],
    ]);
    expect(answer.count).toBe(0);
  });

  it('SCH-014 labels a result found both ways apart from one found by its words alone', async () => {
    const answer = await search('weir');
    expect(answer.items.find((each) => each.artifactId === id.Sites)?.found).toBe('both');
  });

  it("embeds a search's words once a day for its searcher, as a run of theirs", async () => {
    const before = embedded.length;
    const runs = (await h.tenantDb.withTenant(h.tenant, (trx) => runsThisMonth(trx, h.ids.grace!)))
      .runs;
    await search('north spring');
    await search('north spring');
    expect(embedded.length - before).toBe(1);
    expect(
      (await h.tenantDb.withTenant(h.tenant, (trx) => runsThisMonth(trx, h.ids.grace!))).runs,
    ).toBe(runs + 1);
  });

  it('SCH-031 answers by words alone, saying so, where the embedding model does not answer or none serves', async () => {
    const was = h.connector.embedFor;
    h.connector.embedFor = () => ({
      type: 'failed',
      failure: { code: 'model_unavailable', reason: 'unreachable' },
    });
    try {
      const answer = await search('borders tulips');
      expect(answer.meaning).toBe('unavailable');
      expect(answer.items.map((each) => [each.artifactId, each.found])).toEqual([
        [id.Gardens, 'words'],
      ]);
    } finally {
      h.connector.embedFor = was;
    }
    await h.tenantDb.withTenant(h.tenant, (trx) => setServingEmbedding(trx, null));
    try {
      expect((await search('weir')).meaning).toBe('unconfigured');
    } finally {
      await h.tenantDb.withTenant(h.tenant, (trx) =>
        setServingEmbedding(trx, { model: 'stand-in-embed-384', dims: 384, endpointId: endpoint }),
      );
    }
  });
});
