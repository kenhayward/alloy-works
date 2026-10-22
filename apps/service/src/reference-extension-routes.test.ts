import { readExtensionAnswer, type ReferenceRequest } from '@alloy-works/domain';
import {
  extensionHerbarium,
  extensionHerbariumRetracted,
} from '@alloy-works/domain/sources-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

const URL = 'https://herbarium.example.test/manifest.json';

/** An invented reference extension's manifest, as its host answers it (the XR plan, XR-J). */
const manifest = (over: Record<string, unknown> = {}) => ({
  manifest: 1,
  name: 'Herbarium records',
  version: '0.3.0',
  publisher: 'Invented Herbarium',
  description: 'Specimen papers by catalogue number.',
  kind: 'reference',
  endpoint: 'https://herbarium.example.test/alloy',
  reference: { search: '/search', fetch: '/records' },
  authentication: { label: 'Access token' },
  outbound: [{ host: 'herbarium.example.test', purpose: 'The terms searched for' }],
  ...over,
});

/** What the extension answers, read as the connector reads it. */
function answering(request: ReferenceRequest) {
  const records = [extensionHerbarium, extensionHerbariumRetracted];
  const raw =
    request.op === 'search' ? records : records.filter((each) => each.id === request.identifier);
  return { type: 'found' as const, results: readExtensionAnswer(request.op, raw) ?? [] };
}

describe('reference extensions through the API (the XR plan, XR-J)', () => {
  let h: Harness;
  let served: unknown = manifest();

  beforeAll(async () => {
    h = await startHarness();
    h.connector.manifestFor = () => ({ type: 'fetched', body: JSON.stringify(served) });
    h.connector.referenceFor = answering;
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const install = async (over: Record<string, unknown> = {}) => {
    served = manifest(over);
    const preview = await h.call('ada', 'POST', '/v1/extensions/preview', { url: URL });
    expect(preview.statusCode, preview.body).toBe(200);
    const { digest } = preview.json<{ digest: string }>();
    const made = await h.call('ada', 'POST', '/v1/extensions', { url: URL, digest });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ id: string }>().id;
  };
  const search = (as: string, source: string, terms = 'saltbush') =>
    h.call(as, 'POST', `/v1/reference-sources/${source}/search`, {
      space: `space:${h.general}`,
      terms,
    });
  const fromSource = (source: string, identifier: string) =>
    h.call('grace', 'POST', `/v1/spaces/${h.general}/bibliography-entries/from-source`, {
      source,
      identifier,
      despiteMatches: true,
    });

  it('LIB-032 installs a reference extension as any is, its secret set write-only, and joins it to the sources', async () => {
    const id = await install();
    const key = `ext:${id}`;
    const secret = await h.call('ada', 'PUT', `/v1/extensions/${id}/secret`, {
      secret: 'herbarium-token',
    });
    expect(secret.statusCode, secret.body).toBe(200);
    expect(secret.body).not.toContain('herbarium-token');
    expect(h.connector.asked.at(-1)).toMatchObject({
      path: '/v1/reference/seal',
      body: { source: key, endpoint: 'https://herbarium.example.test/alloy' },
    });
    expect(
      (await h.call('grace', 'PUT', `/v1/extensions/${id}/secret`, { secret: 'x' })).statusCode,
    ).toBe(403);
    const listed = await h.call('alice', 'GET', '/v1/reference-sources');
    expect(listed.json<{ items: unknown[] }>().items).toContainEqual({
      id: key,
      name: 'Herbarium records',
      host: 'herbarium.example.test',
      identifier: 'Identifier',
      enabled: true,
    });
    expect(listed.body).not.toContain('herbarium-token');
  });

  it('LIB-032 searches a reference extension and makes an entry from a result, obtained from it, then checks it', async () => {
    const id = await install({ name: 'Herbarium papers' });
    const key = `ext:${id}`;
    await h.call('ada', 'PUT', `/v1/extensions/${id}/secret`, { secret: 'herbarium-token' });
    const found = await search('grace', key);
    expect(found.statusCode, found.body).toBe(200);
    expect(
      found.json<{ results: { identifier: string }[] }>().results.map((each) => each.identifier),
    ).toEqual(['HERB-0042', 'HERB-0043']);
    const asked = h.connector.asked.at(-1);
    expect(asked).toMatchObject({
      path: '/v1/reference',
      body: {
        source: key,
        op: 'search',
        query: 'saltbush',
        extension: {
          endpoint: 'https://herbarium.example.test/alloy',
          search: '/search',
          fetch: '/records',
          sealed: expect.any(String),
        },
      },
    });
    expect(JSON.stringify(asked)).not.toContain('herbarium-token');

    const made = await fromSource(key, 'HERB-0043');
    expect(made.statusCode, made.body).toBe(200);
    const entry = made.json<{
      entry: { id: string; entry: { obtained: { from: string } } };
    }>().entry;
    expect(entry.entry.obtained.from).toBe(`${key}:HERB-0043`);
    const checked = await h.call('grace', 'POST', `/v1/bibliography-entries/${entry.id}/check`);
    expect(checked.statusCode, checked.body).toBe(200);
    expect(checked.json()).toMatchObject({
      source: key,
      outcome: 'retracted',
      notice: { kind: 'retraction', identifier: 'HERB-R-0001' },
    });
    expect(h.connector.asked.at(-1)?.body).toMatchObject({ op: 'check', identifier: 'HERB-0043' });
  });

  it('LIB-032 refuses removing a reference extension while it is switched on, then leaves what it obtained untouched and checks it no more', async () => {
    const id = await install({ name: 'Herbarium leaving' });
    const key = `ext:${id}`;
    const made = await fromSource(key, 'HERB-0042');
    expect(made.statusCode, made.body).toBe(200);
    const entry = made.json<{ entry: { id: string } }>().entry.id;
    const refused = await h.call('ada', 'DELETE', `/v1/extensions/${id}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: 'extension_in_use',
      message: expect.stringContaining('switched on'),
    });
    const off = await h.call('ada', 'PUT', '/v1/reference-sources', {
      source: key,
      enabled: false,
    });
    expect(off.statusCode, off.body).toBe(200);
    expect((await h.call('ada', 'DELETE', `/v1/extensions/${id}`)).statusCode).toBe(200);

    const asked = h.connector.asked.length;
    expect((await h.call('grace', 'GET', `/v1/bibliography-entries/${entry}`)).statusCode).toBe(
      200,
    );
    const check = await h.call('grace', 'POST', `/v1/bibliography-entries/${entry}/check`);
    expect(check.statusCode).toBe(409);
    expect(check.json()).toMatchObject({ code: 'reference_source_off' });
    expect((await search('grace', key)).statusCode).toBe(404);
    expect(
      (await h.call('ada', 'PUT', '/v1/reference-sources', { source: key, enabled: true }))
        .statusCode,
    ).toBe(404);
    expect(h.connector.asked.length).toBe(asked);
    expect((await h.call('alice', 'GET', '/v1/reference-sources')).body).not.toContain(key);
  });

  it('never takes another record for the one asked, making nothing and checking it gone', async () => {
    const id = await install({ name: 'Herbarium astray' });
    const key = `ext:${id}`;
    const made = await fromSource(key, 'HERB-0042');
    expect(made.statusCode, made.body).toBe(200);
    const entry = made.json<{ entry: { id: string } }>().entry.id;
    // The extension answers its other record, whatever is asked.
    h.connector.referenceFor = (request) => ({
      type: 'found' as const,
      results: readExtensionAnswer(request.op, [extensionHerbariumRetracted]) ?? [],
    });
    try {
      const astray = await fromSource(key, 'HERB-0042');
      expect(astray.statusCode).toBe(422);
      expect(astray.json()).toMatchObject({ code: 'reference_missing' });
      const checked = await h.call('grace', 'POST', `/v1/bibliography-entries/${entry}/check`);
      expect(checked.statusCode, checked.body).toBe(200);
      expect(checked.json()).toMatchObject({ outcome: 'gone' });
    } finally {
      h.connector.referenceFor = answering;
    }
  });

  it('takes a secret only for a reference extension that declares one', async () => {
    const none = await install({ name: 'Open herbarium', authentication: 'none' });
    const refused = await h.call('ada', 'PUT', `/v1/extensions/${none}/secret`, { secret: 'x' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'extension_takes_no_secret' });
  });
});
