import { NameTip } from '../parts/NameTip.js';
import { goToTargets } from './commands/registry.js';
import { useGoToKeysOn } from './commands/useGoToKeys.js';
import { MARKS } from './marks.js';
import { ModuleIcon } from './ModuleIcon.js';
import type { ModuleName } from './moduleOf.js';
import { MODULE_GROUPS, groupWords, moduleWords } from './modules.js';
import { useLeftAt } from './places.js';
import styles from './Rail.module.css';
import { words } from '../words/words.js';

export interface RailProps {
  /** The module the page is in; null on Home. */
  readonly module: ModuleName | null;
  /** The environment's name, whose first letters stand in a chip under the mark. */
  readonly environment?: string | undefined;
}

/** Administration's start: its Overview. */
const ADMINISTRATION = '#/admin/overview';

/** The places Admin holds: on the rail, each of them is Admin (ADR-0075). */
const IN_ADMIN: ReadonlySet<ModuleName> = new Set([
  'Administration',
  'Connections',
  'Query definitions',
]);

/** A chip's letters: `Development` is `DEV`. The full name is its tooltip. */
const chipOf = (environment: string): string => environment.slice(0, 3).toUpperCase();

/**
 * The module rail on every screen (ADR-0075): the mark and the environment, Home, the modules in their
 * groups, and Admin at its foot. Each is an icon link named in words, its name and go-to keys shown at
 * once on hover and focus; the one the page is in is `aria-current`. Each other module's link goes back
 * to where it was left, its page kept as it was (the workspace keeps it); the one the page is in starts
 * it over.
 */
export function Rail({ module, environment }: RailProps) {
  const leftAt = useLeftAt();
  const [goToOn] = useGoToKeysOn();
  const administering = module !== null && IN_ADMIN.has(module);
  const letterOf = (href: string) => goToTargets().find((each) => each.href === href)?.letter;
  const keysOf = (href: string) => {
    const letter = letterOf(href);
    return goToOn && letter !== undefined ? `G ${letter.toUpperCase()}` : undefined;
  };
  const entry = (
    name: string,
    icon: React.ComponentProps<typeof ModuleIcon>['name'],
    start: string,
    href: string,
    current: boolean,
  ) => (
    <NameTip name={name} keys={keysOf(start)}>
      <a
        className={styles['item']}
        href={href}
        aria-label={name}
        aria-current={current ? 'page' : undefined}
        data-go-to={letterOf(start)}
      >
        <ModuleIcon name={icon} />
      </a>
    </NameTip>
  );

  return (
    <nav className={styles['rail']} aria-label={words('shell.modules')} data-app-region data-nav-rail>
      <NameTip name={words('shell.product')}>
        <a className={styles['brand']} href="#/" aria-label={words('shell.product')}>
          <img
            className={`${styles['mark']} ${styles['onLight']}`}
            src={MARKS.light}
            alt=""
            width={24}
            height={24}
          />
          <img
            className={`${styles['mark']} ${styles['onDark']}`}
            src={MARKS.dark}
            alt=""
            width={24}
            height={24}
          />
        </a>
      </NameTip>
      {environment !== undefined && (
        <NameTip name={environment}>
          <span
            className={styles['environment']}
            aria-label={environment}
            role="img"
            tabIndex={0}
            data-content
          >
            {chipOf(environment)}
          </span>
        </NameTip>
      )}
      {entry(words('shell.home'), 'Home', '#/', '#/', module === null)}
      {MODULE_GROUPS.map(({ group, modules }) => (
        <ul key={group} className={styles['group']} aria-label={groupWords(group)}>
          {modules.map((each) => (
            <li key={each.name}>
              {entry(
                moduleWords(each.name),
                each.name,
                each.href,
                each.name === module ? each.href : (leftAt.get(each.name) ?? each.href),
                module === each.name,
              )}
            </li>
          ))}
        </ul>
      ))}
      <div className={styles['foot']}>
        {entry(
          words('shell.administration'),
          'Admin',
          ADMINISTRATION,
          module === 'Administration'
            ? ADMINISTRATION
            : (leftAt.get('Administration') ?? ADMINISTRATION),
          administering,
        )}
      </div>
    </nav>
  );
}
