import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { refusal, TokenTable, type ShownToken } from '../account/TokenTable.js';
import { AccessPanel } from '../access/AccessPanel.js';
import { permissionName, type AccessAt } from '../access/describe.js';
import { administersAt } from '../access/ManageAccessLink.js';
import { everyPage } from '../paging.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { Groups } from './Groups.js';
import { SpaceDialog, type SpaceAct, type SpaceRow } from './SpaceDialogs.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * The sections the service can answer, in the menu's groups (ADR-0049, decision 2), each at
 * `#/admin/<slug>`. Component types and layouts are drawn and wait: no route lists layouts, and
 * component types are listed a space at a time.
 */
const SECTIONS = [
  { slug: 'overview', title: 'Overview', group: 'Environment' },
  { slug: 'spaces', title: 'Spaces', group: 'Environment' },
  { slug: 'people', title: 'People', group: 'People and access' },
  { slug: 'groups', title: 'Groups', group: 'People and access' },
  { slug: 'roles', title: 'Roles', group: 'People and access' },
  { slug: 'about', title: 'About and release notes', group: 'System' },
] as const;
type Section = (typeof SECTIONS)[number]['slug'];
const GROUPS = ['Environment', 'People and access', 'System'] as const;

/** The section an address names: Overview for `#/admin` and for anything it does not know. */
export function sectionOf(hash: string): Section {
  const slug = /^#\/admin\/([a-z]+)$/.exec(hash)?.[1];
  return SECTIONS.find((each) => each.slug === slug)?.slug ?? 'overview';
}

/** The section the address names, followed as it changes. */
function useSection(): Section {
  const [section, setSection] = useState(() => sectionOf(window.location.hash));
  useEffect(() => {
    const follow = () => setSection(sectionOf(window.location.hash));
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return section;
}

/**
 * How many each section holds, for the menu (AD-A): a listing's `total`, or the rows of one that is a
 * page already; nothing where the reader may not see it, or it could not be read.
 */
function useCounts(client: Client): Partial<Record<Section, number>> {
  const [counts, setCounts] = useState<Partial<Record<Section, number>>>({});
  useEffect(() => {
    let current = true;
    const count = (section: Section, read: () => Promise<number | undefined>) => {
      read()
        .then((found) => {
          if (current && found !== undefined) setCounts((was) => ({ ...was, [section]: found }));
        })
        .catch(() => undefined);
    };
    count('spaces', async () => {
      const read = await everyPage((cursor) =>
        client.GET('/v1/spaces', {
          params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
        }),
      );
      return 'items' in read ? read.items.length : undefined;
    });
    count('people', async () => {
      const { data } = await client.GET('/v1/principals', {
        params: { query: { level: 'tenant', limit: '1' } },
      });
      return data?.total;
    });
    count('groups', async () => {
      const { data } = await client.GET('/v1/groups', { params: { query: { limit: '1' } } });
      return data?.total;
    });
    count('roles', async () => {
      const read = await everyPage((cursor) =>
        client.GET('/v1/roles', {
          params: { query: { level: 'tenant', ...(cursor ? { cursor } : {}) } },
        }),
      );
      return 'items' in read ? read.items.length : undefined;
    });
    return () => {
      current = false;
    };
  }, [client]);
  return counts;
}

/** The access page's sentence, for the same refusal. */
const NOT_YOURS = 'You may not manage access here.';

/** What a section read: its rows, refused, or failed; null while it is being read. */
type Read<T> = { readonly rows: readonly T[] } | 'refused' | 'failed' | null;

/**
 * Reads a listing to its end, answering 403 as refused and anything else that fails as failed. A new
 * `generation` reads it again, keeping what was shown until the new read answers.
 */
function useListing<T>(
  load: () => Promise<{ readonly items: T[] } | { readonly status: number }>,
  active: boolean,
  generation = 0,
): Read<T> {
  const [read, setRead] = useState<Read<T>>(null);
  const [readAt, setReadAt] = useState(-1);
  useEffect(() => {
    if (!active || (read !== null && readAt === generation)) return undefined;
    let current = true;
    load()
      .then((answer) => {
        if (!current) return;
        setReadAt(generation);
        if ('items' in answer) setRead({ rows: answer.items });
        else setRead(answer.status === 403 ? 'refused' : 'failed');
      })
      .catch(() => {
        if (!current) return;
        setReadAt(generation);
        setRead('failed');
      });
    return () => {
      current = false;
    };
  }, [active, load, read, readAt, generation]);
  return read;
}

function Shown<T>({
  read,
  failed,
  children,
}: {
  read: Read<T>;
  failed: string;
  children: (rows: readonly T[]) => React.ReactNode;
}) {
  if (read === null) return <Waiting>Loading...</Waiting>;
  if (read === 'refused') {
    return (
      <Notice tone="refused">
        <p>{NOT_YOURS}</p>
      </Notice>
    );
  }
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>{failed}</p>
      </Notice>
    );
  }
  return <>{children(read.rows)}</>;
}

interface PersonRow {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly kind: string;
  readonly invited: boolean;
}
interface InvitationRow {
  readonly id: string;
  readonly email: string;
  readonly expiresAt: string | null;
  readonly lapsed: boolean;
}
interface RoleRow {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

const nameOf = (person: PersonRow) => person.name ?? person.email ?? 'Somebody';

/**
 * One person's API tokens, for an administrator: each revoked after asking, which is how a departed
 * person's tokens go without waiting for each to expire (service-foundations.md, TK-E).
 */
function PersonTokens({
  client,
  person,
  onBack,
}: {
  client: Client;
  person: PersonRow;
  onBack: () => void;
}) {
  const [load] = useState(
    () => () =>
      everyPage<ShownToken>((cursor) =>
        client.GET('/v1/principals/{id}/tokens', {
          params: { path: { id: person.id }, query: cursor ? { cursor } : {} },
        }),
      ),
  );
  const read = useListing<ShownToken>(load, true);
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState('');
  const name = nameOf(person);
  const heading = useRef<HTMLHeadingElement>(null);

  // The Tokens button, which had focus, has gone with the people: focus comes here, inside the dialog,
  // rather than falling to the page, where Escape would not close Administration.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const revoke = async (token: ShownToken) => {
    const gone = () => setRevoked((was) => new Set(was).add(token.id));
    try {
      const { response, error } = await client.DELETE('/v1/principals/{id}/tokens/{token}', {
        params: { path: { id: person.id, token: token.id } },
      });
      if (response.ok) {
        gone();
        setStatus(`Revoked ${token.name}.`);
      } else if (response.status === 404) {
        gone();
        setStatus(`${token.name} had already been revoked.`);
      } else {
        setStatus(refusal(error, `${token.name} could not be revoked.`));
      }
    } catch {
      setStatus(`${token.name} could not be revoked.`);
    }
  };

  return (
    <>
      <button type="button" onClick={onBack}>
        Back to people
      </button>
      <h2 ref={heading} tabIndex={-1}>{`Tokens of ${name}`}</h2>
      <Shown read={read} failed="The tokens could not be loaded.">
        {(rows) => (
          <TokenTable
            label={`Tokens of ${name}`}
            tokens={rows.filter((token) => !revoked.has(token.id))}
            empty={
              <Empty>
                <p>{`${name} has no API tokens.`}</p>
              </Empty>
            }
            onRevoke={revoke}
          />
        )}
      </Shown>
      <p role="status">{status}</p>
    </>
  );
}

/**
 * Access at a space or the environment, in place of the section that opened it (access.md, GP-E): the
 * Access panel at that level, with a way back that takes focus as the button that opened it goes.
 */
function AccessHere({
  client,
  at,
  back,
  onBack,
}: {
  client: Client;
  at: AccessAt;
  back: string;
  onBack: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // The Access button, which had focus, has gone with the section: focus comes here, inside the
  // dialog, rather than falling to the page, where Escape would not close Administration.
  useEffect(() => {
    button.current?.focus();
  }, []);
  return (
    <>
      <button ref={button} type="button" onClick={onBack}>
        {back}
      </button>
      <AccessPanel at={at} client={client} headingLevel={2} />
    </>
  );
}

/**
 * Administration, a page at `#/admin/<section>` opened by Admin on the rail (ADR-0049): a grouped
 * menu, each entry with its count, and the section it names - the environment, its spaces, its people
 * and invitations, its groups, its roles and what this is - each read when it is first shown, each
 * saying for itself where the reader may not see it, and Access at the environment and at each space.
 */
export function Administration({
  client,
  about,
}: {
  client: Client;
  /** What About holds beside the version: the scaffolding's environment panel, for now. */
  about: React.ReactNode;
}) {
  const shown = useSection();
  const counts = useCounts(client);
  const title = SECTIONS.find((each) => each.slug === shown)!;
  const [tokensOf, setTokensOf] = useState<PersonRow | null>(null);
  /** The space, or the environment, whose Access is open in place of its section. */
  const [accessAt, setAccessAt] = useState<AccessAt | null>(null);
  /**
   * Whose tokens, or which space's or the environment's Access, was last left by its way back, so
   * focus goes back to the button that opened it.
   */
  const [leftFrom, setLeftFrom] = useState<string | null>(null);
  const backTo = useRef<HTMLButtonElement>(null);
  const sectionHeading = useRef<HTMLHeadingElement>(null);
  const [environment, setEnvironment] = useState<string | null>(null);
  /**
   * Whether the reader may administer the environment, and each space listed, by target: Access is
   * offered only where the service says so, as `ManageAccessLink` offers an artifact's, so nobody is
   * offered a panel that would only refuse them. Each is asked once, and kept, so coming back from
   * Access finds its button already there to take focus.
   */
  const [administers, setAdministers] = useState<ReadonlyMap<string, boolean>>(new Map());
  const askedAdminister = useRef(new Set<string>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const askAdminister = useCallback(
    (target: string) => {
      if (askedAdminister.current.has(target)) return;
      askedAdminister.current.add(target);
      void administersAt(client, target).then((answer) => {
        if (live.current) setAdministers((was) => new Map(was).set(target, answer));
      });
    },
    [client],
  );

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/tenant')
      .then(({ data }) => {
        if (current && data) setEnvironment(data.name);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  const [loads] = useState(() => ({
    spaces: () =>
      everyPage((cursor) =>
        client.GET('/v1/spaces', {
          params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
        }),
      ),
    people: () =>
      everyPage<PersonRow>((cursor) =>
        client.GET('/v1/principals', {
          params: { query: { level: 'tenant', ...(cursor ? { cursor } : {}) } },
        }),
      ),
    invitations: () =>
      everyPage<InvitationRow>((cursor) =>
        client.GET('/v1/invitations', { params: { query: cursor ? { cursor } : {} } }),
      ),
    roles: () =>
      everyPage<RoleRow>((cursor) =>
        client.GET('/v1/roles', {
          params: { query: { level: 'tenant', ...(cursor ? { cursor } : {}) } },
        }),
      ),
  }));
  // Read again after each change to a space, in place, so the button a dialog was opened from is
  // still there to take focus back.
  const [spacesRead, setSpacesRead] = useState(0);
  const [spaceAct, setSpaceAct] = useState<SpaceAct | null>(null);
  const [spaceSaid, setSpaceSaid] = useState('');
  const spaces = useListing<SpaceRow>(loads.spaces, shown === 'spaces', spacesRead);
  const people = useListing<PersonRow>(loads.people, shown === 'people');
  const invitations = useListing<InvitationRow>(loads.invitations, shown === 'people');
  const roles = useListing<RoleRow>(loads.roles, shown === 'roles');

  useEffect(() => {
    // Spaces are made, renamed and archived by an administrator of the environment (SP-A).
    if (shown === 'overview' || shown === 'spaces') askAdminister('tenant');
  }, [shown, askAdminister]);
  const mayChangeSpaces = administers.get('tenant') === true;
  useEffect(() => {
    if (spaces === null || typeof spaces !== 'object') return;
    for (const space of spaces.rows) askAdminister(`space:${space.id}`);
  }, [spaces, askAdminister]);

  // Back to people, spaces or the environment takes itself away: focus goes to the button it was
  // reached from, or to the section's heading where that is not shown, and never falls out of the
  // dialog.
  useEffect(() => {
    if (tokensOf !== null || accessAt !== null || leftFrom === null) return;
    (backTo.current ?? sectionHeading.current)?.focus();
  }, [tokensOf, accessAt, leftFrom]);

  useEffect(() => {
    setTokensOf(null);
    setAccessAt(null);
    setLeftFrom(null);
  }, [shown]);

  const leaveAccess = () => {
    if (accessAt === null) return;
    setLeftFrom(accessAt.kind === 'space' ? accessAt.id : 'tenant');
    setAccessAt(null);
  };

  return (
    <section className={styles['administration']} aria-label="Administration">
      <nav className={styles['menu']} aria-label="Sections of Administration">
        <p className={styles['menuTitle']}>Administration</p>
        {environment !== null && <p className={styles['environment']}>{environment}</p>}
        {GROUPS.map((group) => (
          <div key={group} className={styles['menuGroup']}>
            <p className={styles['menuGroupName']} id={`admin-group-${group.replace(/ /g, '-')}`}>
              {group}
            </p>
            <ul aria-labelledby={`admin-group-${group.replace(/ /g, '-')}`}>
              {SECTIONS.filter((each) => each.group === group).map((section) => (
                <li key={section.slug}>
                  <a
                    href={`#/admin/${section.slug}`}
                    className={styles['section']}
                    aria-current={shown === section.slug ? 'page' : undefined}
                  >
                    <span>{section.title}</span>
                    {counts[section.slug] !== undefined && (
                      <span className={styles['count']}>{counts[section.slug]}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className={styles['shown']}>
        <nav aria-label="Breadcrumb" className={styles['trail']}>
          <a href="#/admin/overview">Administration</a>
          <span>{` / ${title.group}`}</span>
        </nav>
        <h1 ref={sectionHeading} tabIndex={-1}>
          {title.title}
        </h1>
        {(shown === 'overview' || shown === 'spaces') && accessAt !== null && (
          <AccessHere
            key={accessAt.kind === 'space' ? accessAt.id : 'tenant'}
            client={client}
            at={accessAt}
            back={shown === 'spaces' ? 'Back to spaces' : 'Back to the environment'}
            onBack={leaveAccess}
          />
        )}
        {shown === 'overview' && accessAt === null && (
          <>
            <dl>
              <dt>Name</dt>
              <dd>{environment ?? ''}</dd>
              <dt>Address</dt>
              <dd>{window.location.host}</dd>
            </dl>
            {administers.get('tenant') === true && (
              <p>
                <button
                  ref={leftFrom === 'tenant' ? backTo : undefined}
                  type="button"
                  aria-label="Access to the whole environment"
                  onClick={() => setAccessAt({ kind: 'tenant' })}
                >
                  Access
                </button>
              </p>
            )}
          </>
        )}
        {shown === 'spaces' && accessAt === null && (
          <>
            {mayChangeSpaces && (
              <p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setSpaceAct({ kind: 'new' })}
                >
                  New space
                </button>
              </p>
            )}
            <Shown read={spaces} failed="The spaces could not be loaded.">
              {(rows) => (
                <table aria-label="Spaces">
                  <tbody>
                    {rows.map((space) => (
                      <tr key={space.id}>
                        <td>{space.name}</td>
                        <td className={styles['muted']}>
                          {space.archived
                            ? 'Archived'
                            : space.mayCreate
                              ? 'You may create here'
                              : ''}
                        </td>
                        <td className={styles['act']}>
                          {mayChangeSpaces && (
                            <>
                              <button
                                type="button"
                                aria-label={`Rename ${space.name}`}
                                onClick={() => setSpaceAct({ kind: 'rename', space })}
                              >
                                Rename
                              </button>{' '}
                              <button
                                type="button"
                                aria-label={`${space.archived ? 'Restore' : 'Archive'} ${space.name}`}
                                onClick={() =>
                                  setSpaceAct({
                                    kind: space.archived ? 'restore' : 'archive',
                                    space,
                                  })
                                }
                              >
                                {space.archived ? 'Restore' : 'Archive'}
                              </button>{' '}
                            </>
                          )}
                          {administers.get(`space:${space.id}`) === true && (
                            <button
                              ref={space.id === leftFrom ? backTo : undefined}
                              type="button"
                              aria-label={`Access to the space ${space.name}`}
                              onClick={() =>
                                setAccessAt({ kind: 'space', id: space.id, name: space.name })
                              }
                            >
                              Access
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Shown>
            <p role="status">{spaceSaid}</p>
            {spaceAct !== null && (
              <SpaceDialog
                client={client}
                act={spaceAct}
                onClose={() => setSpaceAct(null)}
                onDone={(said) => {
                  setSpaceAct(null);
                  setSpaceSaid(said);
                  setSpacesRead((count) => count + 1);
                }}
              />
            )}
          </>
        )}
        {shown === 'people' && tokensOf !== null && (
          <PersonTokens
            client={client}
            person={tokensOf}
            onBack={() => {
              setLeftFrom(tokensOf.id);
              setTokensOf(null);
            }}
          />
        )}
        {shown === 'people' && tokensOf === null && (
          <>
            <Shown read={people} failed="The people could not be loaded.">
              {(rows) => (
                <table aria-label="People">
                  <tbody>
                    {rows.map((person) => (
                      <tr key={person.id}>
                        <td>{nameOf(person)}</td>
                        <td className={styles['muted']}>
                          {[
                            person.name !== null ? person.email : null,
                            person.kind === 'external' ? 'from outside the organisation' : null,
                            person.invited ? 'invited and not signed in yet' : null,
                          ]
                            .filter((each) => each !== null)
                            .join(', ')}
                        </td>
                        <td className={styles['act']}>
                          {!person.invited && (
                            <button
                              ref={person.id === leftFrom ? backTo : undefined}
                              type="button"
                              aria-label={`Tokens of ${nameOf(person)}`}
                              onClick={() => setTokensOf(person)}
                            >
                              Tokens
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Shown>
            <h2>Waiting invitations</h2>
            <Shown read={invitations} failed="Invitations could not be loaded.">
              {(rows) => {
                const waiting = rows.filter((invitation) => !invitation.lapsed);
                return waiting.length === 0 ? (
                  <Empty>
                    <p>Nobody is waiting to accept an invitation.</p>
                  </Empty>
                ) : (
                  <table aria-label="Waiting invitations">
                    <tbody>
                      {waiting.map((invitation) => (
                        <tr key={invitation.id}>
                          <td>{invitation.email}</td>
                          <td className={styles['muted']}>
                            {invitation.expiresAt === null
                              ? 'Waiting'
                              : `Waiting until ${day(invitation.expiresAt)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              }}
            </Shown>
          </>
        )}
        {shown === 'groups' && <Groups client={client} />}
        {shown === 'roles' && (
          <Shown read={roles} failed="The roles could not be loaded.">
            {(rows) => (
              <table aria-label="Roles">
                <tbody>
                  {rows.map((role) => (
                    <tr key={role.id}>
                      <td className={styles['strong']}>{role.name}</td>
                      <td className={styles['muted']}>
                        {role.permissions.map(permissionName).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Shown>
        )}
        {shown === 'about' && (
          <>
            <p>{`Version ${__APP_VERSION__}`}</p>
            {about}
          </>
        )}
        <p className={styles['foot']}>
          Changes here take effect for everybody in this environment.
        </p>
      </div>
    </section>
  );
}
