import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PRIVATE_RANGES } from './config.js';
import { childSpawn, createSupervisor } from './supervisor.js';
import { DEV_CA, startFakeApi, type FakeApi } from './testing/http.js';
import { SEALING_KEY, TENANT, suiteChild, suiteDeny, suiteIsolation } from './testing/source.js';

let api: FakeApi;
beforeAll(async () => {
  api = await startFakeApi();
});
afterAll(async () => {
  await api.close();
});

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 4,
  spec: childSpawn(suiteChild, suiteIsolation),
  ca: DEV_CA,
});

const fetchFrom = (url: string, through = supervisor) => {
  const call = through.vocabularySource({ requestId: randomUUID(), tenant: TENANT, url });
  if (call === 'busy') throw new Error('busy');
  return call;
};
const fetchOf = (path: string) => fetchFrom(`https://127.0.0.1:${api.port}${path}`);

describe('a vocabulary’s SKOS address fetched through the connector (the VO plan, VO-J)', () => {
  it("LIB-058 fetches a vocabulary's SKOS address whole, with its media type, through the guard", async () => {
    const answer = await fetchOf('/vocabulary/regions.ttl');
    expect(answer).toMatchObject({ type: 'fetched', contentType: 'text/turtle' });
    expect((answer as { body: string }).body).toContain('skos:prefLabel "North"@en');
    expect(api.seen.at(-1)).toMatchObject({
      method: 'GET',
      rawPath: '/vocabulary/regions.ttl',
      headers: {
        accept: 'text/turtle, application/ld+json;q=0.9, application/json;q=0.5',
        'user-agent': 'Alloy-Works-Vocabularies/1',
      },
    });
  });

  it('answers a refusal, or a source past 5 MB, by its code alone', async () => {
    expect(await fetchOf('/hooks/404')).toEqual({ type: 'failed', code: 'source_refused' });
    expect(await fetchOf('/vocabulary/too-large.ttl')).toEqual({
      type: 'failed',
      code: 'source_too_large',
    });
  });

  it('follows no redirect', async () => {
    expect(await fetchOf('/hooks/302')).toEqual({ type: 'failed', code: 'connection_failed' });
  });

  // The guard's refusal reads as any failure to reach does (DAT-075), as a manifest's does.
  it('refuses a private address where the deployment does not allow one, sending nothing', async () => {
    const strict = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      webhookDeny: [...PRIVATE_RANGES, '127.0.0.0/8'],
      maxChildren: 2,
      spec: childSpawn(suiteChild, suiteIsolation),
      ca: DEV_CA,
    });
    const seen = api.seen.length;
    for (const host of [`127.0.0.1:${api.port}`, '10.0.0.5', '192.168.4.4']) {
      expect(await fetchFrom(`https://${host}/vocabulary/regions.ttl`, strict), host).toEqual({
        type: 'failed',
        code: 'connection_failed',
      });
    }
    expect(api.seen.length).toBe(seen);
  });
});
