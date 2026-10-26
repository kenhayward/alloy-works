import { Fragment, useMemo, type ReactNode } from 'react';

import { DEFAULT_LANGUAGE } from './locales.js';
import { makeWords, type WordKey, type Words } from './make.js';

export { makeWords, type WordKey, type Words } from './make.js';

type Values = Parameters<Words['words']>[1];

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
