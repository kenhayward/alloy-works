/**
 * What the component editor keeps in a window's session storage, taken as a whole: forgetting all of
 * it at sign-out, and keeping nothing more for the rest of the page once it is forgotten (final
 * review of W11.3, D2, and its re-review). Pure of React, of ProseMirror and of the rest of the
 * editor, so the shell can reach it without either.
 */

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Every key the editor keeps starts with this: the session ids, the kept records, the sends. */
const EDITING_PREFIX = 'alloy-works:editing-';

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

/** Set by a sign-out, and never unset by the page: what the editor keeps is written no more. */
let forgotten = false;

/**
 * Whether the editor may keep anything in this window: not once the author has signed out, for the
 * rest of the page - a save still pending as they did, or the flush as the page goes, would otherwise
 * write back what the sign-out forgot (re-review of W11.3). Every write the editor makes to session
 * storage asks this first.
 */
export function mayKeepEditing(): boolean {
  return !forgotten;
}

/**
 * Forgets everything the editor keeps in this window - every session id, every record kept for a
 * reload, every sequence sent, every text offered - as the author signs out, so nobody who signs in on
 * the same tab is given any of it, and stops the editor keeping anything more for the rest of the page.
 * Never throws.
 */
export function forgetEditing(storage?: Store): void {
  forgotten = true;
  try {
    const store = storeOf(storage);
    for (const key of keysStarting(store, [EDITING_PREFIX])) store.removeItem(key);
  } catch {
    // Unreachable storage keeps nothing to forget.
  }
}

/**
 * Keeps again, as a page that has just loaded does: called by a sign-out that did not happen, the
 * author still signed in, so the page they go on editing in keeps what it edits for the rest of it
 * (re-review of W11.3, M2) - a sign-out that did happen reloads the page. The renderer's test set-up
 * calls it too, since every test stands for a page of its own.
 */
export function keepEditingAgain(): void {
  forgotten = false;
}
