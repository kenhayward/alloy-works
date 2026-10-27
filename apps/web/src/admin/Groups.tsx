import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import {
  isShownGroup,
  isShownPerson,
  personName,
  type ShownGroup,
  type ShownPerson,
} from '../access/describe.js';
import { Modal } from '../layouts/Modal.js';
import { everyPage } from '../paging.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import { RowActions } from '../parts/RowActions.js';
import { SidePanel } from '../parts/SidePanel.js';
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';
import { formats, words, wordsWith } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * What the groups listing read: its rows, refused, signed out, or failed; null while it is first read.
 */
type Read = { readonly rows: readonly ShownGroup[] } | 'refused' | 'signedOut' | 'failed' | null;

/** A group's members in words: how many, and who, the first three named and the rest counted. */
const membersOf = (group: ShownGroup, named = group.members.length) => {
  if (group.members.length === 0) return words('admin.no-members-2');
  const names = group.members.slice(0, named).map(personName);
  const rest = group.members.length - names.length;
  const values = {
    count: group.members.length,
    names: formats().list(names, { type: 'unit' }),
    rest,
  };
  return rest > 0
    ? words('admin.members-named-more', values)
    : words('admin.members-named', values);
};

const initials = (name: string) =>
  name
    .split(/[\s.@]+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

/**
 * Making a group (access.md, "Groups and Access, as W12 builds them"): a name, and optionally the value
 * of the organisation's sign-in claim it stands for, which makes its members the sign-in's to decide.
 */
function NewGroup({
  client,
  onMade,
  onClose,
}: {
  client: Client;
  onMade: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const make = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setSaid(words('admin.give-the-group-a-name'));
      return;
    }
    setBusy(true);
    try {
      const providerValue = value.trim();
      const { data, error } = await client.POST('/v1/groups', {
        body: { name: trimmed, ...(providerValue === '' ? {} : { providerValue }) },
      });
      if (data) onMade(trimmed);
      else setSaid(refusal(error, words('admin.the-group-could-not-be')));
    } catch {
      setSaid(words('admin.the-group-could-not-be'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy="new-group-heading" onClose={onClose}>
      <form className={styles['dialog']} onSubmit={(event) => void make(event)}>
        <h2 id="new-group-heading">{words('admin.new-group')}</h2>
        <label>
          {words('admin.name')}
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          {words('admin.value-from-the-organisation-s')}
          <input value={value} maxLength={256} onChange={(event) => setValue(event.target.value)} />
        </label>
        <p className={styles['muted']}>{words('admin.leave-the-value-empty-for')}</p>
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {words('admin.make-group')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Choosing the members of one of the environment's own groups from everybody it holds. */
function Members({
  client,
  group,
  onSet,
  onClose,
}: {
  client: Client;
  group: ShownGroup;
  onSet: (count: number) => void;
  onClose: () => void;
}) {
  const [people, setPeople] = useState<readonly ShownPerson[] | 'failed' | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(group.members.map((member) => member.id)),
  );
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let current = true;
    everyPage<ShownPerson>((cursor) =>
      client.GET('/v1/principals', {
        params: { query: { level: 'tenant', ...(cursor ? { cursor } : {}) } },
      }),
    )
      .then((answer) => {
        if (!current) return;
        // Nobody erased joins a group again (the ER final review, M3).
        setPeople(
          'items' in answer && answer.items.every(isShownPerson)
            ? answer.items.filter((each) => each.erased !== true)
            : 'failed',
        );
      })
      .catch(() => {
        if (current) setPeople('failed');
      });
    return () => {
      current = false;
    };
  }, [client]);

  const save = async () => {
    if (people === null || people === 'failed') return;
    setBusy(true);
    // In the order the people are listed, each once.
    const principals = people.filter((each) => chosen.has(each.id)).map((each) => each.id);
    try {
      const { data, error } = await client.PUT('/v1/groups/{id}/members', {
        params: { path: { id: group.id } },
        body: { principals },
      });
      if (data) onSet(principals.length);
      else setSaid(refusal(error, words('admin.the-members-could-not-be')));
    } catch {
      setSaid(words('admin.the-members-could-not-be'));
    } finally {
      setBusy(false);
    }
  };

  const listed = Array.isArray(people)
    ? people.filter((person) =>
        `${person.name ?? ''} ${person.email ?? ''}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      )
    : [];
  return (
    <SidePanel
      heading={words('admin.members-of', { name: group.name })}
      description={
        Array.isArray(people)
          ? words('admin.of-people-chosen', { chosen: chosen.size, people: people.length })
          : undefined
      }
      icon="Members"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !Array.isArray(people)}
            onClick={() => void save()}
          >
            {words('admin.save-members')}
          </button>
        </>
      }
    >
      {people === null && <Waiting>{words('admin.loading')}</Waiting>}
      {people === 'failed' && (
        <Notice tone="failed">
          <p>{words('admin.the-people-could-not-be')}</p>
        </Notice>
      )}
      {Array.isArray(people) && (
        <>
          <input
            type="search"
            className={styles['search']}
            aria-label={words('admin.find-a-person')}
            placeholder={words('admin.find-a-person')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <fieldset className={styles['members']}>
            <legend className={styles['hidden']}>{words('admin.members-2')}</legend>
            {listed.map((person) => (
              <label key={person.id}>
                <input
                  type="checkbox"
                  checked={chosen.has(person.id)}
                  onChange={(event) =>
                    setChosen((was) => {
                      const next = new Set(was);
                      if (event.target.checked) next.add(person.id);
                      else next.delete(person.id);
                      return next;
                    })
                  }
                />{' '}
                <span className={styles['initials']} aria-hidden="true" data-content>
                  {initials(personName(person))}
                </span>{' '}
                {person.name !== null && person.email !== null
                  ? words('admin.person-with-email', { name: person.name, email: person.email })
                  : personName(person)}
                {person.kind === 'external' && (
                  <span className={styles['muted']}> {words('admin.outside-2')}</span>
                )}
              </label>
            ))}
          </fieldset>
        </>
      )}
      <p role="status">{said}</p>
    </SidePanel>
  );
}

/**
 * Administration's Groups (access.md, "Groups and Access, as W12 builds them"): every group, where its
 * members come from and who they are; a group made; the environment's own group's members chosen from
 * its people, where a group from the organisation's sign-in shows its members and nothing to change
 * them with; and a group deleted after asking, its grants with it. The list is read again after each
 * change, in place, so the button a dialog was opened from is still there to take focus back.
 */
export function Groups({ client }: { client: Client }) {
  const [read, setRead] = useState<Read>(null);
  const [making, setMaking] = useState(false);
  const [filling, setFilling] = useState<ShownGroup | null>(null);
  const [deleting, setDeleting] = useState<ShownGroup | null>(null);
  const [status, setStatus] = useState('');
  const [changed, setChanged] = useState(0);
  const [query, setQuery] = useState('');
  const holder = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const answer = await everyPage<ShownGroup>((cursor) =>
        client.GET('/v1/groups', {
          params: { query: { limit: '100', ...(cursor ? { cursor } : {}) } },
        }),
      );
      if (!mounted.current) return;
      if ('items' in answer) {
        setRead(answer.items.every(isShownGroup) ? { rows: answer.items } : 'failed');
      } else {
        setRead(answer.status === 403 ? 'refused' : answer.status === 401 ? 'signedOut' : 'failed');
      }
    } catch {
      if (mounted.current) setRead('failed');
    }
    if (mounted.current) setChanged((count) => count + 1);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // A group deleted takes its row, and the Delete button that had focus, with it: focus stays with the
  // list rather than falling out of Administration, where Escape would not close it.
  useEffect(() => {
    const active = document.activeElement;
    if (changed > 0 && (active === null || active === document.body || !active.isConnected)) {
      holder.current?.focus();
    }
  }, [changed]);

  const remove = async (group: ShownGroup) => {
    setDeleting(null);
    try {
      const { data, error, response } = await client.DELETE('/v1/groups/{id}', {
        params: { path: { id: group.id } },
      });
      if (data) setStatus(words('admin.deleted-the-group-and-everything', { name: group.name }));
      else if (response.status === 404)
        setStatus(words('admin.had-already-been-deleted', { name: group.name }));
      else setStatus(refusal(error, words('admin.could-not-be-deleted', { name: group.name })));
    } catch {
      setStatus(words('admin.could-not-be-deleted', { name: group.name }));
    }
    await load();
  };

  if (read === null) return <Waiting>{words('admin.loading')}</Waiting>;
  if (read === 'refused') {
    return (
      <Notice tone="refused">
        <p>{words('admin.you-may-not-manage-access')}</p>
      </Notice>
    );
  }
  if (read === 'signedOut') {
    // As the access panel says it.
    return (
      <Notice tone="signedOut">
        <p>{words('admin.you-are-signed-out-sign-2')}</p>
      </Notice>
    );
  }
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>{words('admin.the-groups-could-not-be')}</p>
      </Notice>
    );
  }

  const shown = read.rows.filter((group) =>
    group.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div ref={holder} className={styles['holder']} tabIndex={-1}>
      <div className={styles['lead']}>
        <p>{words('admin.grant-to-a-group-once')}</p>
        <button type="button" className="primary" onClick={() => setMaking(true)}>
          {words('admin.new-group')}
        </button>
      </div>
      {read.rows.length === 0 ? (
        <Empty>
          <p>{words('admin.there-are-no-groups-yet')}</p>
        </Empty>
      ) : (
        <>
          <div className={styles['toolbar']}>
            <input
              type="search"
              className={styles['search']}
              aria-label={words('admin.find-a-group')}
              placeholder={words('admin.find-a-group')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p className={styles['counted']}>{words('admin.groups-2', { count: shown.length })}</p>
          </div>
          <div className={filling === null ? undefined : styles['withPanel']}>
            <table aria-label={words('admin.groups')} className={styles['table']}>
              <colgroup>
                <col />
                <col className={styles['fromColumn']} />
                <col className={styles['fromColumn']} />
                <col className={styles['actionsColumn']} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">{words('admin.name')}</th>
                  <th scope="col">{words('admin.from')}</th>
                  <th scope="col">{words('admin.members-2')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{words('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((group) => (
                  <tr key={group.id} data-current={filling?.id === group.id ? 'true' : undefined}>
                    <td className={styles['strong']} data-content>
                      {group.name}
                    </td>
                    <td className={styles['muted']}>
                      {group.source === 'tenant'
                        ? words('admin.this-environment')
                        : wordsWith(
                            'admin.sign-in',
                            {},
                            { value: <code data-content>{group.providerValue ?? ''}</code> },
                          )}
                    </td>
                    <td>
                      {group.members.length === 0 && group.source !== 'tenant' ? (
                        <span className={styles['muted']}>{words('admin.filled-at-sign-in')}</span>
                      ) : (
                        <span className={styles['faces']}>
                          <span aria-hidden="true">
                            {group.members.slice(0, 3).map((member) => (
                              <span key={member.id} className={styles['initials']} data-content>
                                {initials(personName(member))}
                              </span>
                            ))}{' '}
                            {group.members.length === 0
                              ? words('admin.no-members-2')
                              : formats().number(group.members.length)}
                          </span>
                          <span className={styles['hidden']}>{membersOf(group)}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      <RowActions
                        subject={group.name}
                        shown={[
                          {
                            label: words('admin.members-2'),
                            name: words('admin.members-of', { name: group.name }),
                            icon: 'Members',
                            onSelect: () => setFilling(group),
                            ...(group.source === 'tenant'
                              ? {}
                              : { unavailable: words('admin.filled-by-the-sign-in') }),
                          },
                        ]}
                        more={[
                          {
                            label: words('admin.delete'),
                            danger: true,
                            onSelect: () => setDeleting(group),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filling !== null && (
              <Members
                key={filling.id}
                client={client}
                group={filling}
                onClose={() => setFilling(null)}
                onSet={(count) => {
                  setStatus(words('admin.now-has', { name: filling.name, count }));
                  setFilling(null);
                  void load();
                }}
              />
            )}
          </div>
        </>
      )}
      <p role="status">{status}</p>
      {making && (
        <NewGroup
          client={client}
          onClose={() => setMaking(false)}
          onMade={(name) => {
            setMaking(false);
            setStatus(words('admin.made-the-group', { name }));
            void load();
          }}
        />
      )}
      {deleting !== null && (
        <ConfirmDialog
          question={words('admin.delete-2', { name: deleting.name })}
          sentence={words('admin.everything-granted-to-this-group')}
          {...(deleting.members.length === 0 ? {} : { detail: membersOf(deleting, 3) })}
          keep={words('admin.keep-it')}
          act={words('admin.delete-group')}
          onKeep={() => setDeleting(null)}
          onAct={() => remove(deleting)}
        />
      )}
    </div>
  );
}
