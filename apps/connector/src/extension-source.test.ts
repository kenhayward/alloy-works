import { randomUUID } from 'node:crypto';

import {
  credentialContext,
  defaultLimits,
  type DraftDefinition,
  type ExtensionSettings,
  type RunRequest,
  type TestRequest,
} from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { childSpawn, createSupervisor } from './supervisor.js';
import { DEV_CA, member, startFakeApi, type FakeApi } from './testing/http.js';
import { SEALING_KEY, TENANT, suiteChild, suiteDeny, suiteIsolation } from './testing/source.js';

/** The stand-in extension's key: invented. */
const KEY = 'stand-in-extension-key';

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

const settings = (
  path = '/extension',
  capabilities = { parameters: true, keyColumns: true, rowLimit: true },
): ExtensionSettings => ({
  schemaVersion: 1,
  name: 'Stand-in gauges',
  description: '',
  identity: { kind: 'service' },
  retired: false,
  type: 'extension',
  source: {
    extension: '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41',
    digest: 'a'.repeat(64),
    endpoint: `https://127.0.0.1:${api.port}${path}`,
    authenticated: true,
    capabilities,
    settings: { region: 'north' },
  },
});

const requestFor = (source: ExtensionSettings): TestRequest => {
  const connection = { id: randomUUID(), version: randomUUID() };
  return {
    requestId: randomUUID(),
    tenant: TENANT,
    connection,
    settings: source,
    sealed: sealSecret(
      SEALING_KEY,
      'source-credential',
      TENANT,
      KEY,
      credentialContext(connection.id, source),
    ),
    deadlineMs: 30_000,
  };
};

const definition = (
  parameters: DraftDefinition['parameters'] = [],
): Omit<DraftDefinition, 'connection'> => ({
  schemaVersion: 1,
  parameters,
  fetch: { kind: 'extension', request: { readings: 'latest' } },
  columns: [
    member('site', { base: 'text' }),
    member('level', { base: 'decimal', precision: 6, scale: 2 }),
  ],
  key: ['site'],
  order: 'multiset',
  empty: 'valid',
  limits: { ...defaultLimits },
});

const runOf = (
  source: ExtensionSettings,
  values: Record<string, unknown> = {},
  parameters: DraftDefinition['parameters'] = [],
): RunRequest => {
  const base = requestFor(source);
  const drafted = definition(parameters);
  return {
    ...base,
    definition: { ...drafted, connection: base.connection.id },
    values: values as RunRequest['values'],
    limits: drafted.limits,
    deadlineMs: 30_000,
  };
};

describe("an extension's source through the connector (the EX plan, EX-H and EX-I)", () => {
  it('DAT-054 runs a source no part of the product names, read as the product reads every source', async () => {
    const answer = await supervisor.run('run', runOf(settings()));
    expect(answer).toMatchObject({
      outcome: 'ok',
      rowCount: 2,
      ran: { extension: { readings: 'latest' } },
    });
    const result = (answer as { result: { rows: unknown[][] } }).result;
    expect(result.rows.map((row) => row[0]).toSorted()).toEqual(['north-bridge', 'north-weir']);
  });

  it('API-033 sends an extension only what it declares: its settings, its request, its values and its one secret', async () => {
    const parameter = {
      name: 'site',
      type: { base: 'text' },
      required: true,
      list: false,
    } as never;
    await supervisor.run('run', runOf(settings(), { site: 'north-weir' }, [parameter]));
    const seen = api.seen.filter((each) => each.rawPath === '/extension/run').at(-1)!;
    expect(JSON.parse(seen.body)).toEqual({
      settings: { region: 'north' },
      request: { readings: 'latest' },
      parameters: { site: 'north-weir' },
      limits: { rows: defaultLimits.rows },
    });
    // The secret rode as a bearer, which the fake never keeps; nothing names the tenant or a person.
    expect(Object.keys(seen.headers).toSorted()).toEqual(
      [
        'accept',
        'accept-encoding',
        'connection',
        'content-length',
        'content-type',
        'host',
      ].toSorted(),
    );
    expect(seen.body).not.toContain(TENANT);
    expect(seen.bearer).toBe(true);
    // Declaring no parameters and no row limit, it is sent neither.
    await supervisor.run(
      'run',
      runOf(settings('/extension', { parameters: false, keyColumns: false, rowLimit: false })),
    );
    const bare = api.seen.filter((each) => each.rawPath === '/extension/run').at(-1)!;
    expect(Object.keys(JSON.parse(bare.body))).toEqual(['settings', 'request']);
  });

  it("API-034 lays a failure an extension causes at the source's side, in its own codes, never the product's", async () => {
    const failed = await supervisor.run('run', runOf(settings('/extension-broken')));
    expect(failed).toMatchObject({
      outcome: 'failed',
      failure: { code: 'extension_failed', attribution: 'connector' },
    });
    const refusing = await supervisor.run('run', runOf(settings('/extension-refusing')));
    expect(refusing).toMatchObject({
      outcome: 'failed',
      failure: { code: 'extension_refused', attribution: 'connector' },
    });
    const invalid = await supervisor.run('run', runOf(settings('/extension-invalid')));
    expect(invalid).toMatchObject({
      outcome: 'failed',
      failure: { code: 'extension_invalid', attribution: 'connector' },
    });
  });

  it('DAT-105 proposes columns from a sample of an extension, each member of its first rows by its pointer', async () => {
    const described = await supervisor.run('describeSql', {
      ...requestFor(settings()),
      extension: { request: { readings: 'latest' }, parameters: [], values: {} },
    });
    expect(described).toMatchObject({
      columns: [
        { name: 'site', proposed: { base: 'text' }, pointer: '/site' },
        { name: 'level', pointer: '/level' },
      ],
    });
  });

  it('tests an extension by its own test', async () => {
    expect(await supervisor.run('test', requestFor(settings()))).toEqual({
      outcome: 'ok',
      findings: [],
    });
  });
});
