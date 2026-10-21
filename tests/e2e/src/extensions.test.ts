import { beforeAll, describe, expect, it } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';

/**
 * An extension over the whole system (the EX plan's verification): the `sources` profile's stand-in
 * extension installed from its manifest, a connection made to it and its key set, and a definition
 * over it sampled through the connector, its rows those of the region its settings name. Every key
 * and value is invented.
 */

type Json = Record<string, unknown>;

const MANIFEST = 'https://source-http/extension/manifest.json';

describe('an extension over the whole system', () => {
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

  it('DAT-054 installs an extension from its manifest and samples a source it answers for, as any source is', async () => {
    const preview = ok(await call('POST', '/v1/extensions/preview', { url: MANIFEST }));
    const manifest = preview['manifest'] as Json;
    // Installed once per stack: a second install of the same URL is answered as already there.
    const listed = ok(await call('GET', '/v1/extensions'));
    const already = (listed['items'] as { id: string; url: string }[]).find(
      (each) => each.url === MANIFEST,
    );
    const extension =
      already?.id ??
      (ok(await call('POST', '/v1/extensions', { url: MANIFEST, digest: preview['digest'] }))[
        'id'
      ] as string);

    const connection = ok(
      await call('POST', `/v1/spaces/${general}/connections`, {
        settings: {
          schemaVersion: 1,
          name: `Stand-in gauges ${Date.now()}`,
          description: 'A development extension.',
          identity: { kind: 'service' },
          retired: false,
          type: 'extension',
          source: {
            extension,
            digest: preview['digest'],
            endpoint: manifest['endpoint'],
            authenticated: true,
            capabilities: manifest['capabilities'],
            settings: { region: 'north' },
          },
        },
      }),
    )['id'] as string;
    expect(
      ok(
        await call('PUT', `/v1/connections/${connection}/credential`, {
          secret: 'stand-in-extension-key',
        }),
      ),
    ).toMatchObject({ test: { outcome: 'ok' } });

    const sampled = ok(
      await call('POST', `/v1/connections/${connection}/sample`, {
        definition: {
          schemaVersion: 1,
          connection,
          parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }],
          fetch: { kind: 'extension', request: { readings: 'latest' } },
          columns: [
            { name: 'site', from: { pointer: '/site' }, type: { base: 'text' } },
            {
              name: 'level',
              from: { pointer: '/level' },
              type: { base: 'decimal', precision: 6, scale: 2 },
            },
          ],
          key: ['site'],
          order: [{ column: 'site', direction: 'ascending' }],
          empty: 'invalid',
          limits: { rows: 100, bytes: 65_536, seconds: 20 },
        },
        values: { site: 'north-weir' },
      }),
    );
    expect(sampled, JSON.stringify(sampled)).toMatchObject({
      outcome: 'ok',
      ran: { extension: { readings: 'latest' } },
    });
    expect(sampled['rows']).toEqual([['north-weir', '2.5']]);
  });
});
