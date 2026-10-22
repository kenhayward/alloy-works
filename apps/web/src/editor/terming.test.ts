import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TermIndexes, TERMS_HELD_MOST, useTermIndex } from './terming.js';

/** A page of `count` approved terms, each numbered from `from`. */
const page = (from: number, count: number, next: string | null) => ({
  items: Array.from({ length: count }, (_, at) => ({
    id: `term-${from + at}`,
    label: `Term ${from + at}`,
    abbreviation: null,
    term: { labels: [{ preferred: `Term ${from + at}`, alternatives: [] }] },
    state: { key: 'approved', approved: true },
  })),
  next,
});

/** A client answering the terms listing alone, counting what it is asked. */
function client(answer: (cursor: string | undefined) => unknown) {
  const asked: string[] = [];
  const fake = {
    GET: (path: string, options: { params: { query: { cursor?: string } } }) => {
      asked.push(path);
      return Promise.resolve({ data: answer(options.params.query.cursor) });
    },
  };
  return { asked, client: fake as never };
}

describe("a space's term index (the TM plan, TMc)", () => {
  it('is read once a space for every editor of a document', async () => {
    const { asked, client: fake } = client(() => page(0, 2, null));
    const indexes = new TermIndexes();
    const first = renderHook(() => useTermIndex(fake, 's1', null, indexes));
    const second = renderHook(() => useTermIndex(fake, 's1', null, indexes));
    await waitFor(() => expect(first.result.current.terms).toHaveLength(2));
    await waitFor(() => expect(second.result.current.terms).toHaveLength(2));
    expect(asked).toHaveLength(1);
    expect(first.result.current.truncated).toBe(false);
  });

  it('says it was cut short where the space holds more than are held', async () => {
    const { client: fake } = client((cursor) => {
      const from = cursor === undefined ? 0 : Number(cursor);
      return page(from, 100, String(from + 100));
    });
    const { result } = renderHook(() => useTermIndex(fake, 's1', null, new TermIndexes()));
    await waitFor(() => expect(result.current.terms).toHaveLength(TERMS_HELD_MOST));
    expect(result.current.truncated).toBe(true);
  });
});
