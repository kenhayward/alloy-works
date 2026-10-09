import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AccessPanel } from '../access/AccessPanel.js';
import { permissionName, type AccessAt } from '../access/describe.js';
import { administersAt } from '../access/ManageAccessLink.js';
import { everyPage } from '../paging.js';
import styles from './Administration.module.css';
import { Groups } from './Groups.js';
import { People } from './People.js';
import { Shown, useListing } from './listing.js';
import type { SpaceRow } from './SpaceDialogs.js';
import { Spaces } from './Spaces.js';

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

interface RoleRow {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
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
  const spaces = useListing<SpaceRow>(loads.spaces, shown === 'spaces', spacesRead);
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

  // Back to the environment takes itself away: focus goes to the button it was
  // reached from, or to the section's heading where that is not shown, and never falls out of the
  // dialog.
  useEffect(() => {
    if (accessAt !== null || leftFrom === null) return;
    (backTo.current ?? sectionHeading.current)?.focus();
  }, [accessAt, leftFrom]);

  useEffect(() => {
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
        {shown === 'overview' && accessAt !== null && (
          <AccessHere
            key={accessAt.kind === 'space' ? accessAt.id : 'tenant'}
            client={client}
            at={accessAt}
            back="Back to the environment"
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
        {shown === 'spaces' && (
          <Spaces
            client={client}
            read={spaces}
            mayChange={mayChangeSpaces}
            administers={(space) => administers.get(`space:${space}`) === true}
            onChanged={() => setSpacesRead((count) => count + 1)}
          />
        )}
        {shown === 'people' && <People client={client} />}
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
