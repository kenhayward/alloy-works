import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { permissionName } from '../access/describe.js';
import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

/**
 * The sections the service can answer. Groups, component types and layouts are drawn and wait: no
 * route lists groups or layouts, and component types are listed a space at a time.
 */
const SECTIONS = ['Environment', 'Spaces', 'People and invitations', 'Roles', 'About'] as const;
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

/**
 * Administration, from the account chip: a modal over the page that asked for it, never a route
 * (docs/interface/README.md). The environment, its spaces, its people and invitations, its roles and
 * what this is - each read when its section is first shown, each saying for itself where the reader
 * may not see it.
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
    spaces: async () => {
      const { data, response } = await client.GET('/v1/spaces');
      return data ? { items: [...data.items] } : { status: response.status };
    },
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
              onClick={() => setShown(section)}
            >
              {section}
            </button>
          ))}
        </nav>
        <div className={styles['shown']}>
          <h3>{shown}</h3>
          {shown === 'Environment' && (
            <dl>
              <dt>Name</dt>
              <dd>{environment ?? ''}</dd>
              <dt>Address</dt>
              <dd>{window.location.host}</dd>
            </dl>
          )}
          {shown === 'Spaces' && (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Shown>
          )}
          {shown === 'People and invitations' && (
            <>
              <Shown read={people} failed="The people could not be loaded.">
                {(rows) => (
                  <table aria-label="People">
                    <tbody>
                      {rows.map((person) => (
                        <tr key={person.id}>
                          <td>{person.name ?? person.email ?? 'Somebody'}</td>
                          <td className={styles['muted']}>
                            {[
                              person.name !== null ? person.email : null,
                              person.kind === 'external' ? 'from outside the organisation' : null,
                              person.invited ? 'invited and not signed in yet' : null,
                            ]
                              .filter((each) => each !== null)
                              .join(', ')}
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
