import { randomUUID } from 'node:crypto';

import { readManifest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

const fetchOf = (path: string) =>
  supervisor.manifest({
    requestId: randomUUID(),
    tenant: TENANT,
    url: `https://127.0.0.1:${api.port}${path}`,
  });

describe('an extension’s manifest fetched through the connector (the EX plan, EX-B)', () => {
  it('fetches a manifest by its URL, whole, for the service to read', async () => {
    const answer = await fetchOf('/extension/manifest.json');
    expect(answer).toMatchObject({ type: 'fetched' });
    const read = readManifest(JSON.parse((answer as { body: string }).body));
    expect(read).toMatchObject({ ok: true, manifest: { name: 'Stand-in gauges', kind: 'source' } });
  });

  it('answers a refusal, or a manifest past 64 KiB, by its code alone', async () => {
    expect(await fetchOf('/hooks/404')).toEqual({ type: 'failed', code: 'manifest_refused' });
    expect(await fetchOf('/extension/too-large.json')).toEqual({
      type: 'failed',
      code: 'manifest_too_large',
    });
  });

  it('follows no redirect', async () => {
    expect(await fetchOf('/hooks/302')).toEqual({ type: 'failed', code: 'connection_failed' });
  });
});
