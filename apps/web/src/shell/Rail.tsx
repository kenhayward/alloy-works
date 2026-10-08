import { createApiClient } from '@alloy-works/api-client';
import { useMemo, useRef, useState } from 'react';

import { Administration } from '../admin/Administration.js';
import { ModuleIcon } from './ModuleIcon.js';
import type { ModuleName } from './moduleOf.js';
import { MODULE_GROUPS } from './modules.js';
import styles from './Rail.module.css';

export interface RailProps {
  /** The module the page is in; null on Home. */
  readonly module: ModuleName | null;
  /** Given in tests; the browser's own otherwise. */
  readonly fetch?: typeof fetch;
  /** What Administration's About holds beside the version. */
  readonly about?: React.ReactNode;
}

/**
 * The labelled module rail on every screen (ADR-0046, decision 3): Home, then the modules grouped
 * Author, Publish and Data, and Admin at its foot, which opens Administration. Each a link or a
 * button reached by Tab; the one the page is in is `aria-current`.
 */
export function Rail({ module, fetch: given, about = null }: RailProps) {
  const origin = window.location.origin;
  const client = useMemo(
    () => createApiClient({ baseUrl: origin, ...(given ? { fetch: given } : {}) }),
    [origin, given],
  );
  const [administering, setAdministering] = useState(false);
  const admin = useRef<HTMLButtonElement>(null);

  return (
    <nav className={styles['rail']} aria-label="Modules">
      <a className={styles['item']} href="#/" aria-current={module === null ? 'page' : undefined}>
        <ModuleIcon name="Home" />
        <span className={styles['label']}>Home</span>
      </a>
      {MODULE_GROUPS.map(({ group, modules }) => (
        <ul key={group} className={styles['group']} aria-label={group}>
          {modules.map((each) => (
            <li key={each.name}>
              <a
                className={styles['item']}
                href={each.href}
                aria-current={module === each.name ? 'page' : undefined}
              >
                <ModuleIcon name={each.name} />
                <span className={styles['label']}>{each.name}</span>
              </a>
            </li>
          ))}
        </ul>
      ))}
      <button
        ref={admin}
        type="button"
        className={`${styles['item']} ${styles['foot']}`}
        title="Administration"
        onClick={() => setAdministering(true)}
      >
        <ModuleIcon name="Admin" />
        <span className={styles['label']}>Admin</span>
      </button>
      {administering && (
        <Administration
          client={client}
          about={about}
          onClose={() => {
            setAdministering(false);
            admin.current?.focus();
          }}
        />
      )}
    </nav>
  );
}
