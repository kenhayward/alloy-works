import { createIntl, createIntlCache, type IntlShape } from '@formatjs/intl';
import { Fragment, useMemo, type ReactNode } from 'react';

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

/**
 * The words of the language the interface is in now: set by `WordsProvider` before anything beneath
 * it renders, and everything beneath remounted when it changes, so a word read in any function as a
 * screen renders is in the person's language. English until a provider says otherwise.
 */
let current: Words = english;

/** A message in the interface's language now, its placeholders filled. */
export const words = (key: WordKey, values?: Values): string => current.words(key, values);

/** The interface's language now, its formats and its collation. */
export const formats = (): Words => current;

/** Back to English: between tests, as a page with no provider is. */
export const resetWords = (): void => {
  current = english;
};

/** The person's language for everything beneath it, remounted when it changes. */
export function WordsProvider({ language, children }: { language: string; children: ReactNode }) {
  const made = useMemo(() => makeWords(language), [language]);
  current = made;
  return <Fragment key={made.language.tag}>{children}</Fragment>;
}

/** The interface's language now, for a component that wants its formats or its direction. */
export const useWords = (): Words => current;

/** English words, for a test's expectation. */
export const englishWords = english;
