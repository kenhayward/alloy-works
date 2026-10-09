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

type Client = ReturnType<typeof createApiClient>;

/**
 * What the groups listing read: its rows, refused, signed out, or failed; null while it is first read.
 */
type Read = { readonly rows: readonly ShownGroup[] } | 'refused' | 'signedOut' | 'failed' | null;

const counted = (count: number) =>
  count === 0 ? 'no members' : count === 1 ? '1 member' : `${count} members`;
const Counted = (count: number) => counted(count).replace(/^n/, 'N');

/** A group's members in words: how many, and who, the first three named and the rest counted. */
const membersOf = (group: ShownGroup, named = group.members.length) => {
  if (group.members.length === 0) return 'No members';
  const names = group.members.slice(0, named).map(personName);
  const rest = group.members.length - names.length;
  return `${Counted(group.members.length)}: ${names.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
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
      setSaid('Give the group a name.');
      return;
    }
    setBusy(true);
    try {
      const providerValue = value.trim();
      const { data, error } = await client.POST('/v1/groups', {
        body: { name: trimmed, ...(providerValue === '' ? {} : { providerValue }) },
      });
      if (data) onMade(trimmed);
      else setSaid(refusal(error, 'The group could not be made.'));
    } catch {
      setSaid('The group could not be made.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy="new-group-heading" onClose={onClose}>
      <form className={styles['dialog']} onSubmit={(event) => void make(event)}>
        <h2 id="new-group-heading">New group</h2>
        <label>
          Name
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          {"Value from the organisation's sign-in"}
          <input value={value} maxLength={256} onChange={(event) => setValue(event.target.value)} />
        </label>
        <p className={styles['muted']}>
          Leave the value empty for a group whose members are chosen here. Given one, the group's
          members are whoever signs in with that value among their groups.
        </p>
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Make group
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
        setPeople('items' in answer && answer.items.every(isShownPerson) ? answer.items : 'failed');
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
      else setSaid(refusal(error, 'The members could not be set.'));
    } catch {
      setSaid('The members could not be set.');
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
      heading={`Members of ${group.name}`}
      description={
        Array.isArray(people) ? `${chosen.size} of ${people.length} people chosen` : undefined
      }
      icon="Members"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !Array.isArray(people)}
            onClick={() => void save()}
          >
            Save members
          </button>
        </>
      }
    >
      {people === null && <Waiting>Loading...</Waiting>}
      {people === 'failed' && (
        <Notice tone="failed">
          <p>The people could not be loaded.</p>
        </Notice>
      )}
      {Array.isArray(people) && (
        <>
          <input
            type="search"
            className={styles['search']}
            aria-label="Find a person"
            placeholder="Find a person"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <fieldset className={styles['members']}>
            <legend className={styles['hidden']}>Members</legend>
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
                <span className={styles['initials']} aria-hidden="true">
                  {initials(personName(person))}
                </span>{' '}
                {personName(person)}
                {person.name !== null && person.email !== null ? ` (${person.email})` : ''}
                {person.kind === 'external' && <span className={styles['muted']}> Outside</span>}
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
      if (data) setStatus(`Deleted the group ${group.name}, and everything granted to it.`);
      else if (response.status === 404) setStatus(`${group.name} had already been deleted.`);
      else setStatus(refusal(error, `${group.name} could not be deleted.`));
    } catch {
      setStatus(`${group.name} could not be deleted.`);
    }
    await load();
  };

  if (read === null) return <Waiting>Loading...</Waiting>;
  if (read === 'refused') {
    return (
      <Notice tone="refused">
        <p>You may not manage access here.</p>
      </Notice>
    );
  }
  if (read === 'signedOut') {
    // As the access panel says it.
    return (
      <Notice tone="signedOut">
        <p>You are signed out. Sign in again to manage access.</p>
      </Notice>
    );
  }
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>The groups could not be loaded.</p>
      </Notice>
    );
  }

  const shown = read.rows.filter((group) =>
    group.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div ref={holder} className={styles['holder']} tabIndex={-1}>
      <div className={styles['lead']}>
        <p>Grant to a group once, instead of to each person.</p>
        <button type="button" className="primary" onClick={() => setMaking(true)}>
          New group
        </button>
      </div>
      {read.rows.length === 0 ? (
        <Empty>
          <p>There are no groups yet.</p>
        </Empty>
      ) : (
        <>
          <div className={styles['toolbar']}>
            <input
              type="search"
              className={styles['search']}
              aria-label="Find a group"
              placeholder="Find a group"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p className={styles['counted']}>
              {`${shown.length} ${shown.length === 1 ? 'group' : 'groups'}`}
            </p>
          </div>
          <div className={filling === null ? undefined : styles['withPanel']}>
            <table aria-label="Groups" className={styles['table']}>
              <colgroup>
                <col />
                <col className={styles['fromColumn']} />
                <col className={styles['fromColumn']} />
                <col className={styles['actionsColumn']} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">From</th>
                  <th scope="col">Members</th>
                  <th scope="col">
                    <span className={styles['hidden']}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((group) => (
                  <tr key={group.id} data-current={filling?.id === group.id ? 'true' : undefined}>
                    <td className={styles['strong']}>{group.name}</td>
                    <td className={styles['muted']}>
                      {group.source === 'tenant' ? (
                        'This environment'
                      ) : (
                        <>
                          Sign-in, <code>{group.providerValue ?? ''}</code>
                        </>
                      )}
                    </td>
                    <td>
                      {group.members.length === 0 && group.source !== 'tenant' ? (
                        <span className={styles['muted']}>Filled at sign-in</span>
                      ) : (
                        <span className={styles['faces']}>
                          <span aria-hidden="true">
                            {group.members.slice(0, 3).map((member) => (
                              <span key={member.id} className={styles['initials']}>
                                {initials(personName(member))}
                              </span>
                            ))}{' '}
                            {group.members.length === 0 ? 'No members' : group.members.length}
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
                            label: 'Members',
                            name: `Members of ${group.name}`,
                            icon: 'Members',
                            onSelect: () => setFilling(group),
                            ...(group.source === 'tenant'
                              ? {}
                              : { unavailable: 'Filled by the sign-in provider' }),
                          },
                        ]}
                        more={[
                          { label: 'Delete', danger: true, onSelect: () => setDeleting(group) },
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
                  setStatus(`${filling.name} now has ${counted(count)}.`);
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
            setStatus(`Made the group ${name}.`);
            void load();
          }}
        />
      )}
      {deleting !== null && (
        <ConfirmDialog
          question={`Delete ${deleting.name}?`}
          sentence="Everything granted to this group is deleted with it, so its members lose whatever they held only through it."
          {...(deleting.members.length === 0 ? {} : { detail: membersOf(deleting, 3) })}
          keep="Keep it"
          act="Delete group"
          onKeep={() => setDeleting(null)}
          onAct={() => remove(deleting)}
        />
      )}
    </div>
  );
}
