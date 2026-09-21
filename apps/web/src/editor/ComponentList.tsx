import type { ComponentList as Page, createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ListLayout } from '../layouts/ListLayout.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { whenChanged } from './changed.js';
import styles from './ComponentList.module.css';
import { NewComponent } from './NewComponent.js';

type Client = ReturnType<typeof createApiClient>;

export interface ComponentListProps {
  readonly client: Client;
  /** The reader, so their own changes say You. */
  readonly principalId?: string;
}

type Item = Page['items'][number];
type SpaceCount = Page['spaces'][number];

/**
 * The components the signed-in person may read, in layout A: the spaces to filter by, each with how
 * many it holds, then a row per component, a page at a time. Signed out, there is nothing to list,
 * and the header band offers the way in.
 */
export function ComponentList({ client, principalId }: ComponentListProps) {
  const [items, setItems] = useState<readonly Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [spaces, setSpaces] = useState<readonly SpaceCount[]>([]);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  // undefined: nothing has failed. Otherwise the cursor whose page did not arrive (null for the
  // first), so "Try again" retries exactly that page rather than starting over.
  const [failed, setFailed] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  // A second click before the first request settles must send nothing: checked synchronously, before
  // any await, so it catches a click that lands before React has re-rendered the button disabled.
  const pending = useRef(false);
  // Each first page asked for, counted, so an answer to a filter since changed is dropped.
  const asking = useRef(0);

  const load = useCallback(
    async (cursor: string | null) => {
      if (cursor !== null && pending.current) return;
      pending.current = true;
      const generation = cursor === null ? ++asking.current : asking.current;
      setLoading(true);
      try {
        const query = {
          ...(cursor === null ? {} : { cursor }),
          ...(chosen.length === 0 ? {} : { spaces: chosen.join(',') }),
        };
        const { data } = await client.GET('/v1/components', { params: { query } });
        if (generation !== asking.current) return;
        if (!data) {
          setFailed(cursor);
          return;
        }
        setFailed(undefined);
        setItems((held) => [...(cursor === null ? [] : (held ?? [])), ...data.items]);
        setNext(data.next);
        setTotal(data.total);
        setSpaces(data.spaces);
      } catch {
        if (generation === asking.current) setFailed(cursor);
      } finally {
        if (generation === asking.current) {
          pending.current = false;
          setLoading(false);
        }
      }
    },
    [client, chosen],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  if (items === null) {
    if (failed === undefined) return null;
    return (
      <section aria-labelledby="components-heading">
        <h1 id="components-heading">Components</h1>
        <Notice tone="failed">
          <p>The components could not be loaded.</p>
          <button type="button" disabled={loading} onClick={() => void load(failed)}>
            Try again
          </button>
        </Notice>
      </section>
    );
  }

  const toggle = (id: string) =>
    setChosen((held) => (held.includes(id) ? held.filter((one) => one !== id) : [...held, id]));
  const named = spaces.filter((space) => chosen.includes(space.id)).map((space) => space.name);

  const filter = (
    <>
      <div className={styles['filterHead']}>
        <span className={styles['overline']}>Filter</span>
        {chosen.length > 0 && (
          <button type="button" className={styles['clear']} onClick={() => setChosen([])}>
            Clear
          </button>
        )}
      </div>
      <fieldset className={styles['facet']}>
        <legend className={styles['overline']}>Space</legend>
        {spaces.map((space) => (
          <label key={space.id} className={styles['option']}>
            <input
              type="checkbox"
              checked={chosen.includes(space.id)}
              onChange={() => toggle(space.id)}
            />
            <span className={styles['optionName']}>{space.name}</span>
            <span className={styles['count']}>{space.count}</span>
          </label>
        ))}
      </fieldset>
    </>
  );

  return (
    <ListLayout filter={filter}>
      <section aria-labelledby="components-heading">
        <h1 id="components-heading">Components</h1>
        {/* Inside the loaded section, not above the whole list (S27): this component returns null
            while the list itself is still loading or has failed, and a form above all of that would
            only ever appear once the listing had already resolved anyway. */}
        <NewComponent
          client={client}
          onCreated={(id) => {
            window.location.hash = `#/components/${id}`;
          }}
        />
        <p className={styles['summary']}>
          {`${total} components you may read. Showing 1 to ${items.length}.`}
          {named.length > 0 && (
            <span className={styles['scope']}>{`Space: ${named.join(', ')}`}</span>
          )}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>There are no components you may read.</p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Type</th>
                  <th scope="col">Space</th>
                  <th scope="col">Version</th>
                  <th scope="col">Language</th>
                  <th scope="col">Changed</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a className={styles['title']} href={`#/components/${item.id}`}>
                        {item.title}
                      </a>
                    </td>
                    <td className={styles['muted']}>{item.type ?? ''}</td>
                    <td className={styles['muted']}>{item.space.name}</td>
                    <td>{item.version}</td>
                    <td className={styles['code']}>{item.language}</td>
                    <td className={styles['muted']}>
                      <time dateTime={item.changedAt}>{whenChanged(item.changedAt)}</time>
                    </td>
                    <td className={styles['muted']}>
                      {item.changedBy === null
                        ? ''
                        : item.changedBy.id === principalId
                          ? 'You'
                          : (item.changedBy.name ?? '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {failed !== undefined ? (
          <Notice tone="failed">
            <p>The components could not be loaded.</p>
            <button type="button" disabled={loading} onClick={() => void load(failed)}>
              Try again
            </button>
          </Notice>
        ) : (
          next !== null && (
            <div className={styles['more']}>
              <button type="button" disabled={loading} onClick={() => void load(next)}>
                Show more
              </button>
            </div>
          )
        )}
      </section>
    </ListLayout>
  );
}
