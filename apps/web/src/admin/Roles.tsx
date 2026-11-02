import type { createApiClient } from '@alloy-works/api-client';
import { allowable, externalCap, permissions, type Permission } from '@alloy-works/domain';
import { useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { permissionName } from '../access/describe.js';
import { Modal } from '../layouts/Modal.js';
import { Chip } from '../parts/Chip.js';
import { Icon } from '../editor/Icon.js';
import styles from './Administration.module.css';
import { Shown, type Read } from './listing.js';
import { formats, words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

export interface RoleRow {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

/** People from outside the organisation are refused these, whatever they are granted (IAM-049). */
const outside = (): string =>
  words('admin.outside-refused', { permissions: formats().list(externalCap.map(permissionName)) });

/** Making a role: a name, and what it holds from every permission the domain knows. */
function NewRole({
  client,
  onMade,
  onClose,
}: {
  client: Client;
  onMade: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [held, setHeld] = useState<ReadonlySet<Permission>>(() => new Set<Permission>(['read']));
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const make = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setSaid(words('admin.give-the-role-a-name'));
      return;
    }
    if (held.size === 0) {
      setSaid(words('admin.choose-a-permission'));
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/roles', {
        // In the domain's order, whatever order they were ticked in.
        body: { name: trimmed, permissions: permissions.filter((each) => held.has(each)) },
      });
      if (data) onMade(trimmed);
      else setSaid(refusal(error, words('admin.the-role-could-not-be')));
    } catch {
      setSaid(words('admin.the-role-could-not-be'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (permission: Permission) => {
    const next = new Set(held);
    if (!next.delete(permission)) next.add(permission);
    setHeld(next);
  };

  return (
    <Modal labelledBy="new-role-heading" onClose={onClose}>
      <form className={styles['dialog']} onSubmit={(event) => void make(event)}>
        <h2 id="new-role-heading">{words('admin.new-role')}</h2>
        <label>
          {words('admin.name')}
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <fieldset className={styles['rolePermissions']}>
          <legend>{words('admin.role-holds')}</legend>
          {permissions.map((permission) => (
            <label key={permission}>
              <input
                type="checkbox"
                checked={held.has(permission)}
                onChange={() => toggle(permission)}
              />{' '}
              {permissionName(permission)}
            </label>
          ))}
        </fieldset>
        {!held.has('read') && <p className={styles['muted']}>{words('admin.role-without-read')}</p>}
        <p role="status">{said}</p>
        <div className={styles['actions']}>
          <button type="button" onClick={onClose}>
            {words('admin.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {words('admin.make-role')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Administration's Roles (ADR-0049, decision 7; the AD plan, AD-B): the environment's own roles by
 * every permission the domain knows, and a new one made here. A role that cannot be allowed
 * (`allowable`) is marked Deny only; the outside rule is the domain's own list, so neither is written
 * here.
 */
export function Roles({
  read,
  client,
  onMade,
}: {
  read: Read<RoleRow>;
  client: Client;
  onMade: () => void;
}) {
  const [query, setQuery] = useState('');
  const [making, setMaking] = useState(false);
  const [status, setStatus] = useState('');
  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.a-role-is-a-set')}</p>
        <button type="button" className="primary" onClick={() => setMaking(true)}>
          {words('admin.new-role')}
        </button>
      </div>
      <p role="status" className={styles['muted']}>
        {status}
      </p>
      {making && (
        <NewRole
          client={client}
          onClose={() => setMaking(false)}
          onMade={(name) => {
            setMaking(false);
            setStatus(words('admin.made-the-role', { name }));
            onMade();
          }}
        />
      )}
      <Shown read={read} failed={words('admin.the-roles-could-not-be-loaded')}>
        {(rows) => {
          const shown = rows.filter((role) =>
            role.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
          );
          return (
            <>
              <div className={styles['toolbar']}>
                <input
                  type="search"
                  className={styles['search']}
                  aria-label={words('admin.find-a-role')}
                  placeholder={words('admin.find-a-role')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <p className={styles['counted']}>
                  <span className={styles['holds']} aria-hidden="true">
                    <Icon name="Done editing" />
                  </span>{' '}
                  {words('admin.holds-the-permission')}{' '}
                  {words('admin.permissions', {
                    roles: rows.length,
                    permissions: permissions.length,
                  })}
                </p>
              </div>
              {/* Scrolled sideways where the window is narrower than the grid, so reached by keyboard too. */}
              <div
                className={styles['scroller']}
                role="region"
                aria-label={words('admin.roles-by-permission')}
                tabIndex={0}
              >
                <table
                  aria-label={words('admin.roles')}
                  className={`${styles['table']} ${styles['grid']}`}
                >
                  <thead>
                    <tr>
                      <th scope="col" className={styles['roleColumn']}>
                        {words('admin.role')}
                      </th>
                      {permissions.map((permission) => (
                        <th key={permission} scope="col">
                          {permissionName(permission)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((role) => (
                      <tr key={role.id}>
                        <th scope="row">
                          <span data-content>{role.name}</span>
                          {!allowable(role.permissions as Permission[]) && (
                            <>
                              {' '}
                              <Chip tone="warn">{words('admin.deny-only')}</Chip>
                            </>
                          )}
                        </th>
                        {permissions.map((permission) => (
                          <td key={permission}>
                            {role.permissions.includes(permission) && (
                              <span className={styles['holds']}>
                                <Icon name="Done editing" />
                                <span className={styles['hidden']}>{words('admin.holds')}</span>
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles['muted']}>{outside()}</p>
            </>
          );
        }}
      </Shown>
    </>
  );
}
