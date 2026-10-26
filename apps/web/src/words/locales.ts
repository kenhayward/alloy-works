/**
 * **The interface's languages** (docs/plans/2026-10-26-ui-interface-localisation.md, UI-B; LOC-038):
 * the one real language, and two pseudo-locales the suites run in, made from it (UI-D). Each says its
 * direction and the locale its dates, numbers and plurals are formatted in. A real language is added
 * by a catalogue and a row.
 */
export interface InterfaceLocale {
  readonly tag: string;
  readonly direction: 'ltr' | 'rtl';
  /** The CLDR locale its formats come from: a pseudo-locale formats as the language it is made from. */
  readonly formats: string;
  /** Made from English for testing: chosen, never negotiated from a browser's languages. */
  readonly pseudo: boolean;
}

export const INTERFACE_LOCALES: readonly InterfaceLocale[] = [
  { tag: 'en-GB', direction: 'ltr', formats: 'en-GB', pseudo: false },
  { tag: 'en-XA', direction: 'ltr', formats: 'en-GB', pseudo: true },
  { tag: 'ar-XB', direction: 'rtl', formats: 'ar', pseudo: true },
];

/** The language every word falls back to, and the one used where nothing else is chosen. */
export const DEFAULT_LANGUAGE = 'en-GB';

export const localeOf = (tag: string): InterfaceLocale =>
  INTERFACE_LOCALES.find((each) => each.tag === tag) ?? INTERFACE_LOCALES[0]!;

/**
 * The language a person sees (UI-E; LOC-005): their own choice where it is a declared one, else the
 * first of their browser's languages a real declared one serves - exactly, or by its base - else
 * English.
 */
export function chosenLanguage(chosen: string | null, browser: readonly string[]): string {
  if (chosen !== null && INTERFACE_LOCALES.some((each) => each.tag === chosen)) return chosen;
  const real = INTERFACE_LOCALES.filter((each) => !each.pseudo);
  for (const asked of browser) {
    const exact = real.find((each) => each.tag.toLowerCase() === asked.toLowerCase());
    if (exact) return exact.tag;
  }
  for (const asked of browser) {
    const base = asked.split('-')[0]!.toLowerCase();
    const served = real.find((each) => each.tag.split('-')[0]!.toLowerCase() === base);
    if (served) return served.tag;
  }
  return DEFAULT_LANGUAGE;
}
