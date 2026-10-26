/**
 * **The interface's declared languages** (docs/plans/2026-10-26-ui-interface-localisation.md, UI-B;
 * LOC-038), by tag: what a person may choose, which the renderer's catalogues serve. `en-XA` and
 * `ar-XB` are pseudo-locales the suites run in.
 */
export const INTERFACE_LANGUAGES = ['en-GB', 'en-XA', 'ar-XB'] as const;
export type InterfaceLanguage = (typeof INTERFACE_LANGUAGES)[number];

/**
 * The locale each language sorts by (UI-H; LOC-003): a pseudo-locale sorts as the language it is
 * made from.
 */
export const INTERFACE_COLLATIONS: Readonly<Record<InterfaceLanguage, string>> = {
  'en-GB': 'en-GB',
  'en-XA': 'en-GB',
  'ar-XB': 'ar',
};

/**
 * The declared language a request's `Accept-Language` names first (UI-H): exactly, by any case, else
 * by its base among the real ones; undefined where it names none.
 */
export function interfaceLanguageOf(header: string | undefined): InterfaceLanguage | undefined {
  const asked = (header ?? '')
    .split(',')
    .map((each) => each.split(';')[0]!.trim().toLowerCase())
    .filter((each) => each !== '');
  for (const tag of asked) {
    const exact = INTERFACE_LANGUAGES.find((each) => each.toLowerCase() === tag);
    if (exact) return exact;
  }
  for (const tag of asked) {
    const base = tag.split('-')[0];
    if (base === 'en') return 'en-GB';
  }
  return undefined;
}
