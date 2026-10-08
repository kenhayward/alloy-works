import { createApiClient } from '@alloy-works/api-client';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ApiTokens } from '../account/ApiTokens.js';
import { forgetEditing, keepEditingAgain } from '../editor/editing-storage.js';
import { THEME_CHOICES, useThemeChoice, type ThemeName } from '../theme/themes.js';
import styles from './Header.module.css';

/** The mark for each theme's ground, served beside the page from `public/`; CSS shows the one that fits. */
export const MARKS: Record<ThemeName, string> = {
  light: 'mark-light.svg',
  dark: 'mark-dark.svg',
};

const CHOICE_NAMES = { light: 'Light', dark: 'Dark', auto: 'Auto' } as const;

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
  /** Opens search and commands, as Ctrl K does. */
  readonly onSearch?: () => void;
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
  named,
  children,
}: {
  label: string;
  button: React.ReactNode;
  /** The button's name, where it shows an icon rather than words. */
  named?: string;
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
        className={named === undefined ? styles['chip'] : styles['iconButton']}
        aria-expanded={open}
        aria-label={named}
        title={named}
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

/** Light, Dark or Auto (ADR-0046), from the header's own button; the choice is kept on this device. */
function ThemeMenu() {
  const [choice, choose] = useThemeChoice();
  return (
    <Menu
      label="Theme"
      named="Theme"
      button={
        <svg
          className={styles['icon']}
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" />
        </svg>
      }
    >
      {(close) => (
        <ul className={styles['items']}>
          {THEME_CHOICES.map((each) => (
            <li key={each}>
              <button
                type="button"
                className={styles['item']}
                aria-pressed={choice === each}
                onClick={() => {
                  choose(each);
                  close();
                }}
              >
                {CHOICE_NAMES[each]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Menu>
  );
}

/**
 * The band across the top of every screen, in the theme's chrome (ADR-0046): the mark, which goes
 * Home, and the environment; search and commands in the middle; then the Theme button and the
 * account chip, which holds API tokens and Sign out. The module the page is in is the rail's to say.
 */
export function Header({
  onSearch = () => undefined,
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
  const [managingTokens, setManagingTokens] = useState(false);

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

  /** Whether the service says nobody is signed in: false where it says somebody is, or says nothing. */
  const nobodySignedIn = async () => {
    try {
      const { response } = await client.GET('/v1/me');
      return response.status === 401;
    } catch {
      return false;
    }
  };

  const signOut = async () => {
    // What the editor keeps in this window for a reload is the author's alone: nobody who signs in
    // on the same tab after them is given it (final review of W11.3, D2).
    forgetEditing();
    // Signed out where the service says so - ended now, or there was no session to end - or where,
    // with no answer to the sign-out itself, it says nobody is signed in.
    let ended = false;
    try {
      const { response } = await client.POST('/v1/sign-out');
      ended = response.ok || response.status === 401;
    } catch {
      // No answer: asked below whether the author is signed in still.
    } finally {
      if (!ended) ended = await nobodySignedIn();
    }
    if (ended) {
      // And again, for anything written while the sign-out was on its way - though nothing the editor
      // keeps is written once the first has run (re-review of W11.3).
      forgetEditing();
      onSignedOut();
      return;
    }
    // Still signed in, or nothing says otherwise: the page goes on, and keeps what it edits again,
    // rather than keeping nothing for the rest of it (re-review of W11.3, M2). What was forgotten was
    // the author's own, and the page still holds it; the editor writes it whole at its next change.
    keepEditingAgain();
  };

  return (
    <header className={styles['band']}>
      <a className={styles['brand']} href="#/">
        <img
          className={`${styles['mark']} ${styles['onLight']}`}
          src={MARKS.light}
          alt=""
          width={18}
          height={18}
        />
        <img
          className={`${styles['mark']} ${styles['onDark']}`}
          src={MARKS.dark}
          alt=""
          width={18}
          height={18}
        />
        Alloy Works
      </a>
      {environment !== undefined && <span className={styles['environment']}>{environment}</span>}
      <span className={styles['spacer']} />
      <button
        type="button"
        className={styles['search']}
        aria-label="Search components, documents, or run a command"
        aria-keyshortcuts="Control+K"
        onClick={onSearch}
      >
        <svg
          className={styles['icon']}
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.4 10.4 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className={styles['searchLabel']}>
          Search components, documents, or run a command
        </span>
        <kbd className={styles['key']}>Ctrl K</kbd>
      </button>
      <span className={styles['spacer']} />
      <ThemeMenu />
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
                    setManagingTokens(true);
                  }}
                >
                  API tokens
                </button>
              </li>
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
      {managingTokens && <ApiTokens client={client} onClose={() => setManagingTokens(false)} />}
    </header>
  );
}
