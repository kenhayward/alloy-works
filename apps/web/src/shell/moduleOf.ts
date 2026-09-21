/** The three modules, in the order the switcher lists them. */
export type ModuleName = 'Components' | 'Documents' | 'Publications';

/**
 * The module an address belongs to, which the header band names. Only the first segment counts:
 * everything under `#/documents` is Documents, and an address nothing claims - the empty hash, `#/`
 * - is Components, which is what the workspace shows there until Home exists.
 */
export function moduleOf(hash: string): ModuleName {
  if (/^#\/documents(?:\/|$)/.test(hash)) return 'Documents';
  if (/^#\/publications(?:\/|$)/.test(hash)) return 'Publications';
  return 'Components';
}
