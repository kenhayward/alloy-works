import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient, sendSupportRead } from './index.js';

describe('a support read said on every request (support.md; the SA plan, SA-F)', () => {
  afterEach(() => sendSupportRead(undefined));

  it('ADM-026 sends Support-Read with the purpose once told, on every client, and stops when told', async () => {
    const seen: (string | null)[] = [];
    const fetching = vi.fn(async (input: Request) => {
      seen.push(input.headers.get('support-read'));
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://client.test', fetch: fetching });
    await client.GET('/v1/me');
    sendSupportRead('Why the outline will not save');
    await createApiClient({ baseUrl: 'http://client.test', fetch: fetching }).GET('/v1/me');
    // A header carries Latin-1 alone: anything else is said as near as it can be, never refused.
    sendSupportRead('Ada’s ticket — 🛠 the outline');
    await client.GET('/v1/me');
    sendSupportRead(undefined);
    await client.GET('/v1/me');
    expect(seen).toEqual([
      null,
      'Why the outline will not save',
      "Ada's ticket - the outline",
      null,
    ]);
  });
});
