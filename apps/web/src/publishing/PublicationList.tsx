import type { PublicationList as Listing, createApiClient } from '@alloy-works/api-client';
import { useCallback, useState } from 'react';

import { whenChanged } from '../editor/changed.js';
import { ListLayout } from '../layouts/ListLayout.js';
import { Facet, More, SortChooser, toggled, type SortOption } from '../listing/Listing.js';
import { usePagedListing } from '../listing/usePagedListing.js';
import { Empty } from '../states/Empty.js';
import { Lozenge } from '../states/Lozenge.js';
import { Notice } from '../states/Notice.js';
import styles from '../structure/DocumentList.module.css';
import { formatsWords } from './formats.js';

type Client = ReturnType<typeof createApiClient>;
type Item = Listing['items'][number];

const SORTS: readonly SortOption[] = [
  { sort: 'published', order: 'desc', label: 'Newest published first' },
  { sort: 'published', order: 'asc', label: 'Oldest published first' },
  { sort: 'title', order: 'asc', label: 'Title, A to Z' },
  { sort: 'title', order: 'desc', label: 'Title, Z to A' },
];

/**
 * Every publication the signed-in person may read, of every document, newest first, in layout A: a page
 * at a time, sorted and filtered by document and by space on the service, each facet counted there
 * with the other filter in force (SCH-064).
 */
export function PublicationList({ client }: { client: Client }) {
  const [sort, setSort] = useState<SortOption>(SORTS[0]!);
  const [documents, setDocuments] = useState<readonly string[]>([]);
  const [spaces, setSpaces] = useState<readonly string[]>([]);
  const fetchPage = useCallback(
    (cursor: string | null) =>
      client.GET('/v1/publications', {
        params: {
          query: {
            sort: sort.sort as 'published',
            order: sort.order,
            ...(cursor === null ? {} : { cursor }),
            ...(documents.length === 0 ? {} : { documents: documents.join(',') }),
            ...(spaces.length === 0 ? {} : { spaces: spaces.join(',') }),
          },
        },
      }),
    [client, sort, documents, spaces],
  );
  const listing = usePagedListing<Item, Listing['facets']>(fetchPage);

  if (listing.items === null) {
    if (listing.failed === undefined) return null;
    return (
      <section aria-labelledby="publications-heading">
        <h1 id="publications-heading">Publications</h1>
        {listing.signedOut ? (
          <Notice tone="signedOut">
            <p>You are signed out. Sign in again to see your publications.</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>The publications could not be loaded.</p>
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
  const { items, total } = listing;
  const filtered = documents.length > 0 || spaces.length > 0;

  const filter = (
    <>
      <div className={styles['filterHead']}>
        <span className={styles['overline']}>Filter</span>
        {filtered && (
          <button
            type="button"
            className={styles['clear']}
            onClick={() => {
              setDocuments([]);
              setSpaces([]);
            }}
          >
            Clear
          </button>
        )}
      </div>
      <Facet
        legend="Document"
        values={listing.facets?.documents ?? []}
        chosen={documents}
        onToggle={(value) => setDocuments((held) => toggled(held, value))}
      />
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
      <section aria-labelledby="publications-heading">
        <div className={styles['titleRow']}>
          <h1 id="publications-heading">Publications</h1>
        </div>
        <SortChooser options={SORTS} chosen={sort} onChoose={setSort} />
        <p className={styles['summary']}>
          <span>
            {filtered
              ? `${total} ${total === 1 ? 'publication matches' : 'publications match'} the filter.`
              : `${total} ${total === 1 ? 'publication' : 'publications'} you may read.`}
          </span>
          {items.length < total && <span>{`Showing 1 to ${items.length}.`}</span>}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>
              {filtered
                ? 'No publication you may read matches the filter.'
                : 'Nothing has been published that you may read.'}
            </p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Version</th>
                  <th scope="col">Formats</th>
                  <th scope="col">Published</th>
                  <th scope="col">By</th>
                  <th scope="col">Approval</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a className={styles['title']} href={`#/publications/${item.id}`}>
                        {item.title}
                      </a>
                    </td>
                    <td>{item.version.number}</td>
                    <td>{formatsWords(item.formats)}</td>
                    <td className={styles['muted']}>
                      <time dateTime={item.publishedAt}>{whenChanged(item.publishedAt)}</time>
                    </td>
                    <td className={styles['muted']}>{item.publisher.displayName ?? ''}</td>
                    <td>
                      <Lozenge kind="notApproved">Not approved</Lozenge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <More listing={listing} what="publications" />
      </section>
    </ListLayout>
  );
}
