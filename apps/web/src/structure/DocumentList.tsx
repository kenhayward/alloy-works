import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useState } from 'react';

import { whenChanged } from '../editor/changed.js';
import { ListLayout } from '../layouts/ListLayout.js';
import { Modal } from '../layouts/Modal.js';
import { useCreatableSpaces } from '../spaces.js';
import { Empty } from '../states/Empty.js';
import {
  Facet,
  More,
  SortChooser,
  toggled,
  type FacetValue,
  type SortOption,
} from '../listing/Listing.js';
import { usePagedListing } from '../listing/usePagedListing.js';
import { Lozenge } from '../states/Lozenge.js';
import { Notice } from '../states/Notice.js';
import styles from './DocumentList.module.css';
import { documentLink } from './links.js';
import { NewDocument } from './NewDocument.js';

type Client = ReturnType<typeof createApiClient>;

type Publishing = 'published' | 'changedSince' | 'neverPublished';

const PUBLISHING: readonly { readonly state: Publishing; readonly label: string }[] = [
  { state: 'published', label: 'Published' },
  { state: 'changedSince', label: 'Changed since' },
  { state: 'neverPublished', label: 'Never published' },
];

interface Listed {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: string;
  /** The columns the listing gained in interface slice 7; absent from an older service's answer. */
  readonly changedAt: string | null;
  readonly sections: number | null;
  readonly components: number | null;
  readonly publishing: Publishing | null;
}

const isPublishing = (value: unknown): value is Publishing =>
  PUBLISHING.some((each) => each.state === value);

/**
 * The listing, checked rather than trusted: the client's bodies are `any`. `undefined` is a body that
 * is not a listing at all; an entry missing a member it needs is left out rather than shown half-read.
 * The columns added later are read when they are there and left blank when they are not.
 */
function documentsIn(data: unknown): Listed[] | undefined {
  if (typeof data !== 'object' || data === null || !('items' in data)) return undefined;
  const items = (data as { items: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  return items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, title, space, version, changedAt, sections, components, publishing } =
      item as Record<string, unknown>;
    const { id: spaceId, name } =
      typeof space === 'object' && space !== null
        ? (space as { id?: unknown; name?: unknown })
        : {};
    if (
      typeof id !== 'string' ||
      typeof title !== 'string' ||
      typeof version !== 'string' ||
      typeof name !== 'string'
    ) {
      return [];
    }
    return [
      {
        id,
        title,
        space: { id: typeof spaceId === 'string' ? spaceId : name, name },
        version,
        changedAt: typeof changedAt === 'string' ? changedAt : null,
        sections: typeof sections === 'number' ? sections : null,
        components: typeof components === 'number' ? components : null,
        publishing: isPublishing(publishing) ? publishing : null,
      },
    ];
  });
}

export interface DocumentListProps {
  readonly client: Client;
  /** Called with a document's id to open it: a new one, once it is made. */
  readonly onOpen: (id: string) => void;
}

const SORTS: readonly SortOption[] = [
  { sort: 'title', order: 'asc', label: 'Title, A to Z' },
  { sort: 'title', order: 'desc', label: 'Title, Z to A' },
  { sort: 'changed', order: 'desc', label: 'Newest changed first' },
  { sort: 'changed', order: 'asc', label: 'Oldest changed first' },
];

interface Facets {
  readonly spaces: readonly FacetValue[];
  readonly publishing: readonly FacetValue[];
}

const NO_FACETS: Facets = { spaces: [], publishing: [] };

/** A facet as the service counted it, where the answer carries one. */
const facetIn = (data: unknown, name: keyof Facets): readonly FacetValue[] => {
  const facets = (data as { facets?: Record<string, unknown> } | undefined)?.facets;
  const values = facets?.[name];
  return Array.isArray(values)
    ? values.filter(
        (each): each is FacetValue =>
          typeof each === 'object' &&
          each !== null &&
          typeof (each as FacetValue).value === 'string' &&
          typeof (each as FacetValue).label === 'string' &&
          typeof (each as FacetValue).count === 'number',
      )
    : [];
};

/**
 * The documents the signed-in person may read, in layout A, with **New document** as the page's one
 * primary button: a page at a time, sorted and filtered by space and by publishing state on the
 * service, each facet counted there with the other filter in force (SCH-064).
 */
export function DocumentList({ client, onOpen }: DocumentListProps) {
  const [sort, setSort] = useState<SortOption>(SORTS[0]!);
  const [spaces, setSpaces] = useState<readonly string[]>([]);
  const [states, setStates] = useState<readonly Publishing[]>([]);
  const [creating, setCreating] = useState(false);
  const creatable = useCreatableSpaces(client);
  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const { data, response } = await client.GET('/v1/documents', {
        params: {
          query: {
            sort: sort.sort as 'title',
            order: sort.order,
            ...(cursor === null ? {} : { cursor }),
            ...(spaces.length === 0 ? {} : { spaces: spaces.join(',') }),
            ...(states.length === 0 ? {} : { publishing: states.join(',') }),
          },
        },
      });
      // Checked rather than trusted, row by row, as the listing always was.
      const items = documentsIn(data);
      if (items === undefined) return { response };
      const next = (data as { next?: unknown }).next;
      const total = (data as { total?: unknown }).total;
      return {
        response,
        data: {
          items,
          next: typeof next === 'string' ? next : null,
          total: typeof total === 'number' ? total : items.length,
          facets: { spaces: facetIn(data, 'spaces'), publishing: facetIn(data, 'publishing') },
        },
      };
    },
    [client, sort, spaces, states],
  );
  const listing = usePagedListing<Listed, Facets>(fetchPage);

  if (listing.items === null) {
    if (listing.failed === undefined) return null;
    return (
      <section aria-labelledby="documents-heading">
        <h1 id="documents-heading">Documents</h1>
        {listing.signedOut ? (
          <Notice tone="signedOut">
            <p>You are signed out. Sign in again to see your documents.</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>The documents could not be loaded.</p>
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
  const facets = listing.facets ?? NO_FACETS;
  const filtered = spaces.length > 0 || states.length > 0;
  // Offered only to somebody with somewhere to create, as the components list does; a read that
  // failed still offers it, so the form can say what went wrong.
  const mayCreate = creatable.problem !== null || (creatable.spaces ?? []).length > 0;
  // Every publishing state offered, counted where the service counted it and at none where not.
  const publishing = PUBLISHING.map(({ state }) => ({
    value: state,
    label: state,
    count: facets.publishing.find((each) => each.value === state)?.count ?? 0,
  }));

  const filter = (
    <>
      <div className={styles['filterHead']}>
        <span className={styles['overline']}>Filter</span>
        {filtered && (
          <button
            type="button"
            className={styles['clear']}
            onClick={() => {
              setSpaces([]);
              setStates([]);
            }}
          >
            Clear
          </button>
        )}
      </div>
      <Facet
        legend="Space"
        values={facets.spaces}
        chosen={spaces}
        onToggle={(value) => setSpaces((held) => toggled(held, value))}
      />
      <Facet
        legend="Publishing"
        values={publishing}
        chosen={states}
        labelOf={(value) =>
          PUBLISHING.find((each) => each.state === value.value)?.label ?? value.label
        }
        onToggle={(value) => setStates((held) => toggled(held, value as Publishing))}
      />
    </>
  );

  return (
    <ListLayout filter={filter}>
      <section aria-labelledby="documents-heading">
        <div className={styles['titleRow']}>
          <h1 id="documents-heading">Documents</h1>
          {mayCreate && (
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              New document
            </button>
          )}
        </div>
        {creating && (
          <Modal labelledBy="new-document-heading" onClose={() => setCreating(false)}>
            <NewDocument client={client} onCreated={onOpen} />
          </Modal>
        )}
        <SortChooser options={SORTS} chosen={sort} onChoose={setSort} />
        <p className={styles['summary']}>
          <span>
            {filtered
              ? `${total} ${total === 1 ? 'document matches' : 'documents match'} the filter.`
              : `${total} ${total === 1 ? 'document' : 'documents'} you may read.`}
          </span>
          {items.length < total && <span>{`Showing 1 to ${items.length}.`}</span>}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>
              {filtered
                ? 'No document you may read matches the filter.'
                : 'There are no documents you may read.'}
            </p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Space</th>
                  <th scope="col">Version</th>
                  <th scope="col" className={styles['number']}>
                    Sections
                  </th>
                  <th scope="col" className={styles['number']}>
                    Components
                  </th>
                  <th scope="col">Publishing</th>
                  <th scope="col">Changed</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <a className={styles['title']} href={documentLink(item.id)}>
                        {item.title}
                      </a>
                    </td>
                    <td className={styles['muted']}>{item.space.name}</td>
                    <td>{item.version}</td>
                    <td className={styles['number']}>{item.sections ?? ''}</td>
                    <td className={styles['number']}>{item.components ?? ''}</td>
                    <td>
                      {item.publishing !== null && (
                        <Lozenge kind={item.publishing}>
                          {PUBLISHING.find((each) => each.state === item.publishing)?.label}
                        </Lozenge>
                      )}
                    </td>
                    <td className={styles['muted']}>
                      {item.changedAt !== null && (
                        <time dateTime={item.changedAt}>{whenChanged(item.changedAt)}</time>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <More listing={listing} what="documents" />
      </section>
    </ListLayout>
  );
}
