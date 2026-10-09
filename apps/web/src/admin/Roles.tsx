import { allowable, externalCap, permissions, type Permission } from '@alloy-works/domain';
import { useState } from 'react';

import { permissionName } from '../access/describe.js';
import { Chip } from '../parts/Chip.js';
import { Icon } from '../editor/Icon.js';
import styles from './Administration.module.css';
import { Shown, type Read } from './listing.js';

export interface RoleRow {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

/** People from outside the organisation are refused these, whatever they are granted (IAM-049). */
const OUTSIDE = `People from outside the organisation are refused ${externalCap
  .map(permissionName)
  .join(', ')
  .replace(/, ([^,]+)$/, ' and $1')}, whatever their roles say.`;

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
        <p>
          A role is a set of permissions. It does nothing until it is granted somewhere, to someone.
        </p>
      </div>
      <Shown read={read} failed="The roles could not be loaded.">
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
                  aria-label="Find a role"
                  placeholder="Find a role"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <p className={styles['counted']}>
                  <span className={styles['holds']} aria-hidden="true">
                    <Icon name="Done editing" />
                  </span>{' '}
                  holds the permission{' '}
                  {`${rows.length} ${rows.length === 1 ? 'role' : 'roles'}, ${permissions.length} permissions`}
                </p>
              </div>
              {/* Scrolled sideways where the window is narrower than the grid, so reached by keyboard too. */}
              <div
                className={styles['scroller']}
                role="region"
                aria-label="Roles by permission"
                tabIndex={0}
              >
                <table aria-label="Roles" className={`${styles['table']} ${styles['grid']}`}>
                  <thead>
                    <tr>
                      <th scope="col" className={styles['roleColumn']}>
                        Role
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
                          {role.name}
                          {!allowable(role.permissions as Permission[]) && (
                            <>
                              {' '}
                              <Chip tone="warn">Deny only</Chip>
                            </>
                          )}
                        </th>
                        {permissions.map((permission) => (
                          <td key={permission}>
                            {role.permissions.includes(permission) && (
                              <span className={styles['holds']}>
                                <Icon name="Done editing" />
                                <span className={styles['hidden']}>Holds</span>
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles['muted']}>{OUTSIDE}</p>
            </>
          );
        }}
      </Shown>
    </>
  );
}
