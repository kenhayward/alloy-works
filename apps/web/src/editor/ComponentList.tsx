import type { ComponentList as Page, createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useState } from 'react';

type Client = ReturnType<typeof createApiClient>;

export interface ComponentListProps {
  readonly client: Client;
}

type Item = Page['items'][number];

/**
 * The components the signed-in person may read, a page at a time, each a link that opens it. Signed
 * out, there is nothing to list, and the environment panel beside it offers the way in.
 */
export function ComponentList({ client }: ComponentListProps) {
  const [items, setItems] = useState<readonly Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      const { data } = await client.GET('/v1/components', {
        params: { query: cursor === null ? {} : { cursor } },
      });
      if (!data) return;
      setItems((held) => [...(cursor === null ? [] : (held ?? [])), ...data.items]);
      setNext(data.next);
    },
    [client],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  if (items === null) return null;
  return (
    <section aria-labelledby="components-heading">
      <h2 id="components-heading">Components</h2>
      {items.length === 0 ? (
        <p>There are no components you may read.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <a href={`#/components/${item.id}`}>{item.title}</a> - version {item.version} in{' '}
              {item.space.name}
            </li>
          ))}
        </ul>
      )}
      {next !== null && (
        <button type="button" onClick={() => void load(next)}>
          Show more
        </button>
      )}
    </section>
  );
}
