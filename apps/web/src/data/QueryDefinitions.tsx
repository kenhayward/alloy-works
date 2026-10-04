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
  { sort: 'title', order: 'asc', label: 'Title, A to Z' },
  { sort: 'title', order: 'desc', label: 'Title, Z to A' },
  { sort: 'changed', order: 'desc', label: 'Newest changed first' },
  { sort: 'changed', order: 'asc', label: 'Oldest changed first' },
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
        <h1 id="query-definitions-heading">Query definitions</h1>
        {listing.signedOut ? (
          <Notice tone="signedOut">
            <p>You are signed out. Sign in again to see your query definitions.</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>The query definitions could not be loaded.</p>
            <button
              type="button"
              disabled={listing.loading}
              onClick={() => void listing.load(null)}
            >
              Try again
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
        <span className={styles['overline']}>Filter</span>
        {spaces.length > 0 && (
          <button type="button" className={styles['clear']} onClick={() => setSpaces([])}>
            Clear
          </button>
        )}
      </div>
      <Facet
        legend="Space"
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
          <h1 id="query-definitions-heading">Query definitions</h1>
          {places !== null && places.spaces.length > 0 && places.connections.length > 0 && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                window.location.hash = NEW_QUERY_DEFINITION;
              }}
            >
              New query definition
            </button>
          )}
        </div>
        <SortChooser options={SORTS} chosen={sort} onChoose={setSort} />
        <p className={styles['summary']}>
          <span>
            {spaces.length > 0
              ? `${listing.total} ${listing.total === 1 ? 'query definition is' : 'query definitions are'} in the spaces chosen.`
              : `${listing.total} ${listing.total === 1 ? 'query definition' : 'query definitions'} you may read.`}
          </span>
          {items.length < listing.total && <span>{`Showing 1 to ${items.length}.`}</span>}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>There are no query definitions you may read.</p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Space</th>
                  <th scope="col">Connection</th>
                  <th scope="col">Changed</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className={styles['title']}>
                      <a href={queryDefinitionLink(item.id)}>{item.title}</a>
                      {item.retired && <span className={styles['muted']}> Retired</span>}
                    </td>
                    <td className={styles['muted']}>{item.space.name}</td>
                    <td>
                      {item.connection === null ? (
                        'None'
                      ) : item.connection.name === null ? (
                        'A connection you may not read'
                      ) : (
                        <a href={connectionLink(item.connection.id)}>{item.connection.name}</a>
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
        <More listing={listing} what="query definitions" />
      </section>
    </ListLayout>
  );
}
