/** The modules, in the order the switcher lists them, and Search, which finds across them. */
export type ModuleName =
  | 'Components'
  | 'Documents'
  | 'Publications'
  | 'Templates'
  | 'Prompts'
  | 'Bibliography'
  | 'Terms'
  | 'Images'
  | 'Conversations'
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
  // An import becomes a document, and is begun from Documents (the IM plan).
  if (/^#\/imports(?:\/|$)/.test(hash)) return 'Documents';
  if (/^#\/publications(?:\/|$)/.test(hash)) return 'Publications';
  if (/^#\/templates(?:\/|$)/.test(hash)) return 'Templates';
  // A cohort is generated from a template, and followed from Templates (the R7 plan, R7-G; R14-A).
  if (/^#\/cohorts(?:\/|$)/.test(hash)) return 'Templates';
  if (/^#\/prompts(?:\/|$)/.test(hash)) return 'Prompts';
  if (/^#\/bibliography(?:\/|$)/.test(hash)) return 'Bibliography';
  if (/^#\/terms(?:\/|$)/.test(hash)) return 'Terms';
  if (/^#\/images(?:\/|$)/.test(hash)) return 'Images';
  if (/^#\/conversations(?:\/|$)/.test(hash)) return 'Conversations';
  if (/^#\/connections(?:\/|$)/.test(hash)) return 'Connections';
  if (/^#\/query-definitions(?:\/|$)/.test(hash)) return 'Query definitions';
  if (/^#\/search(?:\?|$)/.test(hash)) return 'Search';
  if (/^#\/admin(?:\/|$)/.test(hash)) return 'Administration';
  return 'Components';
}
