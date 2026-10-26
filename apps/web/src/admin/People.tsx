import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { NewToken } from '../account/ApiTokens.js';
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
import { EraseDialog } from './Erase.js';
import { notYours, Shown, useListing } from './listing.js';
import { words as say } from '../words/words.js';

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

const KINDS = {
  get user() {
    return say('admin.member');
  },
  get external() {
    return say('admin.outside-2');
  },
  get service() {
    return say('admin.service');
  },
} as const;
const FILTERS = ['All', 'Members', 'Outside', 'Services'] as const;
type Filter = (typeof FILTERS)[number];
const FILTERED: Record<Filter, ShownPerson['kind'] | null> = {
  All: null,
  Members: 'user',
  Outside: 'external',
  Services: 'service',
};

const nameOf = (person: ShownPerson) => person.name ?? person.email ?? say('admin.somebody');
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

/**
 * A person's status: erased, an invitation not yet accepted, a service at work, or somebody who signed
 * in.
 */
function status(person: ShownPerson, service?: ShownService) {
  if (person.erased === true) return <Chip>{say('admin.erased')}</Chip>;
  if (person.invited) return <Chip tone="warn">{say('admin.invited')}</Chip>;
  if (service?.disabledAt) return <Chip>{say('admin.disabled')}</Chip>;
  return (
    <Chip tone="ok">
      {person.kind === 'service' ? say('admin.active') : say('admin.signed-in')}
    </Chip>
  );
}

/** What a token may do, in words: reading alone where it holds nothing more. */
const scopeWords = (scopes: readonly string[]) =>
  scopes.length === 0
    ? say('admin.reads-only')
    : say('admin.may', { value1: scopes.map(permissionName).join(', ') });

/** A service identity as People shows it beside its principal (the G8 plan, G8-J). */
export interface ShownService {
  readonly id: string;
  readonly description: string;
  readonly disabledAt: string | null;
}

/** The environment's service identities, by id: whether each is disabled, and what it is for. */
function useServices(client: Client, generation: number) {
  const [services, setServices] = useState<ReadonlyMap<string, ShownService>>(new Map());
  useEffect(() => {
    let current = true;
    everyPage<ShownService>((cursor) =>
      client.GET('/v1/service-identities', { params: { query: cursor ? { cursor } : {} } }),
    )
      .then((answer) => {
        if (current && 'items' in answer) {
          setServices(new Map(answer.items.map((each) => [each.id, each])));
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, generation]);
  return services;
}

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
  service,
  onCount,
}: {
  client: Client;
  person: ShownPerson;
  service?: ShownService | undefined;
  onCount: (count: number) => void;
}) {
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(0);
  // A service identity's tokens are issued by an administrator, here (G8-H).
  const issuable = service !== undefined && service.disabledAt === null;
  return (
    <>
      {issuable && (
        <div className={styles['lead']}>
          <p>{service.description}</p>
          <button type="button" onClick={() => setIssuing(true)}>
            {say('admin.new-token')}
          </button>
        </div>
      )}
      <HeldTokens key={issued} client={client} person={person} onCount={onCount} />
      {issuing && (
        <NewToken
          client={client}
          holder={{ id: person.id, name: nameOf(person) }}
          onIssued={() => setIssued((count) => count + 1)}
          onClose={() => setIssuing(false)}
        />
      )}
    </>
  );
}

function HeldTokens({
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
        setSaid(say('admin.revoked-2', { name: token.name }));
      } else if (response.status === 404) {
        gone();
        setSaid(say('admin.had-already-been-revoked', { name: token.name }));
      } else {
        setSaid(refusal(error, say('admin.could-not-be-revoked', { name: token.name })));
      }
    } catch {
      setSaid(say('admin.could-not-be-revoked', { name: token.name }));
    }
    setAsking(null);
  };

  return (
    <>
      <p ref={intro} tabIndex={-1} className={styles['muted']}>
        {say('admin.revoking-a-token-ends-it')}
      </p>
      <Shown read={read} failed="The tokens could not be loaded.">
        {() =>
          live!.length === 0 ? (
            <Empty>
              <p>{say('admin.has-no-api-tokens', { name })}</p>
            </Empty>
          ) : (
            <ul aria-label={say('admin.tokens-of', { name })} className={styles['cards']}>
              {live!.map((token) => (
                <li key={token.id}>
                  <div>
                    <p className={styles['strong']}>{token.name}</p>
                    <p className={styles['muted']}>{scopeWords(token.scopes)}</p>
                  </div>
                  <div className={styles['dates']}>
                    <p>{say('admin.until-2', { value1: dayOf(token.expiresAt) })}</p>
                    <p>
                      {token.lastUsedAt === null
                        ? say('admin.never-used')
                        : say('admin.used', { value1: dayOf(token.lastUsedAt, false) })}
                    </p>
                  </div>
                  <IconButton
                    label={say('admin.revoke', { name: token.name })}
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
          question={say('admin.revoke-2', { name: asking.name })}
          sentence={say('admin.revoking-a-token-ends-it')}
          keep={say('admin.keep-it')}
          act={say('admin.revoke-token')}
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
  if (answers === null) return <Waiting>{say('admin.loading')}</Waiting>;
  if (answers === 'refused') {
    return (
      <Notice tone="refused">
        <p>{notYours()}</p>
      </Notice>
    );
  }
  if (answers === 'failed') {
    return (
      <Notice tone="failed">
        <p>{say('admin.what-they-may-do-could')}</p>
      </Notice>
    );
  }
  const places = [
    {
      target: 'tenant',
      label: say('admin.the-whole-environment'),
      named: say('admin.the-whole-environment-2'),
    },
  ];
  const byId = new Map(people.map((each) => [each.id, each]));
  return (
    <table className={styles['plain']}>
      <caption>{say('admin.what-may-do-across-the', { value1: nameOf(person) })}</caption>
      <thead>
        <tr>
          <th scope="col">{say('admin.permission')}</th>
          <th scope="col">{say('admin.answer')}</th>
          <th scope="col">{say('admin.why')}</th>
        </tr>
      </thead>
      <tbody>
        {answers.map((answer) => (
          <tr key={answer.permission}>
            <th scope="row">{permissionName(answer.permission)}</th>
            <td>{answer.allowed ? say('admin.allowed') : say('admin.refused')}</td>
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
  service,
  people,
  tab,
  onTab,
  onClose,
}: {
  client: Client;
  person: ShownPerson;
  service: ShownService | undefined;
  people: readonly ShownPerson[];
  tab: 'tokens' | 'may';
  onTab: (tab: 'tokens' | 'may') => void;
  onClose: () => void;
}) {
  const ids = useId();
  const [count, setCount] = useState<number | null>(null);
  const tabs = [
    {
      key: 'tokens',
      label: count === null ? say('admin.api-tokens') : say('admin.api-tokens-2', { count }),
    },
    { key: 'may', label: say('admin.what-they-may-do') },
  ];
  const idsOf = (key: string) => ({ tab: `${ids}-${key}-tab`, panel: `${ids}-${key}-panel` });
  return (
    <SidePanel
      heading={nameOf(person)}
      description={
        <>
          {person.name !== null && person.email !== null && <span>{person.email} </span>}
          <Chip>{KINDS[person.kind]}</Chip> {status(person, service)}
        </>
      }
      onClose={onClose}
    >
      <PanelTabs
        label={say('admin.about-4', { value1: nameOf(person) })}
        tabs={tabs}
        chosen={tab}
        onChoose={(key) => onTab(key as 'tokens' | 'may')}
        ids={idsOf}
      />
      <div role="tabpanel" id={idsOf(tab).panel} aria-labelledby={idsOf(tab).tab}>
        {tab === 'tokens' ? (
          <PersonTokens client={client} person={person} service={service} onCount={setCount} />
        ) : (
          <WhatTheyMayDo client={client} person={person} people={people} />
        )}
      </div>
    </SidePanel>
  );
}

/**
 * A new service identity (IAM-033; the G8 plan, G8-J): a name and what it is for. It may do nothing
 * until it is given access and a token, as a person is.
 */
function NewService({
  client,
  onClose,
  onDone,
}: {
  client: Client;
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [said, setSaid] = useState('');
  const [sending, setSending] = useState(false);
  const make = async () => {
    if (name.trim() === '') {
      setSaid(say('admin.give-the-service-identity-a'));
      return;
    }
    setSending(true);
    try {
      const { data, error } = await client.POST('/v1/service-identities', {
        body: { name: name.trim(), description: description.trim() },
      });
      if (data) {
        onDone(say('admin.made-give-it-access-then', { name: data.name }));
        return;
      }
      setSaid(refusal(error, say('admin.the-service-identity-could-not')));
    } catch {
      setSaid(say('admin.the-service-identity-could-not'));
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal labelledBy={id} onClose={onClose}>
      <section>
        <h2 id={id}>{say('admin.new-service-identity')}</h2>
        <p>{say('admin.for-an-integration-or-an')}</p>
        <label>
          {say('admin.name')}
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          {say('admin.what-it-is-for')}
          <input
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <p role="status">{said}</p>
        <button type="button" onClick={onClose}>
          {say('admin.cancel')}
        </button>
        <button type="button" className="primary" disabled={sending} onClick={() => void make()}>
          {say('admin.make')}
        </button>
      </section>
    </Modal>
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
      setSaid(say('admin.give-the-address-to-invite'));
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
            ? say('admin.renewed-the-invitation-to', { email: data.invitation.email })
            : say('admin.invited-2', { email: data.invitation.email }),
        );
        return;
      }
      setSaid(
        response.status === 403
          ? say('admin.you-may-not-invite-anyone')
          : refusal(error, say('admin.that-address-could-not-be')),
      );
    } catch {
      setSaid(say('admin.that-address-could-not-be'));
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal labelledBy={id} onClose={onClose}>
      <section>
        <h2 id={id}>{say('admin.invite-people')}</h2>
        <p>{say('admin.an-invitation-becomes-a-person')}</p>
        <label>
          {say('admin.address')}
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
            {say('admin.from-outside-the-organisation')}
          </label>
        </div>
        <p role="status">{said}</p>
        <button type="button" onClick={onClose}>
          {say('admin.cancel')}
        </button>
        <button type="button" className="primary" disabled={sending} onClick={() => void invite()}>
          {say('admin.invite')}
        </button>
      </section>
    </Modal>
  );
}

/**
 * Administration's People (ADR-0049; the AD plan, AD5): the people a page at a time and the waiting
 * invitations, each a tab. A person's tokens and what they may do open in the side panel beside the
 * list; Invite people asks for an address; withdrawing an invitation and erasing a person (ER-F) ask
 * first.
 */
export function People({ client }: { client: Client }) {
  const ids = useId();
  const [tab, setTab] = useState<'people' | 'invitations'>('people');
  const [generation, setGeneration] = useState(0);
  const people = usePeople(client, generation);
  const services = useServices(client, generation);
  const [making, setMaking] = useState(false);
  const [disabling, setDisabling] = useState<ShownPerson | null>(null);
  const [loadInvitations] = useState(
    () => () =>
      everyPage<InvitationRow>((cursor) =>
        client.GET('/v1/invitations', { params: { query: cursor ? { cursor } : {} } }),
      ),
  );
  const invitations = useListing<InvitationRow>(loadInvitations, true, generation);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(say('admin.all'));
  const [address, setAddress] = useState('');
  const [lapsed, setLapsed] = useState(false);
  const [open, setOpen] = useState<{ person: ShownPerson; tab: 'tokens' | 'may' } | null>(null);
  const [inviting, setInviting] = useState(false);
  const [withdrawing, setWithdrawing] = useState<InvitationRow | null>(null);
  const [erasing, setErasing] = useState<ShownPerson | null>(null);
  const [said, setSaid] = useState('');
  // Who is reading, so Erase is never offered on themselves (ER-F); the route refuses it too.
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    client
      .GET('/v1/me')
      .then(({ data }) => current && data && setMe(data.id))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);
  /** Erase is offered on a person: never oneself, a service, or somebody erased already. */
  const erasable = (person: ShownPerson) =>
    me !== null && person.id !== me && person.kind !== 'service' && person.erased !== true;

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
          ? say('admin.withdrew-the-invitation-to-and', { email: invitation.email })
          : response.status === 404
            ? say('admin.that-invitation-is-gone-already')
            : refusal(error, say('admin.the-invitation-could-not-be')),
      );
    } catch {
      setSaid(say('admin.the-invitation-could-not-be'));
    }
    setWithdrawing(null);
    setGeneration((count) => count + 1);
  };

  const disable = async (person: ShownPerson) => {
    try {
      const { data, error } = await client.POST('/v1/service-identities/{id}/disablement', {
        params: { path: { id: person.id } },
      });
      setSaid(
        data
          ? say('admin.disabled-its-tokens-no-longer', { value1: nameOf(person) })
          : refusal(error, say('admin.the-service-identity-could-not-2')),
      );
    } catch {
      setSaid(say('admin.the-service-identity-could-not-2'));
    }
    setDisabling(null);
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
        <p>{say('admin.everybody-who-has-signed-in')}</p>
        <span>
          <button type="button" onClick={() => setMaking(true)}>
            {say('admin.new-service-identity')}
          </button>{' '}
          <button type="button" className="primary" onClick={() => setInviting(true)}>
            <Icon name="Invite people" /> {say('admin.invite-people-2')}
          </button>
        </span>
      </div>
      <PanelTabs
        label={say('admin.people-and-invitations')}
        tabs={[
          {
            key: 'people',
            label: Array.isArray(people.rows)
              ? say('admin.people-2', { total: people.total })
              : say('admin.people'),
          },
          {
            key: 'invitations',
            label:
              waitingCount === undefined
                ? say('admin.waiting-invitations')
                : say('admin.waiting-invitations-2', { waitingCount }),
          },
        ]}
        chosen={tab}
        onChoose={(key) => setTab(key as 'people' | 'invitations')}
        ids={idsOf}
      />
      {tab === 'people' && (
        <div role="tabpanel" id={idsOf('people').panel} aria-labelledby={idsOf('people').tab}>
          {people.rows === null && <Waiting>{say('admin.loading')}</Waiting>}
          {people.rows === 'refused' && (
            <Notice tone="refused">
              <p>{notYours()}</p>
            </Notice>
          )}
          {people.rows === 'failed' && (
            <Notice tone="failed">
              <p>{say('admin.the-people-could-not-be')}</p>
            </Notice>
          )}
          {Array.isArray(people.rows) && (
            <>
              <div className={styles['toolbar']}>
                <input
                  type="search"
                  className={styles['search']}
                  aria-label={say('admin.name-or-address')}
                  placeholder={say('admin.name-or-address')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <div role="group" aria-label={say('admin.show')} className={styles['segments']}>
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
                  <table aria-label={say('admin.people')} className={styles['table']}>
                    <colgroup>
                      <col />
                      <col className={styles['statusColumn']} />
                      <col className={styles['statusColumn']} />
                      <col className={styles['actionsColumn']} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">{say('admin.person')}</th>
                        <th scope="col">{say('admin.kind')}</th>
                        <th scope="col">{say('admin.status')}</th>
                        <th scope="col">
                          <span className={styles['hidden']}>{say('admin.actions')}</span>
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
                                      ? say('admin.invited')
                                      : KINDS[person.kind]}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td>{KINDS[person.kind]}</td>
                          <td>{status(person, services.get(person.id))}</td>
                          <td>
                            <RowActions
                              subject={nameOf(person)}
                              shown={[
                                {
                                  label: say('admin.api-tokens'),
                                  name: say('admin.api-tokens-of', { value1: nameOf(person) }),
                                  icon: 'API tokens',
                                  onSelect: () => setOpen({ person, tab: 'tokens' }),
                                  ...(person.invited
                                    ? { unavailable: say('admin.not-signed-in-yet-so') }
                                    : person.erased === true
                                      ? { unavailable: say('admin.erased-so-no-tokens') }
                                      : {}),
                                },
                              ]}
                              more={[
                                {
                                  label: say('admin.what-they-may-do'),
                                  onSelect: () => setOpen({ person, tab: 'may' }),
                                },
                                ...(services.get(person.id)?.disabledAt === null
                                  ? [
                                      {
                                        label: say('admin.disable'),
                                        danger: true,
                                        onSelect: () => setDisabling(person),
                                      },
                                    ]
                                  : []),
                                ...(erasable(person)
                                  ? [
                                      {
                                        label: say('admin.erase-2'),
                                        danger: true,
                                        onSelect: () => setErasing(person),
                                      },
                                    ]
                                  : []),
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
                        {say('admin.showing-of', { length: listed.length, total: people.total })}
                      </p>
                      <button type="button" onClick={people.more}>
                        {say('admin.show-more')}
                      </button>
                    </div>
                  )}
                </div>
                {open !== null && (
                  <PersonPanel
                    key={open.person.id}
                    client={client}
                    person={open.person}
                    service={services.get(open.person.id)}
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
                      aria-label={say('admin.address')}
                      placeholder={say('admin.address')}
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                    />
                    <div role="group" aria-label={say('admin.show')} className={styles['segments']}>
                      {([say('admin.waiting'), say('admin.lapsed')] as const).map((each) => (
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
                          ? say('admin.no-invitation-has-lapsed')
                          : say('admin.nobody-is-waiting-to-accept')}
                      </p>
                    </Empty>
                  ) : (
                    <table
                      aria-label={say('admin.waiting-invitations')}
                      className={styles['table']}
                    >
                      <colgroup>
                        <col />
                        <col className={styles['accessColumn']} />
                        <col className={styles['accessColumn']} />
                        <col className={styles['iconColumn']} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th scope="col">{say('admin.address')}</th>
                          <th scope="col">{say('admin.invited-as')}</th>
                          <th scope="col">
                            {lapsed ? say('admin.lapsed-on') : say('admin.waiting-until')}
                          </th>
                          <th scope="col">
                            <span className={styles['hidden']}>{say('admin.actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((invitation) => (
                          <tr key={invitation.id}>
                            <td>{invitation.email}</td>
                            <td>
                              {invitation.external ? (
                                <Chip tone="info">{say('admin.from-outside')}</Chip>
                              ) : (
                                say('admin.member')
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
                                    label: say('admin.withdraw'),
                                    name: say('admin.withdraw-the-invitation-to', {
                                      email: invitation.email,
                                    }),
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
                  <p className={styles['muted']}>{say('admin.an-invitation-becomes-a-person-2')}</p>
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
      {erasing !== null && (
        <EraseDialog
          client={client}
          id={erasing.id}
          name={nameOf(erasing)}
          onClose={() => setErasing(null)}
          onErased={() => {
            setSaid(say('admin.erased-2', { value1: nameOf(erasing) }));
            setErasing(null);
            if (open?.person.id === erasing.id) setOpen(null);
            setGeneration((count) => count + 1);
          }}
        />
      )}
      {making && (
        <NewService
          client={client}
          onClose={() => setMaking(false)}
          onDone={(words) => {
            setMaking(false);
            setSaid(words);
            setFilter(say('admin.services'));
            setGeneration((count) => count + 1);
          }}
        />
      )}
      {disabling !== null && (
        <ConfirmDialog
          question={say('admin.disable-2', { value1: nameOf(disabling) })}
          sentence={say('admin.its-tokens-stop-working-at')}
          keep={say('admin.keep-it')}
          act={say('admin.disable')}
          onKeep={() => setDisabling(null)}
          onAct={() => disable(disabling)}
        />
      )}
      {withdrawing !== null && (
        <ConfirmDialog
          question={say('admin.withdraw-the-invitation-to-2', { email: withdrawing.email })}
          sentence={say('admin.everything-granted-to-them-goes')}
          keep={say('admin.keep-it')}
          act={say('admin.withdraw')}
          onKeep={() => setWithdrawing(null)}
          onAct={() => withdraw(withdrawing)}
        />
      )}
    </>
  );
}
