/** The three modules, in the order the switcher lists them. */
export type ModuleName = 'Components' | 'Documents' | 'Publications';

/**
 * The module an address belongs to, which the header band names. Only the first segment counts:
 * everything under `#/documents` is Documents. Home - the empty hash, `#` and `#/` - is no module,
 * and the band names none there; anything else is Components.
 */
export function moduleOf(hash: string): ModuleName | null {
  if (hash === '' || hash === '#' || hash === '#/') return null;
  if (/^#\/documents(?:\/|$)/.test(hash)) return 'Documents';
  if (/^#\/publications(?:\/|$)/.test(hash)) return 'Publications';
  return 'Components';
}
