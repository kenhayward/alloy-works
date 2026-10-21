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
  capabilities: { parameters: false, keyColumns: false, rowLimit: true },
  outbound: [],
  ...over,
});

interface Installed {
  id: string;
  digest: string;
}

describe('connections and definitions on an extension (the EX plan, EX-D to EX-F)', () => {
  let h: Harness;
  let served: unknown = manifest();

  beforeAll(async () => {
    h = await startHarness();
    h.connector.manifestFor = () => ({ type: 'fetched', body: JSON.stringify(served) });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const install = async (over: Record<string, unknown> = {}): Promise<Installed> => {
    served = manifest(over);
    const { digest } = (await h.call('ada', 'POST', '/v1/extensions/preview', { url: URL })).json<{
      digest: string;
    }>();
    return (await h.call('ada', 'POST', '/v1/extensions', { url: URL, digest })).json<Installed>();
  };

  const settings = (extension: Installed, over: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    name: `Gauges ${Math.random()}`,
    description: '',
    identity: { kind: 'service' },
    retired: false,
    type: 'extension',
    source: {
      extension: extension.id,
      digest: extension.digest,
      endpoint: 'https://gauges.example.test/alloy',
      authenticated: true,
      capabilities: { parameters: false, keyColumns: false, rowLimit: true },
      settings: { region: 'north' },
      ...over,
    },
  });

  const connect = (body: unknown) =>
    h.call('ada', 'POST', `/v1/spaces/${h.general}/connections`, { settings: body });

  it('DAT-054 makes a connection to a source type an extension answers for, held to its manifest', async () => {
    const extension = await install();
    const made = await connect(settings(extension));
    expect(made.statusCode, made.body).toBe(200);
    for (const [over, path] of [
      [{ endpoint: 'https://elsewhere.example.test/alloy' }, 'source.endpoint'],
      [{ settings: {} }, 'source.settings.region'],
      [{ settings: { region: 'north', colour: 'blue' } }, 'source.settings.colour'],
      [
        { capabilities: { parameters: true, keyColumns: false, rowLimit: true } },
        'source.capabilities',
      ],
      [{ digest: 'f'.repeat(64) }, 'source.digest'],
    ] as const) {
      const refused = await connect(settings(extension, over));
      expect(refused.statusCode, path).toBe(400);
      expect(
        refused.json<{ problems: { path: string }[] }>().problems.map((each) => each.path),
        path,
      ).toContain(path);
    }
  });

  it('DAT-079 refuses a definition binding parameters on an extension that declares none', async () => {
    const extension = await install({ name: 'Unparameterised gauges' });
    const connection = (await connect(settings(extension))).json<{ id: string }>().id;
    const definition = (parameters: unknown[]) => ({
      title: 'Levels',
      description: '',
      retired: false,
      schemaVersion: 1,
      connection,
      parameters,
      fetch: { kind: 'extension', request: { readings: 'latest' } },
      columns: [{ name: 'site', from: { pointer: '/site' }, type: { base: 'text' } }],
      key: [],
      order: 'multiset',
      empty: 'valid',
      limits: { rows: 100, bytes: 1_000_000, seconds: 10 },
    });
    const refused = await h.call('ada', 'POST', `/v1/spaces/${h.general}/query-definitions`, {
      definition: definition([
        { name: 'site', type: { base: 'text' }, required: true, list: false },
      ]),
    });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.body).toContain('declares no parameters');
    const made = await h.call('ada', 'POST', `/v1/spaces/${h.general}/query-definitions`, {
      definition: definition([]),
    });
    expect(made.statusCode, made.body).toBe(200);
  });

  it('API-049 removes an extension only once its connections are retired, and a retired one is refused, never stale', async () => {
    const extension = await install({ name: 'Removable gauges' });
    const connection = (await connect(settings(extension))).json<{
      id: string;
      version: { id: string };
    }>();
    const inUse = await h.call('ada', 'DELETE', `/v1/extensions/${extension.id}`);
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json<{ code: string }>().code).toBe('extension_in_use');
    expect(
      (await h.call('ada', 'GET', `/v1/extensions/${extension.id}/uses`)).json<{
        items: { connection: string; retired: boolean }[];
      }>().items,
    ).toEqual([expect.objectContaining({ connection: connection.id, retired: false })]);
    const retired = await h.call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
      openedFrom: connection.version.id,
      settings: settings(extension, {}),
    });
    expect(retired.statusCode, retired.body).toBe(200);
    const retiring = retired.json<{ version: { id: string }; settings: Record<string, unknown> }>();
    const done = await h.call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
      openedFrom: retiring.version.id,
      settings: { ...retiring.settings, retired: true },
    });
    expect(done.statusCode, done.body).toBe(200);
    expect((await h.call('ada', 'DELETE', `/v1/extensions/${extension.id}`)).statusCode).toBe(200);
    const test = await h.call('ada', 'POST', `/v1/connections/${connection.id}/test`, {});
    expect(test.statusCode).toBe(409);
    expect(test.json<{ code: string }>().code).toBe('connection_retired');
  });

  it('refuses a connection to an extension that takes no secret, for now', async () => {
    const extension = await install({ name: 'Open gauges', authentication: 'none' });
    const refused = await connect(settings(extension));
    expect(refused.statusCode).toBe(400);
  });
});
