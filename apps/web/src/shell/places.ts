import { useEffect, useState } from 'react';

import { moduleOf, type ModuleName } from './moduleOf.js';

/** Where a page belongs: a module, or Home. */
export type Place = ModuleName | 'Home';

/** The place an address belongs to. */
export const placeOf = (hash: string): Place => moduleOf(hash) ?? 'Home';

/** The `#...` of a URL a `hashchange` names, or the empty hash. */
export function hashOf(url: string): string {
  const at = url.indexOf('#');
  return at < 0 ? '' : url.slice(at);
}

/**
 * Where each place was last left: the address it showed as another place opened, read from the
 * `hashchange`'s `oldURL`, so an address a page rewrote without one (the document page's chosen
 * node) is the one remembered.
 */
export function useLeftAt(): ReadonlyMap<Place, string> {
  const [left, setLeft] = useState<ReadonlyMap<Place, string>>(() => new Map());
  useEffect(() => {
    const follow = (event: HashChangeEvent) => {
      const from = hashOf(event.oldURL);
      if (placeOf(from) === placeOf(window.location.hash)) return;
      setLeft((held) => new Map(held).set(placeOf(from), from));
    };
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return left;
}
