import {
  childRequestSchema,
  type ChildRequest,
  type Column,
  type RevisionAnswer,
  type RunAnswer,
  type RunRequest,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Lookup } from './guard.js';
import { exchange } from './https.js';
import { childSpawn, CONNECT_TIMEOUT_MS, createSupervisor } from './supervisor.js';
import {
  DEV_CA,
  DEV_KEY,
  get,
  httpDraft,
  httpRunRequest,
  httpSettings,
  member,
  startFakeApi,
  type FakeApi,
} from './testing/http.js';
import {
  field,
  fileDraft,
  keyOf,
  READER,
  s3RunRequest,
  s3Settings,
  SOURCES_CA,
  startFakeStore,
  type FakeAnswer,
  type FakeStore,
} from './testing/s3.js';
import {
  column,
  draft,
  LOADED_TIMEOUT_MS,
  PASSWORDS,
  runRequest,
  SEALING_KEY,
  settings,
  suiteChild,
  suiteDeny,
  suiteIsolation,
} from './testing/source.js';
import { answerRequest } from './work.js';

/**
 * A source's revision (the FR plan, FR-C and FR-D): captured at a run, and asked alone at a check by
 * `/v1/revision` - HTTP's request made conditional, S3's object asked by a `HEAD`, PostgreSQL's
 * revision statement read alone.
 */

const supervisor = createSupervisor({
  sealingKey: SEALING_KEY,
  deny: suiteDeny,
  maxChildren: 8,
  spec: childSpawn(suiteChild, suiteIsolation),
  ca: DEV_CA,
});

const ok = (answer: RunAnswer | 'busy') => {
  if (answer === 'busy' || answer.outcome !== 'ok') throw new Error(JSON.stringify(answer));
  return answer;
};

const asked = (run: RunRequest, revision: string) => ({ ...run, revision });

const readings: Column[] = [member('id', { base: 'integer' }), member('site', { base: 'text' })];

describe("an HTTP source's revision", { timeout: LOADED_TIMEOUT_MS }, () => {
  let api: FakeApi;
  beforeAll(async () => {
    api = await startFakeApi();
  });
  afterAll(async () => {
    await api.close();
  });
  const run = (path: string, over: Parameters<typeof get>[1] = {}) =>
    httpRunRequest(httpSettings(api.port), DEV_KEY, httpDraft(get([path], over), readings));

  it('DAT-073 captures a response’s ETag at a run, else its Last-Modified, else nothing', async () => {
    expect(ok(await supervisor.run('run', run('versioned'))).revision).toBe('etag:"readings-1"');
    expect(ok(await supervisor.run('run', run('modified'))).revision).toBe(
      'modified:Wed, 21 Oct 2026 07:28:00 GMT',
    );
    const plain = httpRunRequest(
      httpSettings(api.port),
      DEV_KEY,
      httpDraft(get(['readings']), readings, { format: { kind: 'json', rows: '/data/items' } }),
    );
    expect(ok(await supervisor.run('run', plain)).revision).toBeUndefined();
  });

  it('DAT-073 asks by the same request made conditional, its own header overriding the template’s, and runs nothing', async () => {
    const template = { headers: [{ name: 'if-none-match', value: { fixed: '"other"' } }] };
    const seen = api.seen.length;
    expect(
      await supervisor.run('revision', asked(run('versioned', template), 'etag:"readings-1"')),
    ).toEqual({ outcome: 'unchanged' });
    const sent = api.seen.slice(seen);
    expect(sent.map((each) => [each.method, each.rawPath])).toEqual([['GET', '/v1/versioned']]);
    expect(sent[0]!.headers['if-none-match']).toBe('"readings-1"');
    expect(sent[0]!.keyed).toBe(true);
    expect(await supervisor.run('revision', asked(run('versioned'), 'etag:"readings-0"'))).toEqual({
      outcome: 'changed',
    });
    expect(
      await supervisor.run(
        'revision',
        asked(run('modified'), 'modified:Wed, 21 Oct 2026 07:28:00 GMT'),
      ),
    ).toEqual({ outcome: 'unchanged' });
    expect(api.seen.at(-1)!.headers['if-modified-since']).toBe('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(
      await supervisor.run(
        'revision',
        asked(run('modified'), 'modified:Tue, 20 Oct 2026 07:28:00 GMT'),
      ),
    ).toEqual({ outcome: 'changed' });
  });

  it('reads a conditional exchange’s headers alone: a 304 is unchanged, and a 2xx’s body is never read', async () => {
    const policy = {
      deny: suiteDeny,
      ca: DEV_CA,
      deadline: Date.now() + 10_000,
      connectTimeoutMs: 5000,
      maxBytes: 1,
      conditional: true,
    };
    const asking = (etag: string) => ({
      host: '127.0.0.1',
      port: api.port,
      path: '/v1/versioned',
      method: 'GET' as const,
      headers: [
        ['x-api-key', DEV_KEY],
        ['if-none-match', etag],
      ] as [string, string][],
    });
    const unchanged = await exchange(asking('"readings-1"'), policy);
    expect(unchanged).toMatchObject({ ok: true, status: 304 });
    // A body past `maxBytes` refuses an ordinary exchange; a conditional one never reads it.
    const changed = await exchange(asking('"readings-0"'), policy);
    expect(changed).toMatchObject({ ok: true, status: 200 });
    expect(changed.ok && changed.body.length).toBe(0);
    expect(changed.ok && changed.headers.etag).toBe('"readings-1"');
  });
});

describe("an S3 object's revision", () => {
  let store: FakeStore;
  let next: (request: { method?: string | undefined }) => FakeAnswer;
  beforeAll(async () => {
    store = await startFakeStore((request) => next(request));
  });
  afterAll(async () => {
    await store.close();
  });
  const loopback: Lookup = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
  const answered = (kind: ChildRequest['kind'], request: ChildRequest['request']) =>
    answerRequest(
      childRequestSchema.parse({
        kind,
        request,
        secret: JSON.stringify(READER),
        deny: [...suiteDeny],
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        failureFloorMs: 0,
        ca: SOURCES_CA,
      }),
      { lookup: loopback },
    );
  const run = () =>
    s3RunRequest(
      s3Settings(store.port),
      fileDraft(keyOf('readings/2026/readings.csv'), [field('site', { base: 'text' })]),
    );
  const body = 'site\nNorth weir\n';

  it('DAT-073 captures an object’s version id at a run, else its ETag', async () => {
    next = () => ({ body, headers: { etag: '"abc"', 'x-amz-version-id': 'v2' } });
    expect(ok((await answered('run', run())) as RunAnswer).revision).toBe('version:v2');
    next = () => ({ body, headers: { etag: '"abc"' } });
    expect(ok((await answered('run', run())) as RunAnswer).revision).toBe('etag:"abc"');
  });

  it('DAT-073 asks by a signed HEAD of the object, and reads nothing of it', async () => {
    next = () => ({ body, headers: { etag: '"abc"', 'x-amz-version-id': 'v2' } });
    const seen = store.seen.length;
    expect(await answered('revision', asked(run(), 'version:v2'))).toEqual({
      outcome: 'unchanged',
    });
    const sent = store.seen.slice(seen);
    expect(sent.map((each) => each.method)).toEqual(['HEAD']);
    expect(sent[0]!.rawPath).toBe('/alloy-readings/readings/2026/readings.csv');
    expect(String(sent[0]!.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(await answered('revision', asked(run(), 'version:v1'))).toEqual({
      outcome: 'changed',
    });
    next = () => ({ body, headers: { etag: '"abc"' } });
    expect(await answered('revision', asked(run(), 'etag:"abc"'))).toEqual({
      outcome: 'unchanged',
    });
    next = () => ({ status: 404 });
    expect(
      ((await answered('revision', asked(run(), 'etag:"abc"'))) as RevisionAnswer).outcome,
    ).toBe('failed');
  });
});

describe("a PostgreSQL definition's revision statement", { timeout: LOADED_TIMEOUT_MS }, () => {
  const sites = draft('select id, name from sample.site', [
    column('id', { base: 'integer' }),
    column('name', { base: 'text' }),
  ]);
  const run = (text: string) =>
    runRequest(settings(), PASSWORDS.reader, { ...sites, revision: { text } });

  it('DAT-073 reads the revision statement before the data, one row of one column, else definition_invalid', async () => {
    const first = ok(await supervisor.run('run', run('select max(id) from sample.site')));
    expect(first.revision).toMatch(/^sha256:[0-9a-f]{64}$/);
    const again = ok(await supervisor.run('run', run('select max(id) from sample.site')));
    expect(again.revision).toBe(first.revision);
    for (const text of ['select id from sample.site', 'select 1, 2', 'select 1 where false']) {
      const answer = await supervisor.run('run', run(text));
      expect(answer !== 'busy' && answer.outcome === 'failed' && answer.failure.code, text).toBe(
        'definition_invalid',
      );
    }
    // A definition with no revision statement captures none.
    const none = runRequest(settings(), PASSWORDS.reader, sites);
    expect(ok(await supervisor.run('run', none)).revision).toBeUndefined();
  });

  it('DAT-073 asks by the revision statement alone, never running the data statement', async () => {
    const text = 'select max(id) from sample.site';
    const { revision } = ok(await supervisor.run('run', run(text)));
    // A data statement that would fail if it ran: the revision is asked without it.
    const failing = runRequest(settings(), PASSWORDS.reader, {
      ...draft('select id, 1 / 0 as name from sample.site', sites.columns),
      revision: { text },
    });
    expect(await supervisor.run('revision', asked(failing, revision!))).toEqual({
      outcome: 'unchanged',
    });
    expect(await supervisor.run('revision', asked(failing, 'sha256:' + '0'.repeat(64)))).toEqual({
      outcome: 'changed',
    });
    const invalid = await supervisor.run(
      'revision',
      asked(run('select id from sample.site'), revision!),
    );
    expect(invalid !== 'busy' && invalid.outcome === 'failed' && invalid.failure.code).toBe(
      'definition_invalid',
    );
  });
});
