import { allowable, externalCap, permissions, type Permission } from '@alloy-works/domain';
import { useState } from 'react';

import { permissionName } from '../access/describe.js';
import { Chip } from '../parts/Chip.js';
import { Icon } from '../editor/Icon.js';
import styles from './Administration.module.css';
import { Shown, type Read } from './listing.js';
import { formats, words } from '../words/words.js';

export interface RoleRow {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

/** People from outside the organisation are refused these, whatever they are granted (IAM-049). */
const outside = (): string =>
  words('admin.outside-refused', { permissions: formats().list(externalCap.map(permissionName)) });

/**
 * Administration's Roles (ADR-0049, decision 7; the AD plan, AD-B): the environment's own roles - a
 * tenant may rename or change them - by every permission the domain knows, read only, as the product
 * is today. A role that cannot be allowed (`allowable`) is marked Deny only; the outside rule is the
 * domain's own list, so neither is written here.
 */
export function Roles({ read }: { read: Read<RoleRow> }) {
  const [query, setQuery] = useState('');
  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.a-role-is-a-set')}</p>
      </div>
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
