import type { TemplateList as Listing, createApiClient } from '@alloy-works/api-client';
import { useCallback, useState } from 'react';

import { whenChanged } from '../editor/changed.js';
import { ListLayout } from '../layouts/ListLayout.js';
import { Facet, More, SortChooser, toggled, type SortOption } from '../listing/Listing.js';
import { usePagedListing } from '../listing/usePagedListing.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import styles from './DocumentList.module.css';

type Client = ReturnType<typeof createApiClient>;
type Item = Listing['items'][number];

const SORTS: readonly SortOption[] = [
  { sort: 'name', order: 'asc', label: 'Name, A to Z' },
  { sort: 'name', order: 'desc', label: 'Name, Z to A' },
  { sort: 'changed', order: 'desc', label: 'Newest changed first' },
  { sort: 'changed', order: 'asc', label: 'Oldest changed first' },
];

/**
 * The templates the signed-in person may read (SCH-064), in layout A: each one's name, space, version
 * and when it last changed, a page at a time, sorted and filtered by space on the service. Making and
 * changing a template is the API's; a document is made from one on the documents list.
 */
export function TemplateList({ client }: { readonly client: Client }) {
  const [sort, setSort] = useState<SortOption>(SORTS[0]!);
  const [spaces, setSpaces] = useState<readonly string[]>([]);
  const fetchPage = useCallback(
    (cursor: string | null) =>
      client.GET('/v1/templates', {
        params: {
          query: {
            sort: sort.sort as 'name',
            order: sort.order,
            ...(cursor === null ? {} : { cursor }),
            ...(spaces.length === 0 ? {} : { spaces: spaces.join(',') }),
          },
        },
      }),
    [client, sort, spaces],
  );
  const listing = usePagedListing<Item, Listing['facets']>(fetchPage);

  if (listing.items === null) {
    if (listing.failed === undefined) return null;
    return (
      <section aria-labelledby="templates-heading">
        <h1 id="templates-heading">Templates</h1>
        {listing.signedOut ? (
          <Notice tone="signedOut">
            <p>You are signed out. Sign in again to see your templates.</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>The templates could not be loaded.</p>
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
      <section aria-labelledby="templates-heading">
        <div className={styles['titleRow']}>
          <h1 id="templates-heading">Templates</h1>
        </div>
        <SortChooser options={SORTS} chosen={sort} onChoose={setSort} />
        <p className={styles['summary']}>
          <span>
            {spaces.length > 0
              ? `${listing.total} ${listing.total === 1 ? 'template is' : 'templates are'} in the spaces chosen.`
              : `${listing.total} ${listing.total === 1 ? 'template' : 'templates'} you may read.`}
          </span>
          {listing.items.length < listing.total && (
            <span>{`Showing 1 to ${listing.items.length}.`}</span>
          )}
        </p>
        {listing.items.length === 0 ? (
          <Empty>
            <p>There are no templates you may read.</p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Space</th>
                  <th scope="col">Version</th>
                  <th scope="col">Changed</th>
                </tr>
              </thead>
              <tbody>
                {listing.items.map((item) => (
                  <tr key={item.id}>
                    {/* No page shows a template on its own yet: its name, not a link. */}
                    <td className={styles['title']}>{item.name}</td>
                    <td className={styles['muted']}>{item.space.name}</td>
                    <td>{item.version.number}</td>
                    <td className={styles['muted']}>
                      <time dateTime={item.changedAt}>{whenChanged(item.changedAt)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <More listing={listing} what="templates" />
      </section>
    </ListLayout>
  );
}
