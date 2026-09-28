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
import { Empty } from '../states/Empty.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import styles from './Administration.module.css';

type Client = ReturnType<typeof createApiClient>;

/**
 * What the groups listing read: its rows, refused, signed out, or failed; null while it is first read.
 */
type Read = { readonly rows: readonly ShownGroup[] } | 'refused' | 'signedOut' | 'failed' | null;

/** Where a group's members come from, as a person reads it. */
const sourceOf = (group: ShownGroup) =>
  group.source === 'tenant'
    ? 'This environment'
    : `The organisation's sign-in, as ${group.providerValue ?? ''}`;

const membersOf = (group: ShownGroup) =>
  group.members.length === 0 ? 'Nobody' : group.members.map(personName).join(', ');

const counted = (count: number) =>
  count === 0 ? 'no members' : count === 1 ? '1 member' : `${count} members`;

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

  return (
    <Modal labelledBy="group-members-heading" onClose={onClose}>
      <div className={styles['dialog']}>
        <h2 id="group-members-heading">{`Members of ${group.name}`}</h2>
        {people === null && <Waiting>Loading...</Waiting>}
        {people === 'failed' && (
          <Notice tone="failed">
            <p>The people could not be loaded.</p>
          </Notice>
        )}
        {Array.isArray(people) && (
          <fieldset className={styles['members']}>
            <legend>Members</legend>
            {people.map((person) => (
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
                {personName(person)}
                {person.name !== null && person.email !== null ? ` (${person.email})` : ''}
              </label>
            ))}
          </fieldset>
        )}
        <p role="status">{said}</p>
        <div className={styles['actions']}>
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
        </div>
      </div>
    </Modal>
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

  return (
    <div ref={holder} className={styles['holder']} tabIndex={-1}>
      <p>
        A group holds roles as a person does. The environment's own groups have the members chosen
        here; a group from the organisation's sign-in has whoever signs in with its value.
      </p>
      <p>
        <button type="button" className="primary" onClick={() => setMaking(true)}>
          New group
        </button>
      </p>
      {read.rows.length === 0 ? (
        <Empty>
          <p>There are no groups yet.</p>
        </Empty>
      ) : (
        <table aria-label="Groups">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">From</th>
              <th scope="col">Members</th>
              <th scope="col">
                <span className={styles['hidden']}>Change</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {read.rows.map((group) => (
              <tr key={group.id}>
                <td className={styles['strong']}>{group.name}</td>
                <td className={styles['muted']}>{sourceOf(group)}</td>
                <td>{membersOf(group)}</td>
                <td className={styles['act']}>
                  {group.source === 'tenant' && (
                    <>
                      <button
                        type="button"
                        aria-label={`Members of ${group.name}`}
                        onClick={() => setFilling(group)}
                      >
                        Members
                      </button>{' '}
                    </>
                  )}
                  <button
                    type="button"
                    className="danger"
                    aria-label={`Delete ${group.name}`}
                    onClick={() => setDeleting(group)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      {filling !== null && (
        <Members
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
      {deleting !== null && (
        <Modal labelledBy="delete-group-heading" onClose={() => setDeleting(null)}>
          <section aria-labelledby="delete-group-heading" className={styles['dialog']}>
            <h2 id="delete-group-heading">{`Delete ${deleting.name}?`}</h2>
            <p>
              Everything granted to this group is deleted with it, so its members lose whatever they
              held only through it.
            </p>
            <div className={styles['actions']}>
              <button type="button" onClick={() => setDeleting(null)}>
                Keep it
              </button>
              <button type="button" className="danger" onClick={() => void remove(deleting)}>
                Delete group
              </button>
            </div>
          </section>
        </Modal>
      )}
    </div>
  );
}
