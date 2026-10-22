import { beforeAll, describe, expect, it } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';

/**
 * A reference extension over the whole system (the XR plan, XR-J): the `sources` profile's stand-in
 * reference extension installed from its manifest, its key set, joined to the reference sources and
 * searched through the connector, then switched off and removed. `source-http` sits on the stack's
 * private network, so the stack runs with `CONNECTOR_REFERENCE_PRIVATE` `allow`, as it does
 * `CONNECTOR_WEBHOOK_PRIVATE`. Every key and value is invented.
 */

type Json = Record<string, unknown>;

const MANIFEST = 'https://source-http/reference-extension/manifest.json';

describe('a reference extension over the whole system', () => {
  let cookie = '';
  let general = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const ok = (answer: { status: number; body: Json }) => {
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body;
  };

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn('ada');
    const spaces = await call('GET', '/v1/spaces');
    general = (spaces.body['items'] as { id: string; name: string }[]).find(
      (space) => space.name === 'General',
    )!.id;
  }, 180_000);

  it('LIB-032 installs the stand-in reference extension, sets its key, lists it among the sources and searches it through the connector', async () => {
    const preview = ok(await call('POST', '/v1/extensions/preview', { url: MANIFEST }));
    expect(preview['manifest']).toMatchObject({
      kind: 'reference',
      reference: { search: '/search', fetch: '/records' },
    });
    const extension = ok(
      await call('POST', '/v1/extensions', { url: MANIFEST, digest: preview['digest'] }),
    )['id'] as string;
    const key = `ext:${extension}`;
    const set = ok(
      await call('PUT', `/v1/extensions/${extension}/secret`, { secret: 'stand-in-reference-key' }),
    );
    expect(set['secretSet']).toBe(true);
    expect(JSON.stringify(set)).not.toContain('stand-in-reference-key');

    const sources = ok(await call('GET', '/v1/reference-sources'))['items'] as Json[];
    expect(sources).toContainEqual({
      id: key,
      name: 'Stand-in herbarium',
      host: 'source-http',
      identifier: 'Identifier',
      enabled: true,
    });

    const searched = await call('POST', `/v1/reference-sources/${encodeURIComponent(key)}/search`, {
      space: `space:${general}`,
      terms: 'saltbush',
    });
    expect(searched.status, JSON.stringify(searched.body)).toBe(200);
    expect(searched.body['results']).toEqual([
      expect.objectContaining({
        identifier: 'STAND-0001',
        csl: expect.objectContaining({ title: 'Saltbush specimens of the eastern plains' }),
      }),
    ]);

    // Removed only once it is switched off.
    const refused = await call('DELETE', `/v1/extensions/${extension}`);
    expect(refused.status).toBe(409);
    expect(refused.body['code']).toBe('extension_in_use');
    ok(await call('PUT', '/v1/reference-sources', { source: key, enabled: false }));
    ok(await call('DELETE', `/v1/extensions/${extension}`));
    const after = ok(await call('GET', '/v1/reference-sources'))['items'] as Json[];
    expect(after.map((each) => each['id'])).not.toContain(key);
  });
});
