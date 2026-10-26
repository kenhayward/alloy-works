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
import { useInstalledExtensions } from './extensions.js';
import { connectionLink } from './links.js';
import {
  EMPTY_DRAFT,
  SettingsFields,
  draftProblem,
  settingsOf,
  type Draft,
} from './SettingsFields.js';
import { asBody, isRecord, refusalText } from './shapes.js';
import { words } from '../words/words.js';

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
  {
    sort: 'name',
    order: 'asc',
    get label() {
      return words('data.name-a-to-z');
    },
  },
  {
    sort: 'name',
    order: 'desc',
    get label() {
      return words('data.name-z-to-a');
    },
  },
  {
    sort: 'changed',
    order: 'desc',
    get label() {
      return words('data.newest-changed-first');
    },
  },
  {
    sort: 'changed',
    order: 'asc',
    get label() {
      return words('data.oldest-changed-first');
    },
  },
];

interface Space {
  readonly id: string;
  readonly name: string;
}

/**
 * The spaces the service says the caller may administer, where a connection is made (DA-Y): each
 * space the caller may read and that is not archived, where nothing new is made (the SP1 plan, SP-E),
 * asked about in turn. `null` until every answer is in.
 */
function useAdministeredSpaces(client: Client): readonly Space[] | null {
  const [spaces, setSpaces] = useState<readonly Space[] | null>(null);
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const all = await everyPage((cursor) =>
          client.GET('/v1/spaces', {
            params: {
              query: {
                limit: '100',
                archived: 'false',
                ...(cursor === undefined ? {} : { cursor }),
              },
            },
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
 * Making a connection: the space, and its source's settings, an extension's its manifest's. Offered only where the person
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
  // Read once an extension's connection is asked for: listing them is the environment's administrator's.
  const extensions = useInstalledExtensions(client, draft.type === 'extension');
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
      if (response.status === 401) setNotice(words('data.you-are-signed-out-sign-3'));
      else if (response.status === 403 || response.status === 404) {
        setNotice(words('data.you-may-not-make-a'));
      } else if (response.status === 400) {
        setNotice(refusalText(error, words('data.these-settings-were-not-accepted')));
      } else setNotice(words('data.the-connection-could-not-be-4'));
    } catch {
      setNotice(words('data.the-connection-could-not-be-4'));
    } finally {
      pending.current = false;
      setSending(false);
    }
  }, [client, draft, onCreated, where]);

  return (
    <section aria-labelledby="new-connection-heading">
      <h2 id="new-connection-heading">{words('data.new-connection')}</h2>
      <p>{words('data.a-connection-reaches-one-postgresql')}</p>
      <label>
        {words('data.space')}
        <select value={where} onChange={(event) => setWhere(event.target.value)}>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <SettingsFields draft={draft} onChange={setDraft} extensions={extensions} />
      <button className="primary" type="button" disabled={sending} onClick={() => void create()}>
        {words('data.create')}
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
        <h1 id="connections-heading">{words('data.connections')}</h1>
        {listing.signedOut ? (
          <Notice tone="signedOut">
            <p>{words('data.you-are-signed-out-sign-4')}</p>
          </Notice>
        ) : (
          <Notice tone="failed">
            <p>{words('data.the-connections-could-not-be')}</p>
            <button
              type="button"
              disabled={listing.loading}
              onClick={() => void listing.load(null)}
            >
              {words('data.try-again')}
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
        <span className={styles['overline']}>{words('data.filter')}</span>
        {spaces.length > 0 && (
          <button type="button" className={styles['clear']} onClick={() => setSpaces([])}>
            {words('data.clear')}
          </button>
        )}
      </div>
      <Facet
        legend={words('data.space')}
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
          <h1 id="connections-heading">{words('data.connections')}</h1>
          {administered !== null && administered.length > 0 && (
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              {words('data.new-connection')}
            </button>
          )}
        </div>
        {creating && administered !== null && (
          <Modal labelledBy="new-connection-heading" size="wide" onClose={() => setCreating(false)}>
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
              ? words('data.connections-in-the-spaces-chosen', { total: listing.total })
              : words('data.connections-you-may-read', { total: listing.total })}
          </span>
          {items.length < listing.total && (
            <span>{words('data.showing-1-to', { shown: items.length })}</span>
          )}
        </p>
        {items.length === 0 ? (
          <Empty>
            <p>{words('data.there-are-no-connections-you')}</p>
          </Empty>
        ) : (
          <div className={styles['table']}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{words('data.name')}</th>
                  <th scope="col">{words('data.space')}</th>
                  <th scope="col">{words('data.credential')}</th>
                  <th scope="col">{words('data.last-test')}</th>
                  <th scope="col">{words('data.changed')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className={styles['title']}>
                      <a href={connectionLink(item.id)} data-content>
                        {item.name}
                      </a>
                      {item.retired && (
                        <span className={styles['muted']}> {words('data.retired')}</span>
                      )}
                    </td>
                    <td className={styles['muted']} data-content>
                      {item.space.name}
                    </td>
                    <td>{item.credentialSet ? words('data.set-2') : words('data.not-set-2')}</td>
                    <td>
                      {item.lastTest === null
                        ? words('data.not-tested')
                        : item.lastTest.version !== item.version.id
                          ? words('data.not-tested-since-this-version')
                          : !item.lastTest.credentialCurrent
                            ? words('data.not-tested-since-the-credential')
                            : item.lastTest.outcome === 'ok'
                              ? words('data.connected-2')
                              : words('data.could-not-connect-2')}
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
        <More listing={listing} what={words('data.connections-what')} />
      </section>
    </ListLayout>
  );
}
