import type { TemplateList as Listing, createApiClient } from '@alloy-works/api-client';
import { useCallback, useState } from 'react';

import { ManageAccessLink } from '../access/ManageAccessLink.js';
import { whenChanged } from '../editor/changed.js';
import { ListLayout } from '../layouts/ListLayout.js';
import { Facet, More, SortChooser, toggled, type SortOption } from '../listing/Listing.js';
import { usePagedListing } from '../listing/usePagedListing.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import styles from './DocumentList.module.css';
import { GenerateDialog } from './GenerateDialog.js';
import { cohortLink, templateAccessLink } from './links.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;
type Item = Listing['items'][number];

const SORTS: readonly SortOption[] = [
  {
    sort: 'name',
    order: 'asc',
    get label() {
      return words('document.name-a-to-z');
    },
  },
  {
    sort: 'name',
    order: 'desc',
    get label() {
      return words('document.name-z-to-a');
    },
  },
  {
    sort: 'changed',
    order: 'desc',
    get label() {
      return words('document.newest-changed-first');
    },
  },
  {
    sort: 'changed',
    order: 'asc',
    get label() {
      return words('document.oldest-changed-first');
    },
  },
];

/**
 * The templates the signed-in person may read (SCH-064), in layout A: each one's name, space, version
 * and when it last changed, a page at a time, sorted and filtered by space on the service. Making and
 * changing a template is the API's; a document is made from one on the documents list. Each offers
 * Manage access to whoever may administer it, since no page shows a template on its own yet.
 */
export function TemplateList({ client }: { readonly client: Client }) {
  const [sort, setSort] = useState<SortOption>(SORTS[0]!);
  const [spaces, setSpaces] = useState<readonly string[]>([]);
  // The template documents are being generated from, in its dialog (the R7 plan, R7-B).
  const [generating, setGenerating] = useState<Item | null>(null);
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
        <h1 id="templates-heading">{words('document.templates')}</h1>
        {listing.signedOut ? (
          <Notice tone="signedOut">
            <p>{words('document.you-are-signed-out-sign-7')}</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>{words('document.the-templates-could-not-be')}</p>
            <button
              type="button"
              disabled={listing.loading}
              onClick={() => void listing.load(null)}
            >
              {words('document.try-again')}
            </button>
          </Notice>
        )}
      </section>
    );
  }

  const filter = (
    <>
      <div className={styles['filterHead']}>
        <span className={styles['overline']}>{words('document.filter')}</span>
        {spaces.length > 0 && (
          <button type="button" className={styles['clear']} onClick={() => setSpaces([])}>
            {words('document.clear')}
          </button>
        )}
      </div>
      <Facet
        legend={words('document.space')}
        content
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
          <h1 id="templates-heading">{words('document.templates')}</h1>
          <a href="#/cohorts">{words('document.cohorts')}</a>
        </div>
        <SortChooser options={SORTS} chosen={sort} onChoose={setSort} />
        <p className={styles['summary']}>
          <span>
            {spaces.length > 0
              ? words('document.in-the-spaces-chosen', {
                  total: listing.total,
                  value2: listing.total,
                })
              : words('document.templates-you-may-read', { total: listing.total })}
          </span>
          {listing.items.length < listing.total && (
            <span>{words('document.showing-1-to', { length: listing.items.length })}</span>
          )}
        </p>
        {listing.items.length === 0 ? (
          <Empty>
            <p>{words('document.there-are-no-templates-you')}</p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{words('document.name')}</th>
                  <th scope="col">{words('document.space')}</th>
                  <th scope="col">{words('document.version-2')}</th>
                  <th scope="col">{words('document.changed')}</th>
                  <th scope="col">{words('document.documents')}</th>
                </tr>
              </thead>
              <tbody>
                {listing.items.map((item) => (
                  <tr key={item.id}>
                    {/* No page shows a template on its own yet: its name, not a link, and its access. */}
                    <td className={styles['title']}>
                      {item.name}{' '}
                      <ManageAccessLink
                        client={client}
                        target={`artifact:${item.id}`}
                        href={templateAccessLink(item.id)}
                        label={words('document.manage-access-to', { name: item.name })}
                      />
                    </td>
                    <td className={styles['muted']}>{item.space.name}</td>
                    <td>{item.version.number}</td>
                    <td className={styles['muted']}>
                      <time dateTime={item.changedAt}>{whenChanged(item.changedAt)}</time>
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={words('document.generate-documents-from-2', {
                          name: item.name,
                        })}
                        onClick={() => setGenerating(item)}
                      >
                        {words('document.generate')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <More listing={listing} failed={words('document.more-templates-failed')} />
      </section>
      {generating !== null && (
        <GenerateDialog
          client={client}
          template={{ id: generating.id, name: generating.name, space: generating.space.id }}
          onGenerated={(cohort) => {
            setGenerating(null);
            window.location.hash = cohortLink(cohort);
          }}
          onCancel={() => setGenerating(null)}
        />
      )}
    </ListLayout>
  );
}
