import { createApiClient } from '@alloy-works/api-client';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Administration } from '../admin/Administration.js';
import { THEMES } from '../theme/themes.js';
import styles from './Header.module.css';
import type { ModuleName } from './moduleOf.js';

/** The mark, drawn for a dark ground; served beside the page from `public/`. */
export const MARK = 'mark-dark.svg';

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
  /** The module the page is in; null on Home, which is none. */
  readonly module: ModuleName | null;
  /** Given in tests; the browser's own otherwise. */
  readonly fetch?: typeof fetch;
  /** After the session has ended; the page reloads, signed out, unless a test says otherwise. */
  readonly onSignedOut?: () => void;
  /** What Administration's About holds beside the version. */
  readonly about?: React.ReactNode;
}

/**
 * A button and the menu it opens: open on click, closed by Escape (focus returning to the button),
 * by choosing, or by focus leaving it.
 */
function Menu({
  label,
  button,
  children,
}: {
  label: string;
  button: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
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
        className={styles['chip']}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {button}
      </button>
      {open && (
        <div className={`${styles['menu']} ${styles['end']}`} aria-label={label} role="group">
          {children(close)}
        </div>
      )}
    </div>
  );
}

/**
 * The band across the top of every screen, dark in every theme: the mark, which goes Home;
 * the module's name; then the environment and the account chip, which holds Sign out.
 */
export function Header({
  module,
  fetch: given,
  onSignedOut = () => window.location.reload(),
  about = null,
}: HeaderProps) {
  const origin = window.location.origin;
  const client = useMemo(
    () => createApiClient({ baseUrl: origin, ...(given ? { fetch: given } : {}) }),
    [origin, given],
  );
  const [environment, setEnvironment] = useState<string | undefined>();
  const [who, setWho] = useState<Person | 'nobody' | undefined>();
  const [administering, setAdministering] = useState(false);

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
      <a className={styles['brand']} href="#/">
        <img className={styles['mark']} src={MARK} alt="" width={18} height={18} />
        Alloy Works
      </a>
      {module !== null && (
        <>
          <span className={styles['hairline']} aria-hidden="true" />
          <span className={styles['module']}>{module}</span>
        </>
      )}
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
              <li>
                <button
                  type="button"
                  className={styles['item']}
                  onClick={() => {
                    close();
                    setAdministering(true);
                  }}
                >
                  Administration
                </button>
              </li>
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
      {administering && (
        <Administration client={client} about={about} onClose={() => setAdministering(false)} />
      )}
    </header>
  );
}
