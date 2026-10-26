import { createIntl, createIntlCache, type IntlShape } from '@formatjs/intl';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import enGB from './en-GB.json';
import { DEFAULT_LANGUAGE, localeOf, type InterfaceLocale } from './locales.js';
import { pseudolocalise } from './pseudo.js';

/**
 * **The interface's words** (the UI plan, UI-C; LOC-005, LOC-027): every sentence a person reads,
 * from the catalogue of their language, each a whole ICU message never assembled from pieces; and
 * every date, time, number and list formatted in it from the bundled locale data (UI-A). A key the
 * person's catalogue lacks falls back to English. With no provider, everything is English, so a
 * screen rendered alone reads as it always has.
 */

export type WordKey = keyof typeof enGB;
type Values = Record<string, string | number | Date | boolean | null | undefined>;

const catalogues = new Map<string, Readonly<Record<string, string>>>([[DEFAULT_LANGUAGE, enGB]]);

/** A language's catalogue: its own, or for a pseudo-locale English made over (UI-D). */
function catalogueOf(tag: string): Readonly<Record<string, string>> {
  const known = catalogues.get(tag);
  if (known) return known;
  const locale = localeOf(tag);
  const made: Record<string, string> = Object.fromEntries(
    Object.entries(enGB).map(([key, message]) => [
      key,
      locale.pseudo ? pseudolocalise(message, locale.tag as 'en-XA' | 'ar-XB') : message,
    ]),
  );
  catalogues.set(tag, made);
  return made;
}

export interface Words {
  readonly language: InterfaceLocale;
  /** A message, its placeholders filled. */
  readonly words: (key: WordKey, values?: Values) => string;
  readonly date: (value: Date | number, options?: Parameters<IntlShape['formatDate']>[1]) => string;
  readonly time: (value: Date | number, options?: Parameters<IntlShape['formatTime']>[1]) => string;
  readonly number: (value: number, options?: Parameters<IntlShape['formatNumber']>[1]) => string;
  readonly list: (
    values: readonly string[],
    options?: Parameters<IntlShape['formatList']>[1],
  ) => string;
  /** Text compared as the person's language orders it (LOC-003). */
  readonly compare: (a: string, b: string) => number;
}

const cache = createIntlCache();

export function makeWords(tag: string): Words {
  const language = localeOf(tag);
  const intl: IntlShape = createIntl(
    {
      locale: language.formats,
      defaultLocale: DEFAULT_LANGUAGE,
      messages: catalogueOf(language.tag),
      // A missing key falls back to English below; nothing is logged for it.
      onError: () => undefined,
    },
    cache,
  );
  const collator = new Intl.Collator(language.formats);
  return {
    language,
    words: (key, values) =>
      intl.formatMessage({ id: key, defaultMessage: enGB[key] }, values) as string,
    date: (value, options) => intl.formatDate(value, options),
    time: (value, options) => intl.formatTime(value, options),
    number: (value, options) => intl.formatNumber(value, options),
    list: (values, options) => intl.formatList(values, options) as string,
    compare: (a, b) => collator.compare(a, b),
  };
}

const english = makeWords(DEFAULT_LANGUAGE);
const WordsContext = createContext<Words>(english);

/** The person's language for everything beneath it. */
export function WordsProvider({ language, children }: { language: string; children: ReactNode }) {
  const words = useMemo(() => makeWords(language), [language]);
  return <WordsContext.Provider value={words}>{children}</WordsContext.Provider>;
}

export const useWords = (): Words => useContext(WordsContext);

/** English words, for what is said outside any screen: a module's own table, a test's expectation. */
export const englishWords = english;
