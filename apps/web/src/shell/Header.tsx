import { createApiClient } from '@alloy-works/api-client';
import { useEffect, useMemo, useRef, useState } from 'react';

import { THEMES } from '../theme/themes.js';
import styles from './Header.module.css';
import type { ModuleName } from './moduleOf.js';

/** The mark, drawn for a dark ground; served beside the page from `public/`. */
export const MARK = 'mark-dark.svg';

/** Where the switcher can take a person: each module's own list. */
const MODULES: readonly { readonly name: ModuleName; readonly href: string }[] = [
  { name: 'Components', href: '#/' },
  { name: 'Documents', href: '#/documents' },
  { name: 'Publications', href: '#/publications' },
];

interface Person {
  readonly displayName: string | null;
  readonly email: string | null;
}

/** One or two letters for the account chip: the first and last words of a name, else the address. */
export function initialsOf({ displayName, email }: Person): string {
  const words = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  if (first) return `${first[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
  return email?.[0]?.toUpperCase() ?? '?';
}

export interface HeaderProps {
  readonly module: ModuleName;
  /** Given in tests; the browser's own otherwise. */
  readonly fetch?: typeof fetch;
  /** After the session has ended; the page reloads, signed out, unless a test says otherwise. */
  readonly onSignedOut?: () => void;
}

/**
 * A button and the menu it opens: open on click, closed by Escape (focus returning to the button),
 * by choosing, or by focus leaving it.
 */
function Menu({
  label,
  button,
  children,
  align,
}: {
  label: string;
  button: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  return (
    <div
      className={styles['menuHolder']}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles[label === 'Modules' ? 'brand' : 'chip']}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {button}
      </button>
      {open && (
        <div className={`${styles['menu']} ${styles[align]}`} aria-label={label} role="group">
          {children(close)}
        </div>
      )}
    </div>
  );
}

/**
 * The band across the top of every screen, dark in every theme: the mark, which switches module;
 * the module's name; then the environment and the account chip, which holds Sign out.
 */
export function Header({
  module,
  fetch: given,
  onSignedOut = () => window.location.reload(),
}: HeaderProps) {
  const origin = window.location.origin;
  const client = useMemo(
    () => createApiClient({ baseUrl: origin, ...(given ? { fetch: given } : {}) }),
    [origin, given],
  );
  const [environment, setEnvironment] = useState<string | undefined>();
  const [who, setWho] = useState<Person | 'nobody' | undefined>();

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/tenant')
      .then(({ data }) => {
        if (current && data) setEnvironment(data.name);
      })
      .catch(() => undefined);
    client
      .GET('/v1/me')
      .then(({ data, response }) => {
        if (!current) return;
        if (data) setWho({ displayName: data.displayName ?? null, email: data.email ?? null });
        else if (response.status === 401) setWho('nobody');
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  const signOut = async () => {
    await client.POST('/v1/sign-out');
    onSignedOut();
  };

  return (
    <header className={styles['band']}>
      <Menu
        label="Modules"
        align="start"
        button={
          <>
            <img className={styles['mark']} src={MARK} alt="" width={18} height={18} />
            Alloy Works
          </>
        }
      >
        {(close) => (
          <ul className={styles['items']}>
            {MODULES.map((each) => (
              <li key={each.name}>
                <a
                  className={styles['item']}
                  href={each.href}
                  data-module={each.name}
                  aria-current={each.name === module ? 'page' : undefined}
                  onClick={close}
                >
                  <span className={styles['dot']} aria-hidden="true" />
                  {each.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Menu>
      <span className={styles['hairline']} aria-hidden="true" />
      <span className={styles['module']}>{module}</span>
      <span className={styles['spacer']} />
      {environment !== undefined && <span className={styles['environment']}>{environment}</span>}
      {who === 'nobody' && (
        <a className={styles['chip']} href="/v1/sign-in/organisation">
          Sign in
        </a>
      )}
      {who !== undefined && who !== 'nobody' && (
        <Menu
          label="Account"
          align="end"
          button={
            <>
              <span className={styles['initials']} aria-hidden="true">
                {initialsOf(who)}
              </span>
              {who.displayName ?? who.email ?? 'Signed in'}
            </>
          }
        >
          {(close) => (
            <ul className={styles['items']}>
              {THEMES.length > 1 && (
                <li>
                  <button type="button" className={styles['item']} onClick={close}>
                    Theme
                  </button>
                </li>
              )}
              <li>
                <button
                  type="button"
                  className={styles['item']}
                  onClick={() => {
                    close();
                    void signOut();
                  }}
                >
                  Sign out
                </button>
              </li>
            </ul>
          )}
        </Menu>
      )}
    </header>
  );
}
