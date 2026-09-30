import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { administersAt } from '../access/ManageAccessLink.js';
import { whenChanged } from '../editor/changed.js';
import { ListLayout } from '../layouts/ListLayout.js';
import { Modal } from '../layouts/Modal.js';
import { Facet, More, SortChooser, toggled, type SortOption } from '../listing/Listing.js';
import { usePagedListing } from '../listing/usePagedListing.js';
import { everyPage } from '../paging.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import styles from '../structure/DocumentList.module.css';
import { connectionLink } from './links.js';
import {
  EMPTY_DRAFT,
  SettingsFields,
  draftProblem,
  settingsOf,
  type Draft,
} from './SettingsFields.js';
import { asBody, isRecord, refusalText } from './shapes.js';

type Client = ReturnType<typeof createApiClient>;

interface Item {
  readonly id: string;
  readonly name: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly retired: boolean;
  readonly version: { readonly id: string };
  readonly credentialSet: boolean;
  /**
   * The last test, the version it tested, which need not be the latest, and whether it was made with
   * the credential set now.
   */
  readonly lastTest: {
    readonly outcome: 'ok' | 'failed';
    readonly at: string;
    readonly version: string;
    readonly credentialCurrent: boolean;
  } | null;
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
  { sort: 'name', order: 'asc', label: 'Name, A to Z' },
  { sort: 'name', order: 'desc', label: 'Name, Z to A' },
  { sort: 'changed', order: 'desc', label: 'Newest changed first' },
  { sort: 'changed', order: 'asc', label: 'Oldest changed first' },
];

interface Space {
  readonly id: string;
  readonly name: string;
}

/**
 * The spaces the service says the caller may administer, where a connection is made (DA-Y): each
 * space the caller may read, asked about in turn. `null` until every answer is in.
 */
function useAdministeredSpaces(client: Client): readonly Space[] | null {
  const [spaces, setSpaces] = useState<readonly Space[] | null>(null);
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const all = await everyPage((cursor) =>
          client.GET('/v1/spaces', {
            params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
          }),
        );
        const readable = ('items' in all ? all.items : []).flatMap((item: unknown) =>
          isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'
            ? [{ id: item.id, name: item.name }]
            : [],
        );
        const allowed = await Promise.all(
          readable.map((space) => administersAt(client, `space:${space.id}`)),
        );
        if (current) setSpaces(readable.filter((_, index) => allowed[index]));
      } catch {
        if (current) setSpaces([]);
      }
    })();
    return () => {
      current = false;
    };
  }, [client]);
  return spaces;
}

/**
 * Making a connection: the space, and a PostgreSQL source's settings. Offered only where the person
 * may administer a space. Its credential is set on the connection's own page once it exists, so the
 * password never shares a form with anything that is kept.
 */
function NewConnection({
  client,
  spaces,
  onCreated,
}: {
  readonly client: Client;
  readonly spaces: readonly Space[];
  readonly onCreated: (id: string) => void;
}) {
  const [where, setWhere] = useState(spaces[0]?.id ?? '');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pending = useRef(false);

  const create = useCallback(async () => {
    if (pending.current) return;
    const problem = draftProblem(draft);
    if (problem) {
      setNotice(problem);
      return;
    }
    pending.current = true;
    setSending(true);
    setNotice(null);
    try {
      const { data, error, response } = await client.POST('/v1/spaces/{space}/connections', {
        params: { path: { space: where } },
        body: { settings: asBody(settingsOf(draft)) },
      });
      if (isRecord(data) && typeof data.id === 'string') {
        onCreated(data.id);
        return;
      }
      if (response.status === 401)
        setNotice('You are signed out. Sign in again to make a connection.');
      else if (response.status === 403 || response.status === 404) {
        setNotice('You may not make a connection in this space.');
      } else if (response.status === 400) {
        setNotice(
          refusalText(error, 'These settings were not accepted. Check them and try again.'),
        );
      } else setNotice('The connection could not be made. Try again.');
    } catch {
      setNotice('The connection could not be made. Try again.');
    } finally {
      pending.current = false;
      setSending(false);
    }
  }, [client, draft, onCreated, where]);

  return (
    <section aria-labelledby="new-connection-heading">
      <h2 id="new-connection-heading">New connection</h2>
      <p>A connection reaches one PostgreSQL database. Its password is set once it is made.</p>
      <label>
        Space
        <select value={where} onChange={(event) => setWhere(event.target.value)}>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <SettingsFields draft={draft} onChange={setDraft} />
      <button className="primary" type="button" disabled={sending} onClick={() => void create()}>
        Create
      </button>
      <p role="status">{notice}</p>
    </section>
  );
}

function asItems(items: readonly unknown[]): Item[] {
  return items.flatMap((item) =>
    isRecord(item) &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    isRecord(item.space) &&
    typeof item.space.name === 'string'
      ? [item as unknown as Item]
      : [],
  );
}

/**
 * The connections the signed-in person may read (data.md, "Routes"), in layout A: each one's name,
 * space, whether its credential is set and how its last test went, a page at a time, sorted and
 * filtered by space on the service. **New connection** is offered where the person may administer a
 * space.
 */
export function Connections({ client }: { readonly client: Client }) {
  const [sort, setSort] = useState<SortOption>(SORTS[0]!);
  const [spaces, setSpaces] = useState<readonly string[]>([]);
  const [creating, setCreating] = useState(false);
  const administered = useAdministeredSpaces(client);
  const fetchPage = useCallback(
    (cursor: string | null) =>
      client.GET('/v1/connections', {
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
  const listing = usePagedListing<unknown, Facets>(fetchPage);

  if (listing.items === null) {
    if (listing.failed === undefined) return null;
    return (
      <section aria-labelledby="connections-heading">
        <h1 id="connections-heading">Connections</h1>
        {listing.signedOut ? (
          <Notice tone="signedOut">
            <p>You are signed out. Sign in again to see your connections.</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>The connections could not be loaded.</p>
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
      <section aria-labelledby="connections-heading">
        <div className={styles['titleRow']}>
          <h1 id="connections-heading">Connections</h1>
          {administered !== null && administered.length > 0 && (
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              New connection
            </button>
          )}
        </div>
        {creating && administered !== null && (
          <Modal labelledBy="new-connection-heading" onClose={() => setCreating(false)}>
            <NewConnection
              client={client}
              spaces={administered}
              onCreated={(id) => {
                window.location.hash = connectionLink(id);
              }}
            />
          </Modal>
        )}
        <SortChooser options={SORTS} chosen={sort} onChoose={setSort} />
        <p className={styles['summary']}>
          <span>
            {spaces.length > 0
              ? `${listing.total} ${listing.total === 1 ? 'connection is' : 'connections are'} in the spaces chosen.`
              : `${listing.total} ${listing.total === 1 ? 'connection' : 'connections'} you may read.`}
          </span>
          {items.length < listing.total && <span>{`Showing 1 to ${items.length}.`}</span>}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>There are no connections you may read.</p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Space</th>
                  <th scope="col">Credential</th>
                  <th scope="col">Last test</th>
                  <th scope="col">Changed</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className={styles['title']}>
                      <a href={connectionLink(item.id)}>{item.name}</a>
                      {item.retired && <span className={styles['muted']}> Retired</span>}
                    </td>
                    <td className={styles['muted']}>{item.space.name}</td>
                    <td>{item.credentialSet ? 'Set' : 'Not set'}</td>
                    <td>
                      {item.lastTest === null
                        ? 'Not tested'
                        : item.lastTest.version !== item.version.id
                          ? 'Not tested since this version'
                          : !item.lastTest.credentialCurrent
                            ? 'Not tested since the credential was set'
                            : item.lastTest.outcome === 'ok'
                              ? 'Connected'
                              : 'Could not connect'}
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
        <More listing={listing} what="connections" />
      </section>
    </ListLayout>
  );
}
