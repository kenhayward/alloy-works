import type { ComponentList as Page, createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ListLayout } from '../layouts/ListLayout.js';
import { DeletedList } from '../lifecycle/Deleted.js';
import {
  ArchivedFilter,
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
import { StateLozenge } from '../states/Lozenge.js';
import { Notice } from '../states/Notice.js';
import { whenChanged } from './changed.js';
import { ComponentDetail } from './ComponentDetail.js';
import { Icon } from './Icon.js';
import styles from './ComponentList.module.css';
import { NewComponent } from './NewComponent.js';
import { RowMenu } from './RowMenu.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

export interface ComponentListProps {
  readonly client: Client;
  /** The reader, so their own changes say You. */
  readonly principalId?: string;
}

type Item = Page['items'][number];
type SpaceCount = Page['spaces'][number];

const SORTS: readonly SortOption[] = [
  {
    sort: 'title',
    order: 'asc',
    get label() {
      return words('editor.title-a-to-z');
    },
  },
  {
    sort: 'title',
    order: 'desc',
    get label() {
      return words('editor.title-z-to-a');
    },
  },
  {
    sort: 'changed',
    order: 'desc',
    get label() {
      return words('editor.newest-changed-first');
    },
  },
  {
    sort: 'changed',
    order: 'asc',
    get label() {
      return words('editor.oldest-changed-first');
    },
  },
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
  // The archived alone, the one way to list them (LIF-020).
  const [archived, setArchived] = useState(false);
  // The deleted alone, listed by their own route (the DL plan, DL-H).
  const [deleted, setDeleted] = useState(false);
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
          ...(archived ? { archived: 'only' as const } : {}),
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
    [client, chosen, sort, typesChosen, archived],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const status = (
    <ArchivedFilter
      chosen={archived}
      onChoose={(chosen) => {
        setArchived(chosen);
        if (chosen) setDeleted(false);
      }}
      deleted={deleted}
      onChooseDeleted={(chosen) => {
        setDeleted(chosen);
        if (chosen) setArchived(false);
      }}
    />
  );
  if (deleted) {
    return (
      <ListLayout filter={status}>
        <DeletedList client={client} kind="component" />
      </ListLayout>
    );
  }

  if (items === null) {
    if (failed === undefined) return null;
    return (
      <section aria-labelledby="components-heading">
        <h1 id="components-heading">{words('editor.components')}</h1>
        <Notice tone="failed">
          <p>{words('editor.the-components-could-not-be')}</p>
          <button type="button" disabled={loading} onClick={() => void load(failed)}>
            {words('editor.try-again')}
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
    ...(archived
      ? [{ key: 'archived', name: words('editor.archived'), remove: () => setArchived(false) }]
      : []),
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
        <span className={styles['overline']}>{words('editor.filter')}</span>
        {(chosen.length > 0 || typesChosen.length > 0 || archived) && (
          <button
            type="button"
            className={styles['clear']}
            onClick={() => {
              setChosen([]);
              setTypesChosen([]);
              setArchived(false);
            }}
          >
            {words('editor.clear')}
          </button>
        )}
      </div>
      <fieldset className={styles['facet']}>
        <legend className={styles['overline']}>{words('editor.space')}</legend>
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
      {status}
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
          <h1 id="components-heading">{words('editor.components')}</h1>
          {/* A space's translations, by component (LOC-016; the TR plan, TR-M). */}
          <a href="#/translations">{words('editor.translations')}</a>
          {mayCreate && (
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              {words('editor.new-component')}
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
          {words('editor.you-may-read-showing-1', {
            total,
            value2: archived ? 'archived ' : '',
            value3: total === 1 ? 'component' : 'components',
            length: items.length,
          })}
        </p>
        {filters.length > 0 && (
          <ul className={styles['chosen']} aria-label={words('editor.filtered-by')}>
            {filters.map((each) => (
              <li key={each.key}>
                <Chip tone="accent">
                  {each.name}
                  <IconButton
                    label={words('editor.remove-2', { name: each.name })}
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
            <p>
              {archived
                ? words('editor.there-are-no-archived-components')
                : words('editor.there-are-no-components-you')}
            </p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{words('editor.title')}</th>
                  <th scope="col">{words('editor.type')}</th>
                  <th scope="col">{words('editor.version')}</th>
                  <th scope="col">{words('editor.state')}</th>
                  <th scope="col">{words('editor.changed')}</th>
                  <th scope="col">{words('editor.by')}</th>
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
                      {archived && <Chip>{words('editor.archived')}</Chip>}
                      <span className={styles['where']}>
                        {`${item.space.name}, ${item.language}`}
                      </span>
                    </td>
                    <td className={styles['muted']}>{item.type ?? ''}</td>
                    <td className={styles['code']}>{item.version}</td>
                    <td>
                      {item.state && <StateLozenge state={item.state} />}
                      {/* Past its review-by day (LIF-018; WF5-H). */}
                      {item.pastReview === true && (
                        <Chip tone="warn">{words('editor.past-review')}</Chip>
                      )}
                      {/* Diverged, naming its lines (LIF-046; the R16 plan, R16-E). */}
                      {(item.lines?.length ?? 0) > 0 && (
                        <Chip>{words('editor.diverged', { value1: item.lines!.join(', ') })}</Chip>
                      )}
                    </td>
                    <td className={styles['muted']}>
                      <time dateTime={item.changedAt}>{whenChanged(item.changedAt)}</time>
                    </td>
                    <td className={styles['muted']}>
                      {item.changedBy === null
                        ? ''
                        : item.changedBy.id === principalId
                          ? words('editor.you')
                          : (item.changedBy.name ?? '')}
                    </td>
                    <td className={styles['actions']}>
                      <IconButton
                        label={words('editor.show-here', { title: item.title })}
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
                        archived={archived}
                        onNotice={setNotice}
                        onArchived={() => void load(null)}
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
            <p>{words('editor.the-components-could-not-be')}</p>
            <button type="button" disabled={loading} onClick={() => void load(failed)}>
              {words('editor.try-again')}
            </button>
          </Notice>
        ) : (
          next !== null && (
            <div className={styles['more']}>
              <button type="button" disabled={loading} onClick={() => void load(next)}>
                {words('editor.show-more')}
              </button>
            </div>
          )
        )}
      </section>
    </ListLayout>
  );
}
