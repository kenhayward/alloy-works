import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useState } from 'react';

import { useDefinitionPlaces } from '../data/places.js';
import { isRecord } from '../data/shapes.js';
import { whenChanged } from '../editor/changed.js';
import { ListLayout } from '../layouts/ListLayout.js';
import { Facet, More, SortChooser, toggled, type SortOption } from '../listing/Listing.js';
import { usePagedListing } from '../listing/usePagedListing.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import styles from '../structure/DocumentList.module.css';
import { LIBRARIES, NEW_PROMPT, promptLink } from './links.js';
import { PURPOSES } from './shape.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Item {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly purpose: string;
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
      return words('prompts.title-a-to-z');
    },
  },
  {
    sort: 'title',
    order: 'desc',
    get label() {
      return words('prompts.title-z-to-a');
    },
  },
  {
    sort: 'changed',
    order: 'desc',
    get label() {
      return words('prompts.newest-changed-first');
    },
  },
  {
    sort: 'changed',
    order: 'asc',
    get label() {
      return words('prompts.oldest-changed-first');
    },
  },
];

function asItems(items: readonly unknown[]): Item[] {
  return items.flatMap((item) =>
    isRecord(item) &&
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.purpose === 'string' &&
    isRecord(item.space) &&
    typeof item.space.name === 'string'
      ? [item as unknown as Item]
      : [],
  );
}

/**
 * The prompts the signed-in person may read (generation.md, "Prompts"; the G4 plan, G4-A), in layout
 * A: each one's title, space and purpose, a page at a time, sorted and filtered by space on the
 * service. **New prompt** is offered where the person may edit a space.
 */
export function Prompts({ client }: { readonly client: Client }) {
  const [sort, setSort] = useState<SortOption>(SORTS[0]!);
  const [spaces, setSpaces] = useState<readonly string[]>([]);
  const places = useDefinitionPlaces(client);
  const fetchPage = useCallback(
    (cursor: string | null) =>
      client.GET('/v1/prompts', {
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
      <section aria-labelledby="prompts-heading">
        <h1 id="prompts-heading">{words('prompts.prompts')}</h1>
        {listing.signedOut ? (
          <Notice tone="signedOut">
            <p>{words('prompts.you-are-signed-out-sign')}</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>{words('prompts.the-prompts-could-not-be')}</p>
            <button
              type="button"
              disabled={listing.loading}
              onClick={() => void listing.load(null)}
            >
              {words('prompts.try-again')}
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
        <span className={styles['overline']}>{words('prompts.filter')}</span>
        {spaces.length > 0 && (
          <button type="button" className={styles['clear']} onClick={() => setSpaces([])}>
            {words('prompts.clear')}
          </button>
        )}
      </div>
      <Facet
        legend={words('prompts.space')}
        values={listing.facets?.spaces ?? []}
        chosen={spaces}
        onToggle={(value) => setSpaces((held) => toggled(held, value))}
      />
    </>
  );

  return (
    <ListLayout filter={filter}>
      <section aria-labelledby="prompts-heading">
        <div className={styles['titleRow']}>
          <h1 id="prompts-heading">{words('prompts.prompts')}</h1>
          {places !== null && places.spaces.length > 0 && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                window.location.hash = NEW_PROMPT;
              }}
            >
              {words('prompts.new-prompt')}
            </button>
          )}
        </div>
        <p>
          <a href={LIBRARIES}>{words('prompts.prompt-libraries')}</a>
        </p>
        <SortChooser options={SORTS} chosen={sort} onChoose={setSort} />
        <p className={styles['summary']}>
          <span>
            {spaces.length > 0
              ? words('prompts.in-the-spaces-chosen', {
                  total: listing.total,
                  value2: listing.total === 1 ? 'prompt is' : 'prompts are',
                })
              : words('prompts.you-may-read', {
                  total: listing.total,
                  value2: listing.total === 1 ? 'prompt' : 'prompts',
                })}
          </span>
          {items.length < listing.total && (
            <span>{words('prompts.showing-1-to', { length: items.length })}</span>
          )}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>{words('prompts.there-are-no-prompts-you')}</p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{words('prompts.title')}</th>
                  <th scope="col">{words('prompts.space')}</th>
                  <th scope="col">{words('prompts.purpose')}</th>
                  <th scope="col">{words('prompts.changed')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className={styles['title']}>
                      <a href={promptLink(item.id)}>{item.title}</a>
                    </td>
                    <td className={styles['muted']}>{item.space.name}</td>
                    <td>{PURPOSES[item.purpose as keyof typeof PURPOSES] ?? item.purpose}</td>
                    <td className={styles['muted']}>
                      <time dateTime={item.changedAt}>{whenChanged(item.changedAt)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <More listing={listing} what="prompts" />
      </section>
    </ListLayout>
  );
}
