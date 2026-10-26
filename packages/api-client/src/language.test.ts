import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient, sendLanguage } from './index.js';

describe('the interface language on every request (the UI plan, UI-H)', () => {
  afterEach(() => sendLanguage(undefined));

  it('says the language the interface is in as Accept-Language, so a listing sorts in it', async () => {
    const seen: (string | null)[] = [];
    const fetching = vi.fn(async (input: Request) => {
      seen.push(input.headers.get('accept-language'));
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://client.test', fetch: fetching });
    await client.GET('/v1/me');
    let language = 'ar-XB';
    sendLanguage(() => language);
    await client.GET('/v1/me');
    language = 'en-GB';
    await client.GET('/v1/me');
    expect(seen.slice(1)).toEqual(['ar-XB', 'en-GB']);
  });
});
