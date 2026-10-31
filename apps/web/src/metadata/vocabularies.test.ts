import { createApiClient } from '@alloy-works/api-client';
import { describe, expect, it, vi } from 'vitest';

import { vocabulariesFrom } from './vocabularies.js';

const REGION = 'c3d4e5f6-0000-4000-8000-0000000000a1';

const region = {
  schemaVersion: 1,
  id: REGION,
  name: 'Region',
  key: 'region',
  base: 'en',
  order: 'declared',
  values: [
    { id: 'north', labels: [{ language: 'en', text: 'North' }], descriptions: [], state: 'active' },
  ],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the vocabularies a page reads', () => {
  it('reads each vocabulary once, however many fields draw on it', async () => {
    const fetch = vi.fn(async (request: RequestInfo | URL) =>
      new URL((request as Request).url).pathname === `/v1/vocabularies/${REGION}`
        ? json(200, { version: '0.1', vocabulary: region })
        : json(404, {}),
    );
    const client = createApiClient({ baseUrl: 'http://alloy.test', fetch });
    const lookup = vocabulariesFrom(client);
    const [first, second] = await Promise.all([lookup(REGION), lookup(REGION)]);
    expect(first?.key).toBe('region');
    expect(second).toBe(first);
    // The same client, so the same page: asked again, it is not read again.
    expect(await vocabulariesFrom(client)(REGION)).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('answers nothing for one it cannot read, and reads it again when next asked', async () => {
    const fetch = vi.fn(async () => json(404, {}));
    const lookup = vocabulariesFrom(createApiClient({ baseUrl: 'http://alloy.test', fetch }));
    expect(await lookup(REGION)).toBeUndefined();
    expect(await lookup(REGION)).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
