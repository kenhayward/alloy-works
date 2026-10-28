import { describe, expect, it } from 'vitest';

import { everyPage } from './paging.js';

describe('every page of a listing', () => {
  // A page drawn again in the person's language stops the reading its English drawing began: a cursor
  // sorted in one language is refused in another (the TE plan, TE-G).
  it('asks for no further page once its caller has gone', async () => {
    const asked: (string | undefined)[] = [];
    let going = true;
    const answer = await everyPage(
      async (cursor) => {
        asked.push(cursor);
        going = false;
        return { data: { items: [cursor ?? 'first'], next: 'second' }, response: new Response() };
      },
      () => going,
    );

    expect(asked).toEqual([undefined]);
    expect(answer).toEqual({ status: 0 });
  });
});
