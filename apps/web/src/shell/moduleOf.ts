/** The modules, in the order the switcher lists them, and Search, which finds across them. */
export type ModuleName =
  | 'Components'
  | 'Documents'
  | 'Publications'
  | 'Templates'
  | 'Connections'
  | 'Query definitions'
  | 'Search'
  | 'Administration';

/**
 * The module an address belongs to, which the header band names. Only the first segment counts:
 * everything under `#/documents` is Documents. Home - the empty hash, `#` and `#/` - is no module,
 * and the band names none there; anything else is Components.
 */
export function moduleOf(hash: string): ModuleName | null {
  if (hash === '' || hash === '#' || hash === '#/') return null;
  if (/^#\/documents(?:\/|$)/.test(hash)) return 'Documents';
  if (/^#\/publications(?:\/|$)/.test(hash)) return 'Publications';
  if (/^#\/templates(?:\/|$)/.test(hash)) return 'Templates';
  if (/^#\/connections(?:\/|$)/.test(hash)) return 'Connections';
  if (/^#\/query-definitions(?:\/|$)/.test(hash)) return 'Query definitions';
  if (/^#\/search(?:\?|$)/.test(hash)) return 'Search';
  if (/^#\/admin(?:\/|$)/.test(hash)) return 'Administration';
  return 'Components';
}
