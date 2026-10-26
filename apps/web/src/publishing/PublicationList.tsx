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
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;
type Item = Listing['items'][number];

const SORTS: readonly SortOption[] = [
  {
    sort: 'published',
    order: 'desc',
    get label() {
      return words('publishing.newest-published-first');
    },
  },
  {
    sort: 'published',
    order: 'asc',
    get label() {
      return words('publishing.oldest-published-first');
    },
  },
  {
    sort: 'title',
    order: 'asc',
    get label() {
      return words('publishing.title-a-to-z');
    },
  },
  {
    sort: 'title',
    order: 'desc',
    get label() {
      return words('publishing.title-z-to-a');
    },
  },
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
        <h1 id="publications-heading">{words('publishing.publications')}</h1>
        {listing.signedOut ? (
          <Notice tone="signedOut">
            <p>{words('publishing.you-are-signed-out-sign')}</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>{words('publishing.the-publications-could-not-be')}</p>
            <button
              type="button"
              disabled={listing.loading}
              onClick={() => void listing.load(null)}
            >
              {words('publishing.try-again')}
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
        <span className={styles['overline']}>{words('publishing.filter')}</span>
        {filtered && (
          <button
            type="button"
            className={styles['clear']}
            onClick={() => {
              setDocuments([]);
              setSpaces([]);
            }}
          >
            {words('publishing.clear')}
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
          <h1 id="publications-heading">{words('publishing.publications')}</h1>
        </div>
        <SortChooser options={SORTS} chosen={sort} onChoose={setSort} />
        <p className={styles['summary']}>
          <span>
            {filtered
              ? words('publishing.the-filter', {
                  total,
                  value2: total,
                })
              : words('publishing.you-may-read', {
                  total,
                  value2: total,
                })}
          </span>
          {items.length < total && (
            <span>{words('publishing.showing-1-to', { length: items.length })}</span>
          )}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>
              {filtered
                ? words('publishing.no-publication-you-may-read')
                : words('publishing.nothing-has-been-published-that')}
            </p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{words('publishing.title')}</th>
                  <th scope="col">{words('publishing.version-3')}</th>
                  <th scope="col">{words('publishing.formats')}</th>
                  <th scope="col">{words('publishing.published')}</th>
                  <th scope="col">{words('publishing.by')}</th>
                  <th scope="col">{words('publishing.approval')}</th>
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
                      <Lozenge kind="notApproved">{words('publishing.not-approved')}</Lozenge>
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
