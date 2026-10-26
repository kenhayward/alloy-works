import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useState } from 'react';

import { whenChanged } from '../editor/changed.js';
import { ListLayout } from '../layouts/ListLayout.js';
import { Facet, More, SortChooser, toggled, type SortOption } from '../listing/Listing.js';
import { usePagedListing } from '../listing/usePagedListing.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import styles from '../structure/DocumentList.module.css';
import { connectionLink, NEW_QUERY_DEFINITION, queryDefinitionLink } from './links.js';
import { useDefinitionPlaces } from './places.js';
import { isRecord } from './shapes.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Item {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  /** Its name null where the person may not read the connection. */
  readonly connection: { readonly id: string; readonly name: string | null } | null;
  readonly retired: boolean;
  readonly changedAt: string;
}

interface Facets {
  readonly spaces: readonly {
    readonly value: string;
    readonly label: string;
    readonly count: number;
  }[];
}

const SORTS: readonly SortOption[] = [
  {
    sort: 'title',
    order: 'asc',
    get label() {
      return words('data.title-a-to-z');
    },
  },
  {
    sort: 'title',
    order: 'desc',
    get label() {
      return words('data.title-z-to-a');
    },
  },
  {
    sort: 'changed',
    order: 'desc',
    get label() {
      return words('data.newest-changed-first');
    },
  },
  {
    sort: 'changed',
    order: 'asc',
    get label() {
      return words('data.oldest-changed-first');
    },
  },
];

function asItems(items: readonly unknown[]): Item[] {
  return items.flatMap((item) =>
    isRecord(item) &&
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    isRecord(item.space) &&
    typeof item.space.name === 'string' &&
    (item.connection === null ||
      (isRecord(item.connection) &&
        (item.connection.name === null || typeof item.connection.name === 'string')))
      ? [item as unknown as Item]
      : [],
  );
}

/**
 * The query definitions the signed-in person may read (data.md, "Routes"; the D2 plan, D2-U), in
 * layout A beside Connections: each one's title, space and connection, a page at a time, sorted and
 * filtered by space on the service. **New query definition** is offered where the person may edit a
 * space and use some connection (D4-J): a built query needs no `write_sql`.
 */
export function QueryDefinitions({ client }: { readonly client: Client }) {
  const [sort, setSort] = useState<SortOption>(SORTS[0]!);
  const [spaces, setSpaces] = useState<readonly string[]>([]);
  const places = useDefinitionPlaces(client);
  const fetchPage = useCallback(
    (cursor: string | null) =>
      client.GET('/v1/query-definitions', {
        params: {
          query: {
            sort: sort.sort as 'title',
            order: sort.order,
            ...(cursor === null ? {} : { cursor }),
            ...(spaces.length === 0 ? {} : { spaces: spaces.join(',') }),
          },
        },
      }),
    [client, sort, spaces],
  );
  const listing = usePagedListing<unknown, Facets>(fetchPage);

  if (listing.items === null) {
    if (listing.failed === undefined) return null;
    return (
      <section aria-labelledby="query-definitions-heading">
        <h1 id="query-definitions-heading">{words('data.query-definitions-2')}</h1>
        {listing.signedOut ? (
          <Notice tone="signedOut">
            <p>{words('data.you-are-signed-out-sign-7')}</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>{words('data.the-query-definitions-could-not')}</p>
            <button
              type="button"
              disabled={listing.loading}
              onClick={() => void listing.load(null)}
            >
              {words('data.try-again')}
            </button>
          </Notice>
        )}
      </section>
    );
  }

  const items = asItems(listing.items);
  const filter = (
    <>
      <div className={styles['filterHead']}>
        <span className={styles['overline']}>{words('data.filter')}</span>
        {spaces.length > 0 && (
          <button type="button" className={styles['clear']} onClick={() => setSpaces([])}>
            {words('data.clear')}
          </button>
        )}
      </div>
      <Facet
        legend={words('data.space')}
        content
        values={listing.facets?.spaces ?? []}
        chosen={spaces}
        onToggle={(value) => setSpaces((held) => toggled(held, value))}
      />
    </>
  );

  return (
    <ListLayout filter={filter}>
      <section aria-labelledby="query-definitions-heading">
        <div className={styles['titleRow']}>
          <h1 id="query-definitions-heading">{words('data.query-definitions-2')}</h1>
          {places !== null && places.spaces.length > 0 && places.connections.length > 0 && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                window.location.hash = NEW_QUERY_DEFINITION;
              }}
            >
              {words('data.new-query-definition')}
            </button>
          )}
        </div>
        <SortChooser options={SORTS} chosen={sort} onChoose={setSort} />
        <p className={styles['summary']}>
          <span>
            {spaces.length > 0
              ? words('data.definitions-in-the-spaces-chosen', { total: listing.total })
              : words('data.definitions-you-may-read', { total: listing.total })}
          </span>
          {items.length < listing.total && (
            <span>{words('data.showing-1-to', { shown: items.length })}</span>
          )}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>{words('data.there-are-no-query-definitions')}</p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{words('data.title')}</th>
                  <th scope="col">{words('data.space')}</th>
                  <th scope="col">{words('data.connection')}</th>
                  <th scope="col">{words('data.changed')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className={styles['title']}>
                      <a href={queryDefinitionLink(item.id)} data-content>
                        {item.title}
                      </a>
                      {item.retired && (
                        <span className={styles['muted']}> {words('data.retired')}</span>
                      )}
                    </td>
                    <td className={styles['muted']} data-content>
                      {item.space.name}
                    </td>
                    <td>
                      {item.connection === null ? (
                        words('data.none')
                      ) : item.connection.name === null ? (
                        words('data.a-connection-you-may-not')
                      ) : (
                        <a href={connectionLink(item.connection.id)} data-content>
                          {item.connection.name}
                        </a>
                      )}
                    </td>
                    <td className={styles['muted']}>
                      <time dateTime={item.changedAt}>{whenChanged(item.changedAt)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <More listing={listing} failed={words('data.more-definitions-failed')} />
      </section>
    </ListLayout>
  );
}
