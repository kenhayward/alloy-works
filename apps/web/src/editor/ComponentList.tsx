import type { ComponentList as Page, createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  // undefined: nothing has failed. Otherwise the cursor whose page did not arrive (null for the
  // first), so "Try again" retries exactly that page rather than starting over.
  const [failed, setFailed] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  // A second click before the first request settles must send nothing: checked synchronously, before
  // any await, so it catches a click that lands before React has re-rendered the button disabled.
  const pending = useRef(false);

  const load = useCallback(
    async (cursor: string | null) => {
      if (pending.current) return;
      pending.current = true;
      setLoading(true);
      try {
        const { data } = await client.GET('/v1/components', {
          params: { query: cursor === null ? {} : { cursor } },
        });
        if (!data) {
          setFailed(cursor);
          return;
        }
        setFailed(undefined);
        setItems((held) => [...(cursor === null ? [] : (held ?? [])), ...data.items]);
        setNext(data.next);
      } catch {
        setFailed(cursor);
      } finally {
        pending.current = false;
        setLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  if (items === null) {
    if (failed === undefined) return null;
    return (
      <section aria-labelledby="components-heading">
        <h2 id="components-heading">Components</h2>
        <p>The components could not be loaded.</p>
        <button type="button" disabled={loading} onClick={() => void load(failed)}>
          Try again
        </button>
      </section>
    );
  }
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
      {failed !== undefined ? (
        <>
          <p>The components could not be loaded.</p>
          <button type="button" disabled={loading} onClick={() => void load(failed)}>
            Try again
          </button>
        </>
      ) : (
        next !== null && (
          <button type="button" disabled={loading} onClick={() => void load(next)}>
            Show more
          </button>
        )
      )}
    </section>
  );
}
