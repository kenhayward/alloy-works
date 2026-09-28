/**
 * What the component editor keeps in a window's session storage, taken as a whole: a page's mark on
 * it, which tells a duplicated tab from a reload, and forgetting all of it at sign-out (final review
 * of W11.3, D1 and D2). Pure of React, of ProseMirror and of the rest of the editor, so the shell can
 * reach it without either.
 */

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Every key the editor keeps starts with this: the session ids, the kept records, the sends. */
const EDITING_PREFIX = 'alloy-works:editing-';

/** The page that has session storage open now, by an id of its own. */
const MARK = `${EDITING_PREFIX}page`;

/** A component's session id, and every id the window has used for it: what a duplicate forgets. */
const SESSION_IDS = [`${EDITING_PREFIX}session:`, `${EDITING_PREFIX}sessions:`];

/** This page's own id: a reload is another page, and so is a duplicated tab. */
const PAGE = crypto.randomUUID();

const storeOf = (storage?: Store): Store => storage ?? globalThis.sessionStorage;

/** Every key in `store` starting with one of `prefixes`, read before any is removed. */
function keysStarting(store: Store, prefixes: readonly string[]): string[] {
  const found: string[] = [];
  for (let at = 0; at < store.length; at += 1) {
    const key = store.key(at);
    if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) found.push(key);
  }
  return found;
}

let listening = false;

/** Unmarks storage as the page goes, and marks it again if the page comes back from the cache. */
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('pagehide', () => {
    try {
      if (storeOf().getItem(MARK) === PAGE) storeOf().removeItem(MARK);
    } catch {
      // Unreachable storage holds no mark to take off.
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (!(event as PageTransitionEvent).persisted) return;
    try {
      storeOf().setItem(MARK, PAGE);
    } catch {
      // As above.
    }
  });
}

/**
 * Marks session storage as this page's, answering whether it was another open page's already: a tab
 * duplicated from one editing, whose session storage the browser copied with that page's mark on it,
 * since a page takes its mark off as it goes and a reload finds none.
 *
 * A duplicate forgets every editing session id it copied, so it never saves, claims or replays under a
 * session the tab it was copied from is still using: each component it opens mints a session of its
 * own, and what the other tab kept is offered as text to copy rather than replayed. Asked again by the
 * same page, it finds its own mark and forgets nothing more. Never throws; storage that cannot be
 * reached marks nothing and finds no duplicate.
 */
export function markPage(storage?: Store): boolean {
  listen();
  try {
    const store = storeOf(storage);
    const mark = store.getItem(MARK);
    if (mark === PAGE) return false;
    const duplicate = mark !== null;
    if (duplicate) for (const key of keysStarting(store, SESSION_IDS)) store.removeItem(key);
    store.setItem(MARK, PAGE);
    return duplicate;
  } catch {
    return false;
  }
}

/**
 * Forgets everything the editor keeps in this window - every session id, every record kept for a
 * reload, every sequence sent - as the author signs out, so nobody who signs in on the same tab is
 * given any of it. Never throws.
 */
export function forgetEditing(storage?: Store): void {
  try {
    const store = storeOf(storage);
    for (const key of keysStarting(store, [EDITING_PREFIX])) store.removeItem(key);
  } catch {
    // Unreachable storage keeps nothing to forget.
  }
}
