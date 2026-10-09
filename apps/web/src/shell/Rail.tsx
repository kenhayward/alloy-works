import { ModuleIcon } from './ModuleIcon.js';
import type { ModuleName } from './moduleOf.js';
import { MODULE_GROUPS } from './modules.js';
import { useLeftAt } from './places.js';
import styles from './Rail.module.css';

export interface RailProps {
  /** The module the page is in; null on Home. */
  readonly module: ModuleName | null;
}

/** Administration's start: its Overview. */
const ADMINISTRATION = '#/admin/overview';

/**
 * The labelled module rail on every screen (ADR-0046, decision 3): Home, then the modules grouped
 * Author, Publish and Data, and Admin at its foot, which opens Administration's page (ADR-0049). Each
 * a link reached by Tab; the one the page is in is `aria-current`. Each other module's link goes back
 * to where it was left, its page kept as it was (the workspace keeps it); the one the page is in starts
 * it over.
 */
export function Rail({ module }: RailProps) {
  const leftAt = useLeftAt();
  const administering = module === 'Administration';

  return (
    <nav className={styles['rail']} aria-label="Modules" data-app-region>
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
                href={each.name === module ? each.href : (leftAt.get(each.name) ?? each.href)}
                aria-current={module === each.name ? 'page' : undefined}
              >
                <ModuleIcon name={each.name} />
                <span className={styles['label']}>{each.name}</span>
              </a>
            </li>
          ))}
        </ul>
      ))}
      <a
        className={`${styles['item']} ${styles['foot']}`}
        href={administering ? ADMINISTRATION : (leftAt.get('Administration') ?? ADMINISTRATION)}
        title="Administration"
        aria-current={administering ? 'page' : undefined}
      >
        <ModuleIcon name="Admin" />
        <span className={styles['label']}>Admin</span>
      </a>
    </nav>
  );
}
