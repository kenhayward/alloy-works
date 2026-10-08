import type { ComponentList as Page, createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ListLayout } from '../layouts/ListLayout.js';
import {
  Facet,
  SortChooser,
  toggled,
  type FacetValue,
  type SortOption,
} from '../listing/Listing.js';
import { useCreatableSpaces } from '../spaces.js';
import { Modal } from '../layouts/Modal.js';
import { Chip } from '../parts/Chip.js';
import { IconButton } from '../parts/IconButton.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { whenChanged } from './changed.js';
import { ComponentDetail } from './ComponentDetail.js';
import { Icon } from './Icon.js';
import styles from './ComponentList.module.css';
import { NewComponent } from './NewComponent.js';
import { RowMenu } from './RowMenu.js';

type Client = ReturnType<typeof createApiClient>;

export interface ComponentListProps {
  readonly client: Client;
  /** The reader, so their own changes say You. */
  readonly principalId?: string;
}

type Item = Page['items'][number];
type SpaceCount = Page['spaces'][number];

const SORTS: readonly SortOption[] = [
  { sort: 'title', order: 'asc', label: 'Title, A to Z' },
  { sort: 'title', order: 'desc', label: 'Title, Z to A' },
  { sort: 'changed', order: 'desc', label: 'Newest changed first' },
  { sort: 'changed', order: 'asc', label: 'Oldest changed first' },
];

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
  const [sort, setSort] = useState<SortOption>(SORTS[0]!);
  const [typesChosen, setTypesChosen] = useState<readonly string[]>([]);
  const [typeFacet, setTypeFacet] = useState<readonly FacetValue[]>([]);
  const [creating, setCreating] = useState(false);
  const creatable = useCreatableSpaces(client);
  const [notice, setNotice] = useState<string | null>(null);
  // The row shown in the panel beside the list, and each row's button, to give the focus back to.
  const [shown, setShown] = useState<string | null>(null);
  const showButtons = useRef(new Map<string, HTMLButtonElement>());
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
          sort: sort.sort as 'title',
          order: sort.order,
          ...(cursor === null ? {} : { cursor }),
          ...(chosen.length === 0 ? {} : { spaces: chosen.join(',') }),
          ...(typesChosen.length === 0 ? {} : { types: typesChosen.join(',') }),
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
        setTypeFacet(data.facets?.types ?? []);
      } catch {
        if (generation === asking.current) setFailed(cursor);
      } finally {
        if (generation === asking.current) {
          pending.current = false;
          setLoading(false);
        }
      }
    },
    [client, chosen, sort, typesChosen],
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

  // New component is offered only to somebody with somewhere to create one, as the inline form used to
  // say nothing at all to them. A read that failed still offers it: the form says what went wrong and
  // offers Try again.
  const mayCreate = creatable.problem !== null || (creatable.spaces ?? []).length > 0;

  const toggle = (id: string) =>
    setChosen((held) => (held.includes(id) ? held.filter((one) => one !== id) : [...held, id]));
  // Each filter chosen, as a chip that removes it: spaces by name, then types.
  const filters = [
    ...spaces
      .filter((space) => chosen.includes(space.id))
      .map((space) => ({
        key: `space-${space.id}`,
        name: space.name,
        remove: () => toggle(space.id),
      })),
    ...typesChosen.map((type) => ({
      key: `type-${type}`,
      name: type,
      remove: () => setTypesChosen((held) => toggled(held, type)),
    })),
  ];
  const shownItem = items.find((item) => item.id === shown) ?? null;
  const closeShown = () => {
    const button = shown === null ? undefined : showButtons.current.get(shown);
    setShown(null);
    button?.focus();
  };

  const filter = (
    <>
      <div className={styles['filterHead']}>
        <span className={styles['overline']}>Filter</span>
        {(chosen.length > 0 || typesChosen.length > 0) && (
          <button
            type="button"
            className={styles['clear']}
            onClick={() => {
              setChosen([]);
              setTypesChosen([]);
            }}
          >
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
      <Facet
        legend="Type"
        values={typeFacet}
        chosen={typesChosen}
        onToggle={(value) => setTypesChosen((held) => toggled(held, value))}
      />
    </>
  );

  return (
    <ListLayout
      filter={filter}
      detail={
        shownItem === null ? null : (
          <ComponentDetail
            key={shownItem.id}
            client={client}
            item={shownItem}
            onClose={closeShown}
          />
        )
      }
    >
      <section aria-labelledby="components-heading">
        <div className={styles['titleRow']}>
          <h1 id="components-heading">Components</h1>
          {mayCreate && (
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              New component
            </button>
          )}
        </div>
        {/* Inside the loaded section, not above the whole list (S27): this component returns null
            while the list itself is still loading or has failed, and a form above all of that would
            only ever appear once the listing had already resolved anyway. A modal since interface
            slice 4, opened by the button above rather than always open. */}
        {creating && (
          <Modal labelledBy="new-component-heading" onClose={() => setCreating(false)}>
            <NewComponent
              client={client}
              onCreated={(id) => {
                window.location.hash = `#/components/${id}`;
              }}
            />
          </Modal>
        )}
        <SortChooser options={SORTS} chosen={sort} onChoose={setSort} />
        <p className={styles['summary']}>
          {`${total} ${total === 1 ? 'component' : 'components'} you may read. Showing 1 to ${items.length}.`}
        </p>
        {filters.length > 0 && (
          <ul className={styles['chosen']} aria-label="Filtered by">
            {filters.map((each) => (
              <li key={each.key}>
                <Chip tone="accent">
                  {each.name}
                  <IconButton
                    label={`Remove ${each.name}`}
                    className={styles['unchoose']}
                    onClick={each.remove}
                  >
                    <Icon name="Close" size={10} />
                  </IconButton>
                </Chip>
              </li>
            ))}
          </ul>
        )}
        <p role="status" className={styles['status']}>
          {notice}
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
                  <th scope="col">Version</th>
                  <th scope="col">Changed</th>
                  <th scope="col">By</th>
                  <td aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} data-shown={item.id === shown}>
                    <td>
                      <a className={styles['title']} href={`#/components/${item.id}`}>
                        {item.title}
                      </a>
                      <span className={styles['where']}>
                        {`${item.space.name}, ${item.language}`}
                      </span>
                    </td>
                    <td className={styles['muted']}>{item.type ?? ''}</td>
                    <td className={styles['code']}>{item.version}</td>
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
                    <td className={styles['actions']}>
                      <IconButton
                        label={`Show ${item.title} here`}
                        pressed={item.id === shown}
                        ref={(element) => {
                          if (element) showButtons.current.set(item.id, element);
                          else showButtons.current.delete(item.id);
                        }}
                        onClick={() => (item.id === shown ? closeShown() : setShown(item.id))}
                      >
                        <Icon name="Contents" size={14} />
                      </IconButton>
                      <RowMenu
                        client={client}
                        id={item.id}
                        title={item.title}
                        onNotice={setNotice}
                      />
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
