import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

const URL = 'https://gauges.example.test/manifest.json';

/** An invented extension's manifest, as its host answers it. */
const manifest = (over: Record<string, unknown> = {}) => ({
  manifest: 1,
  name: 'Gauge readings',
  version: '1.2.0',
  publisher: 'Invented Instruments',
  description: 'River gauge readings by site.',
  kind: 'source',
  endpoint: 'https://gauges.example.test/alloy',
  settings: [{ key: 'region', label: 'Region', type: 'text', required: true }],
  authentication: { label: 'API key' },
  capabilities: { parameters: true, keyColumns: false, rowLimit: true },
  outbound: [{ host: 'gauges.example.test', purpose: 'The readings asked for' }],
  ...over,
});

interface Preview {
  digest: string;
  manifest: Record<string, unknown>;
  changes?: string[];
}

describe('extensions installed through the API (the EX plan, EX-B to EX-E)', () => {
  let h: Harness;
  let served: unknown = manifest();

  beforeAll(async () => {
    h = await startHarness();
    h.connector.manifestFor = () => ({ type: 'fetched', body: JSON.stringify(served) });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const preview = () => h.call('ada', 'POST', '/v1/extensions/preview', { url: URL });

  it('API-030 installs a source type from its manifest, read first, with no change to the product', async () => {
    served = manifest();
    const read = await preview();
    expect(read.statusCode, read.body).toBe(200);
    const { digest, manifest: shown } = read.json<Preview>();
    expect(shown).toEqual(manifest());
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(h.connector.asked.at(-1)).toMatchObject({ path: '/v1/manifest', body: { url: URL } });
    const made = await h.call('ada', 'POST', '/v1/extensions', { url: URL, digest });
    expect(made.statusCode, made.body).toBe(200);
    expect(made.json()).toMatchObject({ digest, manifest: manifest(), removedAt: null });
    const listed = await h.call('ada', 'GET', '/v1/extensions');
    expect(
      listed.json<{ items: { digest: string }[] }>().items.map((each) => each.digest),
    ).toContain(digest);
  });

  it('refuses to install a manifest changed since its preview, and one that is not a manifest, saying where and never what', async () => {
    served = manifest();
    const { digest } = (await preview()).json<Preview>();
    served = manifest({ version: '1.3.0' });
    const changed = await h.call('ada', 'POST', '/v1/extensions', { url: URL, digest });
    expect(changed.statusCode).toBe(409);
    expect(changed.json<{ code: string }>().code).toBe('manifest_changed');
    served = { ...manifest(), internalSecret: 'hunter2' };
    const invalid = await preview();
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json<{ code: string }>().code).toBe('manifest_invalid');
    expect(invalid.body).not.toContain('internalSecret');
    expect(invalid.body).not.toContain('hunter2');
  });

  it('API-048 says what an update changes before it is made, and removes an extension nothing uses', async () => {
    served = manifest({ name: 'Second gauges' });
    const { digest } = (await preview()).json<Preview>();
    const id = (await h.call('ada', 'POST', '/v1/extensions', { url: URL, digest })).json<{
      id: string;
    }>().id;
    served = manifest({
      name: 'Second gauges',
      endpoint: 'https://gauges.example.test/v2',
      capabilities: { parameters: false, keyColumns: false, rowLimit: true },
    });
    const next = await h.call('ada', 'POST', `/v1/extensions/${id}/preview`);
    expect(next.json<Preview>().changes).toEqual(['endpoint', 'capabilities']);
    const updated = await h.call('ada', 'POST', `/v1/extensions/${id}/update`, {
      digest: next.json<Preview>().digest,
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({
      manifest: { endpoint: 'https://gauges.example.test/v2' },
    });
    expect((await h.call('ada', 'GET', `/v1/extensions/${id}/uses`)).json()).toEqual({ items: [] });
    expect((await h.call('ada', 'DELETE', `/v1/extensions/${id}`)).statusCode).toBe(200);
    expect((await h.call('ada', 'POST', `/v1/extensions/${id}/preview`)).statusCode).toBe(409);
  });

  it('lets only an administrator with a session manage extensions', async () => {
    expect((await h.call('grace', 'GET', '/v1/extensions')).statusCode).toBe(403);
    const own = await h.call('ada', 'POST', '/v1/tokens', {
      name: 'Administering',
      scopes: ['administer'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(
      (await h.bearer(own.json<{ secret: string }>().secret, 'GET', '/v1/extensions')).statusCode,
    ).toBe(403);
  });
});
