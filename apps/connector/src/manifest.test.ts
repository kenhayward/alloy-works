import { randomUUID } from 'node:crypto';

import { readManifest, referenceCredentialContext } from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';
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

  it('LIB-032 fetches the stand-in reference extension, and asks it as a source through the guard, its key a bearer', async () => {
    const answer = await fetchOf('/reference-extension/manifest.json');
    const read = readManifest(JSON.parse((answer as { body: string }).body));
    expect(read).toMatchObject({
      ok: true,
      manifest: {
        name: 'Stand-in herbarium',
        kind: 'reference',
        reference: { search: '/search', fetch: '/records' },
      },
    });
    const manifest = (read as { manifest: { endpoint: string } }).manifest;
    const source = 'ext:0a1b2c3d-0000-4000-8000-0000000000aa' as const;
    const target = {
      endpoint: manifest.endpoint,
      search: '/search',
      fetch: '/records',
      sealed: sealSecret(
        SEALING_KEY,
        'reference-credential',
        TENANT,
        'stand-in-reference-key',
        referenceCredentialContext(source, manifest.endpoint),
      ),
    };
    const asked = supervisor.reference({
      requestId: randomUUID(),
      tenant: TENANT,
      source,
      op: 'search',
      query: 'saltbush',
      extension: target,
    });
    if (asked === 'busy') throw new Error('busy');
    expect(await asked).toMatchObject({
      type: 'found',
      results: [{ identifier: 'STAND-0001', csl: { type: 'article-journal' } }],
    });
    expect(api.seen.at(-1)).toMatchObject({
      rawPath: '/reference-extension/search?query=saltbush',
      bearer: true,
    });
    const unkeyed = supervisor.reference({
      requestId: randomUUID(),
      tenant: TENANT,
      source,
      op: 'fetch',
      identifier: 'STAND-0001',
      extension: { ...target, sealed: undefined },
    });
    if (unkeyed === 'busy') throw new Error('busy');
    // Refused without its key, as a source refusing a credential is.
    expect(await unkeyed).toMatchObject({ type: 'failed', reason: 'refused' });
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
