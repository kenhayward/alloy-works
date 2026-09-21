import type { ComponentList as Page, createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import styles from './SpacePane.module.css';

type Client = ReturnType<typeof createApiClient>;
type Item = Page['items'][number];

/**
 * The components of the space the open one is in, beside the editor (layout B), the open one marked.
 * A convenience, so a read that fails leaves the space's name and nothing else: a second Try again
 * on the page would make the editor's own ambiguous.
 */
export function SpacePane({
  client,
  space,
  current,
}: {
  client: Client;
  space: { readonly id: string; readonly name: string };
  current: string;
}) {
  const [items, setItems] = useState<readonly Item[]>([]);

  useEffect(() => {
    let live = true;
    client
      .GET('/v1/components', { params: { query: { spaces: space.id, limit: '100' } } })
      .then(({ data }) => {
        if (live && data) setItems(data.items);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, space.id]);

  return (
    <nav className={styles['pane']} aria-label={space.name}>
      <p className={styles['overline']} aria-hidden="true">
        {space.name}
      </p>
      <ul className={styles['items']}>
        {items.map((item) => (
          <li key={item.id}>
            <a
              className={styles['item']}
              href={`#/components/${item.id}`}
              aria-current={item.id === current ? 'page' : undefined}
            >
              <span className={styles['title']}>{item.title}</span>
              <span className={styles['number']}>{item.version}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
