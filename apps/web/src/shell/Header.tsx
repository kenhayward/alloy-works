import { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ApiTokens } from '../account/ApiTokens.js';
import { Inbox } from '../account/Inbox.js';
import { Sessions } from '../account/Sessions.js';
import { forgetEditing, keepEditingAgain } from '../editor/editing-storage.js';
import { THEME_CHOICES, useThemeChoice } from '../theme/themes.js';
import { useGoToKeysOn } from './commands/useGoToKeys.js';
import { useHeaderHost } from './HeaderSlot.js';
import styles from './Header.module.css';
import type { ModuleName } from './moduleOf.js';
import { WaysIn } from './WaysIn.js';
import { useLanguageChoice } from '../words/language.js';
import { INTERFACE_LOCALES } from '../words/locales.js';
import { useWords, type WordKey } from '../words/words.js';

export { MARKS } from './marks.js';

const CHOICE_NAMES: Readonly<Record<string, WordKey>> = {
  light: 'shell.theme.light',
  dark: 'shell.theme.dark',
  auto: 'shell.theme.auto',
};

interface Person {
  readonly displayName: string | null;
  readonly email: string | null;
}

/** Where a notification's mail links: the inbox, opened over home. */
const INBOX = '#/inbox';
/** One or two letters for the account chip: the first and last words of a name, else the address. */
export function initialsOf({ displayName, email }: Person): string {
  const words = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  if (first) return `${first[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
  return email?.[0]?.toUpperCase() ?? '?';
}

export interface HeaderProps {
  /** The module the page is in, named where no page draws its own title; null on Home. */
  readonly module?: ModuleName | null;
  /** The environment's name, once read: the rail's to show. */
  readonly onEnvironment?: (name: string) => void;
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
  namedByContent = false,
  children,
}: {
  label: string;
  button: React.ReactNode;
  /** The button's name, where it shows an icon rather than words. */
  named?: string;
  /** Its name is a person's, not the interface's. */
  namedByContent?: boolean;
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
        {...(namedByContent ? { 'data-content-name': '' } : {})}
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

/** Light, Dark or Auto (ADR-0046), the choice kept on this device. */
function ThemeChoices({ close }: { close: () => void }) {
  const [choice, choose] = useThemeChoice();
  const { words } = useWords();
  return (
    <ul className={styles['items']} aria-label={words('shell.theme')}>
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
            {words(CHOICE_NAMES[each]!)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The theme from a button of its own, for someone with no account menu to hold it. */
function ThemeMenu() {
  const { words } = useWords();
  return (
    <Menu
      label={words('shell.theme')}
      named={words('shell.theme')}
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
      {(close) => <ThemeChoices close={close} />}
    </Menu>
  );
}

/**
 * The interface's language (the UI plan, UI-E; LOC-005), from the header beside the theme: the
 * browser's, or one the person chooses, kept as theirs and never any content's.
 */
function LanguageChoices({ close }: { close: () => void }) {
  const { chosen, choose } = useLanguageChoice();
  const { words } = useWords();
  const choices: readonly { tag: string | null; name: WordKey }[] = [
    { tag: null, name: 'language.browser' },
    ...INTERFACE_LOCALES.map((each) => ({
      tag: each.tag,
      name: `language.name.${each.tag}` as WordKey,
    })),
  ];
  return (
    <ul className={styles['items']} aria-label={words('language.label')}>
      {choices.map((each) => (
        <li key={each.tag ?? 'browser'}>
          <button
            type="button"
            className={styles['item']}
            aria-pressed={chosen === each.tag}
            lang={each.tag ?? undefined}
            onClick={() => {
              void choose(each.tag);
              close();
            }}
          >
            {words(each.name)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Whether `G` then a letter goes anywhere (CNT-189), kept on this device. */
function GoToKeysChoice() {
  const [on, set] = useGoToKeysOn();
  const { words } = useWords();
  return (
    <button type="button" className={styles['item']} aria-pressed={on} onClick={() => set(!on)}>
      {words('shell.go-to-keys')}
    </button>
  );
}

/**
 * The band across the top of every screen, in the theme's chrome, 56px (ADR-0075): the page's title and
 * menus, or the module's name; the page's lifecycle; search; the page's mode and Preview; and the
 * account button, which holds the Inbox, API tokens, Sessions, the theme, the language and Sign out, and
 * says how many are unread.
 */
export function Header({
  module = null,
  onEnvironment,
  onSearch = () => undefined,
  fetch: given,
  onSignedOut = () => window.location.reload(),
}: HeaderProps) {
  const origin = window.location.origin;
  const { words } = useWords();
  const client = useMemo(
    () => createApiClient({ baseUrl: origin, ...(given ? { fetch: given } : {}) }),
    [origin, given],
  );
  const leadHost = useHeaderHost('lead');
  const lifecycleHost = useHeaderHost('lifecycle');
  const toolsHost = useHeaderHost('tools');
  const toolbarHost = useHeaderHost('toolbar');
  const [who, setWho] = useState<Person | 'nobody' | undefined>();
  // The ways in the environment offers, and the page to come back to once signed in: a shared
  // publication's, so the person it was shared with lands on it (the R17 plan, R17-A).
  const [ways, setWays] = useState<readonly string[]>(['organisation']);
  // The organisation's open providers: named where there is more than one (IAM-011).
  const [providers, setProviders] = useState<readonly { id: string; name: string }[]>([]);
  const [here, setHere] = useState(() => window.location.hash);
  useEffect(() => {
    const moved = () => setHere(window.location.hash);
    window.addEventListener('hashchange', moved);
    return () => window.removeEventListener('hashchange', moved);
  }, []);
  const [managingTokens, setManagingTokens] = useState(false);
  const [seeingSessions, setSeeingSessions] = useState(false);
  const [readingInbox, setReadingInbox] = useState(false);
  // The inbox's own address, which a notification's mail links to (the EM plan, EM-Q): opened once
  // signed in, and left for home on closing.
  const signedIn = who !== undefined && who !== 'nobody';
  useEffect(() => {
    if (signedIn && here === INBOX) setReadingInbox(true);
  }, [signedIn, here]);
  // How many of the person's notifications are unread: read when the shell opens and when the inbox
  // closes, never live (the TH plan, TH-L).
  const [unread, setUnread] = useState(0);
  const countUnread = useCallback(() => {
    client
      .GET('/v1/inbox', { params: { query: { limit: '1' } } })
      .then(({ data }) => setUnread(data?.unread ?? 0))
      .catch(() => undefined);
  }, [client]);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/tenant')
      .then(({ data }) => {
        if (!current || !data) return;
        onEnvironment?.(data.name);
        if (Array.isArray(data.signIn)) setWays(data.signIn);
        if (Array.isArray(data.providers)) setProviders(data.providers);
      })
      .catch(() => undefined);
    client
      .GET('/v1/me')
      .then(({ data, response }) => {
        if (!current) return;
        if (data) {
          setWho({ displayName: data.displayName ?? null, email: data.email ?? null });
          countUnread();
        } else if (response.status === 401) setWho('nobody');
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, countUnread, onEnvironment]);

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

  // How tall the band stands, one line or wrapped where its words are long (WCAG 1.4.10), told to the
  // page as `--header-height`: what stands under it and what the window scrolls to stop below it.
  const band = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = band.current;
    if (element === null || typeof ResizeObserver === 'undefined') return undefined;
    const root = document.documentElement;
    const measure = () =>
      root.style.setProperty('--header-height', `${element.getBoundingClientRect().height}px`);
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    return () => {
      resized.disconnect();
      root.style.removeProperty('--header-height');
    };
  }, []);

  return (
    <header ref={band} className={styles['band']} data-app-region>
      <div ref={leadHost} className={styles['lead']} />
      <span className={styles['moduleName']}>
        {module === null || module === 'Search'
          ? words('shell.home')
          : words(`module.${module}` as WordKey)}
      </span>
      <span className={styles['spacer']} />
      <div ref={lifecycleHost} className={styles['slot']} />
      <button
        type="button"
        className={styles['search']}
        aria-label={words('shell.search')}
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
        <kbd className={styles['key']}>{words('shell.search.key')}</kbd>
      </button>
      <div ref={toolsHost} className={styles['slot']} />
      {(who === undefined || who === 'nobody') && <ThemeMenu />}
      {/* Reached where the page opened on no answer, and the service has said 401 since. */}
      {who === 'nobody' && (
        <WaysIn here={here} ways={ways} providers={providers} className={styles['chip']} />
      )}
      {who !== undefined && who !== 'nobody' && (
        <Menu
          label={words('shell.account')}
          namedByContent
          named={[
            who.displayName ?? who.email ?? words('shell.signedIn'),
            // Said here, since a name given to the button stands in for what it holds (COL-063).
            ...(unread > 0 ? [`${unread} ${words('shell.unread')}`] : []),
          ].join(' ')}
          button={
            <>
              <span className={styles['initials']} aria-hidden="true" data-content>
                {initialsOf(who)}
              </span>
              {unread > 0 && (
                <>
                  {' '}
                  <span className={styles['unread']}>
                    {unread}
                    <span className={styles['hidden']}> {words('shell.unread')}</span>
                  </span>
                </>
              )}
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
                    setReadingInbox(true);
                  }}
                >
                  {unread > 0
                    ? words('shell.inboxUnread', { count: unread })
                    : words('shell.inbox')}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={styles['item']}
                  onClick={() => {
                    close();
                    setManagingTokens(true);
                  }}
                >
                  {words('shell.tokens')}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={styles['item']}
                  onClick={() => {
                    close();
                    setSeeingSessions(true);
                  }}
                >
                  {words('shell.sessions')}
                </button>
              </li>
              <li className={styles['choices']}>
                <ThemeChoices close={close} />
              </li>
              <li className={styles['choices']}>
                <LanguageChoices close={close} />
              </li>
              <li className={styles['choices']}>
                <GoToKeysChoice />
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
                  {words('shell.signOut')}
                </button>
              </li>
            </ul>
          )}
        </Menu>
      )}
      {managingTokens && <ApiTokens client={client} onClose={() => setManagingTokens(false)} />}
      {seeingSessions && <Sessions client={client} onClose={() => setSeeingSessions(false)} />}
      {readingInbox && (
        <Inbox
          client={client}
          onClose={() => {
            setReadingInbox(false);
            if (window.location.hash === INBOX) window.location.hash = '#/';
            countUnread();
          }}
        />
      )}
      {/* The row under the menus, where a page draws one. */}
      <div ref={toolbarHost} className={styles['toolbarRow']} />
    </header>
  );
}
