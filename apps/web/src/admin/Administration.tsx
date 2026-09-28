import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useRef, useState } from 'react';

import { refusal, TokenTable, type ShownToken } from '../account/TokenTable.js';
import { AccessPanel } from '../access/AccessPanel.js';
import { permissionName, type AccessAt } from '../access/describe.js';
import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { Groups } from './Groups.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * The sections the service can answer. Component types and layouts are drawn and wait: no route lists
 * layouts, and component types are listed a space at a time.
 */
const SECTIONS = [
  'Environment',
  'Spaces',
  'People and invitations',
  'Roles',
  'Groups',
  'About',
] as const;
type Section = (typeof SECTIONS)[number];

/** The access page's sentence, for the same refusal. */
const NOT_YOURS = 'You may not manage access here.';

/** What a section read: its rows, refused, or failed; null while it is being read. */
type Read<T> = { readonly rows: readonly T[] } | 'refused' | 'failed' | null;

/** Reads a listing to its end, answering 403 as refused and anything else that fails as failed. */
function useListing<T>(
  load: () => Promise<{ readonly items: T[] } | { readonly status: number }>,
  active: boolean,
): Read<T> {
  const [read, setRead] = useState<Read<T>>(null);
  useEffect(() => {
    if (!active || read !== null) return undefined;
    let current = true;
    load()
      .then((answer) => {
        if (!current) return;
        if ('items' in answer) setRead({ rows: answer.items });
        else setRead(answer.status === 403 ? 'refused' : 'failed');
      })
      .catch(() => {
        if (current) setRead('failed');
      });
    return () => {
      current = false;
    };
  }, [active, load, read]);
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

interface SpaceRow {
  readonly id: string;
  readonly name: string;
  readonly mayCreate: boolean;
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
      <h4 ref={heading} tabIndex={-1}>{`Tokens of ${name}`}</h4>
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
      <AccessPanel at={at} client={client} />
    </>
  );
}

/**
 * Administration, from the account chip: a modal over the page that asked for it, never a route
 * (docs/interface/README.md). The environment, its spaces, its people and invitations, its roles, its
 * groups and what this is - each read when its section is first shown, each saying for itself where
 * the reader may not see it - and Access at the environment and at each space.
 */
export function Administration({
  client,
  about,
  onClose,
}: {
  client: Client;
  /** What About holds beside the version: the scaffolding's environment panel, for now. */
  about: React.ReactNode;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<Section>('Environment');
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
  const spaces = useListing<SpaceRow>(loads.spaces, shown === 'Spaces');
  const people = useListing<PersonRow>(loads.people, shown === 'People and invitations');
  const invitations = useListing<InvitationRow>(
    loads.invitations,
    shown === 'People and invitations',
  );
  const roles = useListing<RoleRow>(loads.roles, shown === 'Roles');

  // Back to people, spaces or the environment takes itself away: focus goes to the button it was
  // reached from, or to the section's heading where that is not shown, and never falls out of the
  // dialog.
  useEffect(() => {
    if (tokensOf !== null || accessAt !== null || leftFrom === null) return;
    (backTo.current ?? sectionHeading.current)?.focus();
  }, [tokensOf, accessAt, leftFrom]);

  const leaveAccess = () => {
    if (accessAt === null) return;
    setLeftFrom(accessAt.kind === 'space' ? accessAt.id : 'tenant');
    setAccessAt(null);
  };

  return (
    <Modal labelledBy="administration-heading" onClose={onClose}>
      <div className={styles['administration']}>
        <div className={styles['head']}>
          <h2 id="administration-heading">Administration</h2>
          {environment !== null && <span className={styles['environment']}>{environment}</span>}
        </div>
        <nav className={styles['sections']} aria-label="Sections">
          {SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              className={styles['section']}
              aria-current={shown === section ? 'true' : undefined}
              onClick={() => {
                setShown(section);
                setTokensOf(null);
                setAccessAt(null);
                setLeftFrom(null);
              }}
            >
              {section}
            </button>
          ))}
        </nav>
        <div className={styles['shown']}>
          <h3 ref={sectionHeading} tabIndex={-1}>
            {shown}
          </h3>
          {(shown === 'Environment' || shown === 'Spaces') && accessAt !== null && (
            <AccessHere
              key={accessAt.kind === 'space' ? accessAt.id : 'tenant'}
              client={client}
              at={accessAt}
              back={shown === 'Spaces' ? 'Back to spaces' : 'Back to the environment'}
              onBack={leaveAccess}
            />
          )}
          {shown === 'Environment' && accessAt === null && (
            <>
              <dl>
                <dt>Name</dt>
                <dd>{environment ?? ''}</dd>
                <dt>Address</dt>
                <dd>{window.location.host}</dd>
              </dl>
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
            </>
          )}
          {shown === 'Spaces' && accessAt === null && (
            <Shown read={spaces} failed="The spaces could not be loaded.">
              {(rows) => (
                <table aria-label="Spaces">
                  <tbody>
                    {rows.map((space) => (
                      <tr key={space.id}>
                        <td>{space.name}</td>
                        <td className={styles['muted']}>
                          {space.mayCreate ? 'You may create here' : ''}
                        </td>
                        <td className={styles['act']}>
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Shown>
          )}
          {shown === 'People and invitations' && tokensOf !== null && (
            <PersonTokens
              client={client}
              person={tokensOf}
              onBack={() => {
                setLeftFrom(tokensOf.id);
                setTokensOf(null);
              }}
            />
          )}
          {shown === 'People and invitations' && tokensOf === null && (
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
              <h4>Waiting invitations</h4>
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
          {shown === 'Groups' && <Groups client={client} />}
          {shown === 'Roles' && (
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
          {shown === 'About' && (
            <>
              <p>{`Version ${__APP_VERSION__}`}</p>
              {about}
            </>
          )}
        </div>
        <p className={styles['foot']}>
          Changes here take effect for everybody in this environment.
        </p>
      </div>
    </Modal>
  );
}
