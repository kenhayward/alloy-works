import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HOST, startHarness, type Harness } from './test/bindings-harness.js';

/** A listing sorted in the reader's language (the UI plan, UI-H): the renderer says it, as `Accept-Language`. */
describe('a listing in the reader’s language (the UI plan, UI-H)', () => {
  let h: Harness;
  let space = '';

  beforeAll(async () => {
    h = await startHarness();
    space = (await h.call('ada', 'POST', '/v1/spaces', { name: 'Collation' })).json<{
      id: string;
    }>().id;
    for (const title of ['zebra', 'بحر', 'apple']) await h.component(space, title);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const page = (language: string, cursor?: string) =>
    h.app.inject({
      method: 'GET',
      url: `/v1/components?spaces=${space}&sort=title&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
      headers: { host: HOST, cookie: h.cookies.ada!, 'accept-language': language },
    });

  const walk = async (language: string) => {
    const titles: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const answer = (await page(language, cursor)).json<{
        items: { title: string }[];
        next: string | null;
      }>();
      titles.push(...answer.items.map((item) => item.title));
      if (answer.next === null) return titles;
      cursor = answer.next;
    }
  };

  it('orders titles as the reader’s language does, and never continues one language’s page in another', async () => {
    expect(await walk('en-GB')).toEqual(['apple', 'zebra', 'بحر']);
    expect(await walk('ar-XB')).toEqual(['بحر', 'apple', 'zebra']);
    const first = (await page('en-GB')).json<{ next: string }>();
    expect((await page('ar-XB', first.next)).statusCode).toBe(400);
  });
});
