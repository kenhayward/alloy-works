import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { whenChanged } from '../editor/changed.js';
import { ListLayout } from '../layouts/ListLayout.js';
import { Modal } from '../layouts/Modal.js';
import { useCreatableSpaces } from '../spaces.js';
import { Empty } from '../states/Empty.js';
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

/** One facet's option: a checkbox, its label and how many of the listed documents it holds. */
function Option({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className={styles['option']}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className={styles['optionName']}>{label}</span>
      <span className={styles['count']}>{count}</span>
    </label>
  );
}

const toggled = <T,>(held: readonly T[], value: T): readonly T[] =>
  held.includes(value) ? held.filter((one) => one !== value) : [...held, value];

/**
 * The documents the signed-in person may read, in layout A, with **New document** as the page's one
 * primary button. `GET /v1/documents` answers them all at once, with no cursor, so the filters are
 * counted and applied here, over rows the service has already filtered by what the reader may read.
 */
export function DocumentList({ client, onOpen }: DocumentListProps) {
  const [items, setItems] = useState<readonly Listed[] | null>(null);
  const [problem, setProblem] = useState<'signedOut' | 'failed' | null>(null);
  const [loading, setLoading] = useState(false);
  const [spaces, setSpaces] = useState<readonly string[]>([]);
  const [states, setStates] = useState<readonly Publishing[]>([]);
  const [creating, setCreating] = useState(false);
  const creatable = useCreatableSpaces(client);
  const request = useRef(0);

  const load = useCallback(async () => {
    const generation = ++request.current;
    setLoading(true);
    setProblem(null);
    try {
      const { data, response } = await client.GET('/v1/documents');
      if (request.current !== generation) return;
      const listed = documentsIn(data);
      if (listed === undefined) {
        setProblem(response.status === 401 ? 'signedOut' : 'failed');
        return;
      }
      setItems(listed);
    } catch {
      if (request.current === generation) setProblem('failed');
    } finally {
      if (request.current === generation) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  if (problem !== null) {
    return (
      <section aria-labelledby="documents-heading">
        <h1 id="documents-heading">Documents</h1>
        {problem === 'signedOut' ? (
          <Notice tone="signedOut">
            <p>You are signed out. Sign in again to see your documents.</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>The documents could not be loaded.</p>
            <button type="button" disabled={loading} onClick={() => void load()}>
              Try again
            </button>
          </Notice>
        )}
      </section>
    );
  }
  if (items === null) return null;

  // The spaces the listed documents are in, by name, each counted.
  const spaceCounts = [
    ...items
      .reduce((held, item) => {
        const known = held.get(item.space.id);
        held.set(item.space.id, { name: item.space.name, count: (known?.count ?? 0) + 1 });
        return held;
      }, new Map<string, { name: string; count: number }>())
      .entries(),
  ].sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const shown = items.filter(
    (item) =>
      (spaces.length === 0 || spaces.includes(item.space.id)) &&
      (states.length === 0 || (item.publishing !== null && states.includes(item.publishing))),
  );
  const filtered = spaces.length > 0 || states.length > 0;
  // Offered only to somebody with somewhere to create, as the components list does; a read that
  // failed still offers it, so the form can say what went wrong.
  const mayCreate = creatable.problem !== null || (creatable.spaces ?? []).length > 0;

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
      <fieldset className={styles['facet']}>
        <legend className={styles['overline']}>Space</legend>
        {spaceCounts.map(([id, { name, count }]) => (
          <Option
            key={id}
            label={name}
            count={count}
            checked={spaces.includes(id)}
            onChange={() => setSpaces((held) => toggled(held, id))}
          />
        ))}
      </fieldset>
      <fieldset className={styles['facet']}>
        <legend className={styles['overline']}>Publishing</legend>
        {PUBLISHING.map(({ state, label }) => (
          <Option
            key={state}
            label={label}
            count={items.filter((item) => item.publishing === state).length}
            checked={states.includes(state)}
            onChange={() => setStates((held) => toggled(held, state))}
          />
        ))}
      </fieldset>
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
        <p className={styles['summary']}>
          <span>{`${items.length} ${items.length === 1 ? 'document' : 'documents'} you may read.`}</span>
          {filtered && <span>{`Showing ${shown.length} of ${items.length}.`}</span>}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>There are no documents you may read.</p>
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
                {shown.map((item) => (
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
      </section>
    </ListLayout>
  );
}
