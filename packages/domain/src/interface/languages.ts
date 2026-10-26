/**
 * **The interface's declared languages** (docs/plans/2026-10-26-ui-interface-localisation.md, UI-B;
 * LOC-038), by tag: what a person may choose, which the renderer's catalogues serve. `en-XA` and
 * `ar-XB` are pseudo-locales the suites run in.
 */
export const INTERFACE_LANGUAGES = ['en-GB', 'en-XA', 'ar-XB'] as const;
export type InterfaceLanguage = (typeof INTERFACE_LANGUAGES)[number];
