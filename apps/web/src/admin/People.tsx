import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { refusal, type ShownToken } from '../account/TokenTable.js';
import { explainAnswer, permissionName, type ShownPerson } from '../access/describe.js';
import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import { Chip } from '../parts/Chip.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import { IconButton } from '../parts/IconButton.js';
import { PanelTabs } from '../parts/PanelTabs.js';
import { RowActions } from '../parts/RowActions.js';
import { SidePanel } from '../parts/SidePanel.js';
import { Icon } from '../editor/Icon.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { NOT_YOURS, Shown, useListing } from './listing.js';

type Client = ReturnType<typeof createApiClient>;

export interface InvitationRow {
  readonly id: string;
  readonly email: string;
  readonly external: boolean;
  readonly expiresAt: string | null;
  readonly lapsed: boolean;
  readonly acceptedAt: string | null;
}

/** How many people a page of People reads at a time. */
const PAGE = 50;

const KINDS = { user: 'Member', external: 'Outside', service: 'Service' } as const;
const FILTERS = ['All', 'Members', 'Outside', 'Services'] as const;
type Filter = (typeof FILTERS)[number];
const FILTERED: Record<Filter, ShownPerson['kind'] | null> = {
  All: null,
  Members: 'user',
  Outside: 'external',
  Services: 'service',
};

const nameOf = (person: ShownPerson) => person.name ?? person.email ?? 'Somebody';
const initials = (person: ShownPerson) =>
  nameOf(person)
    .split(/[\s.@]+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

const dayOf = (iso: string, year = true) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(year ? { year: 'numeric' } : {}),
  });
const longDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** A person's status: an invitation not yet accepted, a service at work, or somebody who signed in. */
function status(person: ShownPerson) {
  if (person.invited) return <Chip tone="warn">Invited</Chip>;
  return <Chip tone="ok">{person.kind === 'service' ? 'Active' : 'Signed in'}</Chip>;
}

/** What a token may do, in words: reading alone where it holds nothing more. */
const scopeWords = (scopes: readonly string[]) =>
  scopes.length === 0 ? 'Reads only' : `May ${scopes.map(permissionName).join(', ')}`;

/** The people, a page at a time, with how many there are in all (AD-A, AD-E). */
function usePeople(client: Client, generation: number) {
  const [rows, setRows] = useState<readonly ShownPerson[] | 'refused' | 'failed' | null>(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const read = useCallback(
    async (cursor: string | null) => {
      try {
        const { data, response } = await client.GET('/v1/principals', {
          params: {
            query: { level: 'tenant', limit: String(PAGE), ...(cursor ? { cursor } : {}) },
          },
        });
        if (!data) {
          if (cursor === null) setRows(response.status === 403 ? 'refused' : 'failed');
          return;
        }
        setRows((was) =>
          cursor === null || !Array.isArray(was) ? data.items : [...was, ...data.items],
        );
        setTotal(data.total);
        setNext(data.next);
      } catch {
        if (cursor === null) setRows('failed');
      }
    },
    [client],
  );
  useEffect(() => {
    void read(null);
  }, [read, generation]);
  return { rows, total, more: next === null ? null : () => void read(next) };
}

/**
 * A person's API tokens, each revoked after asking - how a departed person's tokens go without waiting
 * for each to expire (service-foundations.md, TK-E).
 */
function PersonTokens({
  client,
  person,
  onCount,
}: {
  client: Client;
  person: ShownPerson;
  onCount: (count: number) => void;
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
  const [asking, setAsking] = useState<ShownToken | null>(null);
  const [said, setSaid] = useState('');
  const name = nameOf(person);
  const intro = useRef<HTMLParagraphElement>(null);
  // A token revoked takes its Revoke button, which the question gave the focus back to, with it: the
  // focus comes to the panel's own words rather than falling to the page, out of Escape's reach.
  useEffect(() => {
    if (
      revoked.size > 0 &&
      (document.activeElement === null || document.activeElement === document.body)
    ) {
      intro.current?.focus();
    }
  }, [revoked]);
  const live =
    read !== null && typeof read === 'object'
      ? read.rows.filter((token) => !revoked.has(token.id))
      : null;
  const counted = live === null ? null : live.length;
  useEffect(() => {
    if (counted !== null) onCount(counted);
  }, [counted, onCount]);

  const revoke = async (token: ShownToken) => {
    const gone = () => setRevoked((was) => new Set(was).add(token.id));
    try {
      const { response, error } = await client.DELETE('/v1/principals/{id}/tokens/{token}', {
        params: { path: { id: person.id, token: token.id } },
      });
      if (response.ok) {
        gone();
        setSaid(`Revoked ${token.name}.`);
      } else if (response.status === 404) {
        gone();
        setSaid(`${token.name} had already been revoked.`);
      } else {
        setSaid(refusal(error, `${token.name} could not be revoked.`));
      }
    } catch {
      setSaid(`${token.name} could not be revoked.`);
    }
    setAsking(null);
  };

  return (
    <>
      <p ref={intro} tabIndex={-1} className={styles['muted']}>
        Revoking a token ends it at once, without waiting for it to expire.
      </p>
      <Shown read={read} failed="The tokens could not be loaded.">
        {() =>
          live!.length === 0 ? (
            <Empty>
              <p>{`${name} has no API tokens.`}</p>
            </Empty>
          ) : (
            <ul aria-label={`Tokens of ${name}`} className={styles['cards']}>
              {live!.map((token) => (
                <li key={token.id}>
                  <div>
                    <p className={styles['strong']}>{token.name}</p>
                    <p className={styles['muted']}>{scopeWords(token.scopes)}</p>
                  </div>
                  <div className={styles['dates']}>
                    <p>{`Until ${dayOf(token.expiresAt)}`}</p>
                    <p>
                      {token.lastUsedAt === null
                        ? 'Never used'
                        : `Used ${dayOf(token.lastUsedAt, false)}`}
                    </p>
                  </div>
                  <IconButton
                    label={`Revoke ${token.name}`}
                    tooltip="Revoke"
                    className={styles['bin']}
                    onClick={() => setAsking(token)}
                  >
                    <Icon name="Revoke" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )
        }
      </Shown>
      <p role="status">{said}</p>
      {asking !== null && (
        <ConfirmDialog
          question={`Revoke ${asking.name}?`}
          sentence="Revoking a token ends it at once, without waiting for it to expire."
          keep="Keep it"
          act="Revoke token"
          onKeep={() => setAsking(null)}
          onAct={() => revoke(asking)}
        />
      )}
    </>
  );
}

/** What a person may do across the environment, and why (`/v1/access/explain` at the tenant). */
function WhatTheyMayDo({
  client,
  person,
  people,
}: {
  client: Client;
  person: ShownPerson;
  people: readonly ShownPerson[];
}) {
  type Answer = Parameters<typeof explainAnswer>[0];
  const [answers, setAnswers] = useState<readonly Answer[] | 'refused' | 'failed' | null>(null);
  useEffect(() => {
    let current = true;
    client
      .GET('/v1/access/explain', { params: { query: { principal: person.id, target: 'tenant' } } })
      .then(({ data, response }) => {
        if (!current) return;
        if (data) setAnswers(data.permissions as readonly Answer[]);
        else setAnswers(response.status === 403 ? 'refused' : 'failed');
      })
      .catch(() => current && setAnswers('failed'));
    return () => {
      current = false;
    };
  }, [client, person.id]);
  if (answers === null) return <Waiting>Loading...</Waiting>;
  if (answers === 'refused') {
    return (
      <Notice tone="refused">
        <p>{NOT_YOURS}</p>
      </Notice>
    );
  }
  if (answers === 'failed') {
    return (
      <Notice tone="failed">
        <p>What they may do could not be shown. Try again.</p>
      </Notice>
    );
  }
  const places = [
    { target: 'tenant', label: 'The whole environment', named: 'the whole environment' },
  ];
  const byId = new Map(people.map((each) => [each.id, each]));
  return (
    <table className={styles['plain']}>
      <caption>{`What ${nameOf(person)} may do across the whole environment`}</caption>
      <thead>
        <tr>
          <th scope="col">Permission</th>
          <th scope="col">Answer</th>
          <th scope="col">Why</th>
        </tr>
      </thead>
      <tbody>
        {answers.map((answer) => (
          <tr key={answer.permission}>
            <th scope="row">{permissionName(answer.permission)}</th>
            <td>{answer.allowed ? 'Allowed' : 'Refused'}</td>
            <td>{explainAnswer(answer, places, byId)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One person beside the list: who they are, their tokens, and what they may do. */
function PersonPanel({
  client,
  person,
  people,
  tab,
  onTab,
  onClose,
}: {
  client: Client;
  person: ShownPerson;
  people: readonly ShownPerson[];
  tab: 'tokens' | 'may';
  onTab: (tab: 'tokens' | 'may') => void;
  onClose: () => void;
}) {
  const ids = useId();
  const [count, setCount] = useState<number | null>(null);
  const tabs = [
    { key: 'tokens', label: count === null ? 'API tokens' : `API tokens ${count}` },
    { key: 'may', label: 'What they may do' },
  ];
  const idsOf = (key: string) => ({ tab: `${ids}-${key}-tab`, panel: `${ids}-${key}-panel` });
  return (
    <SidePanel
      heading={nameOf(person)}
      description={
        <>
          {person.name !== null && person.email !== null && <span>{person.email} </span>}
          <Chip>{KINDS[person.kind]}</Chip> {status(person)}
        </>
      }
      onClose={onClose}
    >
      <PanelTabs
        label={`About ${nameOf(person)}`}
        tabs={tabs}
        chosen={tab}
        onChoose={(key) => onTab(key as 'tokens' | 'may')}
        ids={idsOf}
      />
      <div role="tabpanel" id={idsOf(tab).panel} aria-labelledby={idsOf(tab).tab}>
        {tab === 'tokens' ? (
          <PersonTokens client={client} person={person} onCount={setCount} />
        ) : (
          <WhatTheyMayDo client={client} person={person} people={people} />
        )}
      </div>
    </SidePanel>
  );
}

/** Invite somebody by address, as Access does, from People's own page action. */
function InvitePeople({
  client,
  onClose,
  onDone,
}: {
  client: Client;
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  const id = useId();
  const [address, setAddress] = useState('');
  const [outside, setOutside] = useState(false);
  const [said, setSaid] = useState('');
  const [sending, setSending] = useState(false);
  const invite = async () => {
    if (address.trim() === '') {
      setSaid('Give the address to invite.');
      return;
    }
    setSending(true);
    try {
      const { data, error, response } = await client.POST('/v1/invitations', {
        body: { email: address.trim(), ...(outside ? { external: true } : {}) },
      });
      if (data) {
        onDone(
          data.renewed
            ? `Renewed the invitation to ${data.invitation.email}.`
            : `Invited ${data.invitation.email}.`,
        );
        return;
      }
      setSaid(
        response.status === 403
          ? 'You may not invite anyone to this environment.'
          : refusal(error, 'That address could not be invited.'),
      );
    } catch {
      setSaid('That address could not be invited.');
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal labelledBy={id} onClose={onClose}>
      <section>
        <h2 id={id}>Invite people</h2>
        <p>
          An invitation becomes a person in the People tab the first time its address signs in. Give
          them access from the environment&apos;s or a space&apos;s Access.
        </p>
        <label>
          Address
          <input
            type="email"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <div className={styles['check']}>
          <label>
            <input
              type="checkbox"
              checked={outside}
              onChange={(event) => setOutside(event.target.checked)}
            />
            From outside the organisation
          </label>
        </div>
        <p role="status">{said}</p>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={sending} onClick={() => void invite()}>
          Invite
        </button>
      </section>
    </Modal>
  );
}

/**
 * Administration's People (ADR-0049; the AD plan, AD5): the people a page at a time and the waiting
 * invitations, each a tab. A person's tokens and what they may do open in the side panel beside the
 * list; Invite people asks for an address; withdrawing an invitation asks first.
 */
export function People({ client }: { client: Client }) {
  const ids = useId();
  const [tab, setTab] = useState<'people' | 'invitations'>('people');
  const [generation, setGeneration] = useState(0);
  const people = usePeople(client, generation);
  const [loadInvitations] = useState(
    () => () =>
      everyPage<InvitationRow>((cursor) =>
        client.GET('/v1/invitations', { params: { query: cursor ? { cursor } : {} } }),
      ),
  );
  const invitations = useListing<InvitationRow>(loadInvitations, true, generation);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [address, setAddress] = useState('');
  const [lapsed, setLapsed] = useState(false);
  const [open, setOpen] = useState<{ person: ShownPerson; tab: 'tokens' | 'may' } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [withdrawing, setWithdrawing] = useState<InvitationRow | null>(null);
  const [said, setSaid] = useState('');

  const pending =
    invitations !== null && typeof invitations === 'object'
      ? invitations.rows.filter((each) => each.acceptedAt === null)
      : null;
  const waitingCount = pending?.filter((each) => !each.lapsed).length;
  const idsOf = (key: string) => ({ tab: `${ids}-${key}-tab`, panel: `${ids}-${key}-panel` });

  const withdraw = async (invitation: InvitationRow) => {
    try {
      const { data, error, response } = await client.DELETE('/v1/invitations/{id}', {
        params: { path: { id: invitation.id } },
      });
      setSaid(
        data
          ? `Withdrew the invitation to ${invitation.email}, and everything granted to them.`
          : response.status === 404
            ? 'That invitation is gone already.'
            : refusal(error, 'The invitation could not be withdrawn.'),
      );
    } catch {
      setSaid('The invitation could not be withdrawn.');
    }
    setWithdrawing(null);
    setGeneration((count) => count + 1);
  };

  const listed: readonly ShownPerson[] =
    people.rows !== null && typeof people.rows === 'object' ? people.rows : [];
  const shownPeople = listed.filter((person) => {
    const kind = FILTERED[filter];
    const words = `${person.name ?? ''} ${person.email ?? ''}`.toLocaleLowerCase();
    return (
      (kind === null || person.kind === kind) && words.includes(query.trim().toLocaleLowerCase())
    );
  });

  return (
    <>
      <div className={styles['lead']}>
        <p>Everybody who has signed in to this environment, or been invited to.</p>
        <button type="button" className="primary" onClick={() => setInviting(true)}>
          <Icon name="Invite people" /> Invite people
        </button>
      </div>
      <PanelTabs
        label="People and invitations"
        tabs={[
          {
            key: 'people',
            label: Array.isArray(people.rows) ? `People ${people.total}` : 'People',
          },
          {
            key: 'invitations',
            label:
              waitingCount === undefined
                ? 'Waiting invitations'
                : `Waiting invitations ${waitingCount}`,
          },
        ]}
        chosen={tab}
        onChoose={(key) => setTab(key as 'people' | 'invitations')}
        ids={idsOf}
      />
      {tab === 'people' && (
        <div role="tabpanel" id={idsOf('people').panel} aria-labelledby={idsOf('people').tab}>
          {people.rows === null && <Waiting>Loading...</Waiting>}
          {people.rows === 'refused' && (
            <Notice tone="refused">
              <p>{NOT_YOURS}</p>
            </Notice>
          )}
          {people.rows === 'failed' && (
            <Notice tone="failed">
              <p>The people could not be loaded.</p>
            </Notice>
          )}
          {Array.isArray(people.rows) && (
            <>
              <div className={styles['toolbar']}>
                <input
                  type="search"
                  className={styles['search']}
                  aria-label="Name or address"
                  placeholder="Name or address"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div role="group" aria-label="Show" className={styles['segments']}>
                  {FILTERS.map((each) => (
                    <button
                      key={each}
                      type="button"
                      aria-pressed={filter === each}
                      onClick={() => setFilter(each)}
                    >
                      {each}
                    </button>
                  ))}
                </div>
              </div>
              <div className={open === null ? undefined : styles['withPanel']}>
                <div>
                  <table aria-label="People" className={styles['table']}>
                    <colgroup>
                      <col />
                      <col className={styles['statusColumn']} />
                      <col className={styles['statusColumn']} />
                      <col className={styles['actionsColumn']} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Person</th>
                        <th scope="col">Kind</th>
                        <th scope="col">Status</th>
                        <th scope="col">
                          <span className={styles['hidden']}>Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownPeople.map((person) => (
                        <tr
                          key={person.id}
                          data-current={open?.person.id === person.id ? 'true' : undefined}
                        >
                          <td>
                            <span className={styles['who']}>
                              <span className={styles['initials']} aria-hidden="true">
                                {initials(person)}
                              </span>
                              <span>
                                <span className={styles['name']}>{nameOf(person)}</span>{' '}
                                <span className={styles['muted']}>
                                  {person.name !== null && person.email !== null
                                    ? person.email
                                    : person.invited
                                      ? 'Invited'
                                      : KINDS[person.kind]}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td>{KINDS[person.kind]}</td>
                          <td>{status(person)}</td>
                          <td>
                            <RowActions
                              subject={nameOf(person)}
                              shown={[
                                {
                                  label: 'API tokens',
                                  name: `API tokens of ${nameOf(person)}`,
                                  icon: 'API tokens',
                                  onSelect: () => setOpen({ person, tab: 'tokens' }),
                                  ...(person.invited
                                    ? { unavailable: 'Not signed in yet, so no tokens' }
                                    : {}),
                                },
                              ]}
                              more={[
                                {
                                  label: 'What they may do',
                                  onSelect: () => setOpen({ person, tab: 'may' }),
                                },
                              ]}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {people.more !== null && (
                    <div className={styles['more']}>
                      <p className={styles['muted']}>
                        {`Showing ${listed.length} of ${people.total}`}
                      </p>
                      <button type="button" onClick={people.more}>
                        Show more
                      </button>
                    </div>
                  )}
                </div>
                {open !== null && (
                  <PersonPanel
                    key={open.person.id}
                    client={client}
                    person={open.person}
                    people={listed}
                    tab={open.tab}
                    onTab={(chosen) => setOpen({ ...open, tab: chosen })}
                    onClose={() => setOpen(null)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
      {tab === 'invitations' && (
        <div
          role="tabpanel"
          id={idsOf('invitations').panel}
          aria-labelledby={idsOf('invitations').tab}
        >
          <Shown read={invitations} failed="Invitations could not be loaded.">
            {() => {
              const shown = pending!.filter(
                (each) =>
                  each.lapsed === lapsed && each.email.includes(address.trim().toLocaleLowerCase()),
              );
              return (
                <>
                  <div className={styles['toolbar']}>
                    <input
                      type="search"
                      className={styles['search']}
                      aria-label="Address"
                      placeholder="Address"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                    />
                    <div role="group" aria-label="Show" className={styles['segments']}>
                      {(['Waiting', 'Lapsed'] as const).map((each) => (
                        <button
                          key={each}
                          type="button"
                          aria-pressed={lapsed === (each === 'Lapsed')}
                          onClick={() => setLapsed(each === 'Lapsed')}
                        >
                          {each}
                        </button>
                      ))}
                    </div>
                    <p className={styles['counted']}>
                      {`${shown.length} ${lapsed ? 'lapsed' : 'waiting'}`}
                    </p>
                  </div>
                  {shown.length === 0 ? (
                    <Empty>
                      <p>
                        {lapsed
                          ? 'No invitation has lapsed.'
                          : 'Nobody is waiting to accept an invitation.'}
                      </p>
                    </Empty>
                  ) : (
                    <table aria-label="Waiting invitations" className={styles['table']}>
                      <colgroup>
                        <col />
                        <col className={styles['accessColumn']} />
                        <col className={styles['accessColumn']} />
                        <col className={styles['iconColumn']} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th scope="col">Address</th>
                          <th scope="col">Invited as</th>
                          <th scope="col">{lapsed ? 'Lapsed on' : 'Waiting until'}</th>
                          <th scope="col">
                            <span className={styles['hidden']}>Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((invitation) => (
                          <tr key={invitation.id}>
                            <td>{invitation.email}</td>
                            <td>
                              {invitation.external ? (
                                <Chip tone="info">From outside</Chip>
                              ) : (
                                'Member'
                              )}
                            </td>
                            <td>
                              {invitation.expiresAt === null ? '' : longDay(invitation.expiresAt)}
                            </td>
                            <td>
                              <RowActions
                                subject={invitation.email}
                                shown={[
                                  {
                                    label: 'Withdraw',
                                    name: `Withdraw the invitation to ${invitation.email}`,
                                    icon: 'Withdraw',
                                    onSelect: () => setWithdrawing(invitation),
                                  },
                                ]}
                                more={[]}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className={styles['muted']}>
                    An invitation becomes a person in the People tab the first time its address
                    signs in.
                  </p>
                </>
              );
            }}
          </Shown>
        </div>
      )}
      <p role="status">{said}</p>
      {inviting && (
        <InvitePeople
          client={client}
          onClose={() => setInviting(false)}
          onDone={(words) => {
            setInviting(false);
            setSaid(words);
            setGeneration((count) => count + 1);
          }}
        />
      )}
      {withdrawing !== null && (
        <ConfirmDialog
          question={`Withdraw the invitation to ${withdrawing.email}?`}
          sentence="Everything granted to them goes with it."
          keep="Keep it"
          act="Withdraw"
          onKeep={() => setWithdrawing(null)}
          onAct={() => withdraw(withdrawing)}
        />
      )}
    </>
  );
}
