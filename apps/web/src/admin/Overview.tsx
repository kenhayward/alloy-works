import type { createApiClient } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { AccessPanel } from '../access/AccessPanel.js';
import { everyPage } from '../paging.js';
import { SidePanel } from '../parts/SidePanel.js';
import styles from './Administration.module.css';
import { notYours } from './listing.js';
import { formats, words as say } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface Facts {
  readonly spaces?: { readonly names: readonly string[]; readonly archived: number };
  readonly people?: number;
  readonly waiting?: number;
  readonly groups?: { readonly count: number; readonly fromSignIn: number };
  readonly roles?: number;
}

interface Granted {
  readonly role: { readonly name: string };
  readonly subject:
    | { readonly principal: { readonly name: string | null; readonly email: string | null } }
    | { readonly group: { readonly name: string } };
  readonly effect: 'allow' | 'deny';
}

/** Who a grant names, as a sentence would: a person by name, a group as the group. */
const holderOf = (grant: Granted) => {
  const { effect } = grant;
  if ('group' in grant.subject) {
    return say('admin.the-group-2', { effect, name: grant.subject.group.name });
  }
  const name = grant.subject.principal.name ?? grant.subject.principal.email;
  return name === null
    ? say('admin.somebody-holds', { effect })
    : say('admin.denied-2', { effect, name });
};

/** Reads one fact, keeping the others, and nothing where it cannot be read. */
function useFacts(client: Client): Facts {
  const [facts, setFacts] = useState<Facts>({});
  useEffect(() => {
    let current = true;
    const learn = (read: () => Promise<Partial<Facts> | undefined>) => {
      read()
        .then((found) => {
          if (current && found) setFacts((was) => ({ ...was, ...found }));
        })
        .catch(() => undefined);
    };
    learn(async () => {
      const read = await everyPage<{ name: string; archived?: boolean }>((cursor) =>
        client.GET('/v1/spaces', {
          params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
        }),
      );
      if (!('items' in read)) return undefined;
      return {
        spaces: {
          names: read.items.map((each) => each.name),
          archived: read.items.filter((each) => each.archived === true).length,
        },
      };
    });
    learn(async () => {
      const { data } = await client.GET('/v1/principals', {
        params: { query: { level: 'tenant', limit: '1' } },
      });
      return data ? { people: data.total } : undefined;
    });
    learn(async () => {
      const read = await everyPage<{ lapsed: boolean; acceptedAt: string | null }>((cursor) =>
        client.GET('/v1/invitations', { params: { query: cursor ? { cursor } : {} } }),
      );
      return 'items' in read
        ? { waiting: read.items.filter((each) => !each.lapsed && each.acceptedAt === null).length }
        : undefined;
    });
    learn(async () => {
      const read = await everyPage<{ source: string }>((cursor) =>
        client.GET('/v1/groups', {
          params: { query: { limit: '100', ...(cursor ? { cursor } : {}) } },
        }),
      );
      return 'items' in read
        ? {
            groups: {
              count: read.items.length,
              fromSignIn: read.items.filter((each) => each.source !== 'tenant').length,
            },
          }
        : undefined;
    });
    learn(async () => {
      const read = await everyPage((cursor) =>
        client.GET('/v1/roles', {
          params: { query: { level: 'tenant', ...(cursor ? { cursor } : {}) } },
        }),
      );
      return 'items' in read ? { roles: read.items.length } : undefined;
    });
    return () => {
      current = false;
    };
  }, [client]);
  return facts;
}

/** What is granted at the environment itself, by role: who holds each. */
function useEnvironmentGrants(client: Client) {
  const [grants, setGrants] = useState<readonly Granted[] | 'refused' | 'failed' | null>(null);
  useEffect(() => {
    let current = true;
    everyPage<Granted>((cursor) =>
      client.GET('/v1/grants', {
        params: { query: { level: 'tenant', limit: '100', ...(cursor ? { cursor } : {}) } },
      }),
    )
      .then((read) => {
        if (!current) return;
        if ('items' in read) setGrants(read.items);
        else setGrants(read.status === 403 ? 'refused' : 'failed');
      })
      .catch(() => current && setGrants('failed'));
    return () => {
      current = false;
    };
  }, [client]);
  return grants;
}

/**
 * Administration's Overview (the AD plan, AD7): that changes here take effect at once; what the
 * environment holds, each a way to its section; the environment itself; who holds what across it,
 * with its Access in the side panel; and this version, with its release notes in About.
 */
export function Overview({
  client,
  environment,
  administers,
}: {
  client: Client;
  environment: string | null;
  /** Whether the reader administers the environment, so may be offered its Access. */
  administers: boolean;
}) {
  const facts = useFacts(client);
  const grants = useEnvironmentGrants(client);
  const [managing, setManaging] = useState(false);

  const cards: readonly { href: string; count?: number; words: string }[] = [
    {
      href: '#/admin/spaces',
      ...(facts.spaces ? { count: facts.spaces.names.length } : {}),
      words:
        facts.spaces && facts.spaces.archived > 0
          ? say('admin.spaces-archived', { archived: facts.spaces.archived })
          : say('admin.spaces'),
    },
    {
      href: '#/admin/people',
      ...(facts.people === undefined ? {} : { count: facts.people }),
      words: say('admin.people'),
    },
    {
      href: '#/admin/people',
      ...(facts.waiting === undefined ? {} : { count: facts.waiting }),
      words: say('admin.waiting-invitations'),
    },
    {
      href: '#/admin/groups',
      ...(facts.groups ? { count: facts.groups.count } : {}),
      words:
        facts.groups && facts.groups.fromSignIn > 0
          ? say('admin.groups-from-sign-in', { fromSignIn: facts.groups.fromSignIn })
          : say('admin.groups'),
    },
    {
      href: '#/admin/roles',
      ...(facts.roles === undefined ? {} : { count: facts.roles }),
      words: say('admin.roles'),
    },
  ];

  const byRole = new Map<string, string[]>();
  if (Array.isArray(grants)) {
    for (const grant of grants as readonly Granted[]) {
      byRole.set(grant.role.name, [...(byRole.get(grant.role.name) ?? []), holderOf(grant)]);
    }
  }

  return (
    <>
      <p className={styles['banner']}>{say('admin.changes-in-administration-take-effect')}</p>
      <ul className={styles['stats']} aria-label={say('admin.what-this-environment-holds')}>
        {cards.map((card) => (
          <li key={card.words}>
            <a href={card.href}>
              <span className={styles['big']}>{card.count ?? ''}</span>{' '}
              <span className={styles['muted']}>{card.words}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className={managing ? styles['withPanel'] : undefined}>
        <div className={styles['overviewCards']}>
          <section aria-labelledby="this-environment" className={styles['card']}>
            <h2 id="this-environment">{say('admin.this-environment')}</h2>
            <dl>
              <dt>{say('admin.name')}</dt>
              <dd data-content>{environment ?? ''}</dd>
              <dt>{say('admin.address')}</dt>
              <dd>
                <code>{window.location.host}</code>
              </dd>
              <dt>{say('admin.spaces')}</dt>
              <dd data-content>
                {facts.spaces ? formats().list(facts.spaces.names, { type: 'unit' }) : ''}
              </dd>
            </dl>
          </section>
          <section aria-labelledby="environment-access" className={styles['card']}>
            <div className={styles['cardHead']}>
              <h2 id="environment-access">{say('admin.access-to-the-whole-environment')}</h2>
              {administers && (
                <button
                  type="button"
                  aria-label={say('admin.manage-access-to-the-whole')}
                  onClick={() => setManaging(true)}
                >
                  {say('admin.manage-access')}
                </button>
              )}
            </div>
            {grants === 'refused' && <p className={styles['muted']}>{notYours()}</p>}
            {grants === 'failed' && (
              <p className={styles['muted']}>{say('admin.what-is-granted-here-could')}</p>
            )}
            {Array.isArray(grants) &&
              (byRole.size === 0 ? (
                <p className={styles['muted']}>{say('admin.nothing-is-granted-to-the')}</p>
              ) : (
                <table className={styles['plain']}>
                  <tbody>
                    {[...byRole].map(([role, holders]) => (
                      <tr key={role}>
                        <th scope="row" data-content>
                          {role}
                        </th>
                        <td>{formats().list(holders, { type: 'unit' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
          </section>
          <section
            aria-labelledby="overview-about"
            className={`${styles['card']} ${styles['wideCard']}`}
          >
            <div className={styles['cardHead']}>
              <h2 id="overview-about">{say('admin.about-2')}</h2>
              <code>{__APP_VERSION__}</code>
              <a href="#/admin/about">{say('admin.release-notes')}</a>
            </div>
          </section>
        </div>
        {managing && (
          <SidePanel
            heading={say('admin.access-to-the-whole-environment')}
            description={say('admin.the-environment-grants-here-reach')}
            icon="Access"
            onClose={() => setManaging(false)}
          >
            <AccessPanel at={{ kind: 'tenant' }} client={client} headingLevel={3} titled={false} />
          </SidePanel>
        )}
      </div>
    </>
  );
}
