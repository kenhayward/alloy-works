import { createApiClient } from '@alloy-works/api-client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { chosenLanguage, localeOf } from './locales.js';
import { WordsProvider } from './words.js';

/** A person's own choice of interface language, and how to change it (the UI plan, UI-E). */
interface LanguageChoice {
  /** Their choice, or null for their browser's. */
  readonly chosen: string | null;
  /** What the interface is in now. */
  readonly language: string;
  readonly choose: (language: string | null) => Promise<boolean>;
}

const ChoiceContext = createContext<LanguageChoice>({
  chosen: null,
  language: 'en-GB',
  choose: async () => false,
});

export const useLanguageChoice = (): LanguageChoice => useContext(ChoiceContext);

/**
 * **The interface's language** (UI-E; LOC-005): the person's own choice, read with who they are, else
 * their browser's first declared language, else English; never any content's. The page's root says it
 * and its direction (LOC-004), and every word beneath is in it.
 */
export function InterfaceLanguage({
  children,
  fetch: given,
  browser = typeof navigator === 'undefined' ? [] : navigator.languages,
}: {
  children: ReactNode;
  /** Given in tests; the browser's own otherwise. */
  fetch?: typeof fetch;
  /** The browser's languages, in its order; given in tests. */
  browser?: readonly string[];
}) {
  const client = useMemo(
    () => createApiClient({ baseUrl: window.location.origin, ...(given ? { fetch: given } : {}) }),
    [given],
  );
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/me')
      .then(({ data }) => {
        if (current && data) setChosen(data.interfaceLanguage ?? null);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client]);

  const language = chosenLanguage(chosen, browser);
  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = localeOf(language).direction;
  }, [language]);

  const choice = useMemo<LanguageChoice>(
    () => ({
      chosen,
      language,
      choose: async (next) => {
        const { data } = await client
          .PUT('/v1/me/preferences', {
            body: { interfaceLanguage: next as 'en-GB' | 'en-XA' | 'ar-XB' | null },
          })
          .catch(() => ({ data: undefined }));
        if (!data) return false;
        setChosen(data.interfaceLanguage ?? null);
        return true;
      },
    }),
    [chosen, language, client],
  );

  return (
    <ChoiceContext.Provider value={choice}>
      <WordsProvider language={language}>{children}</WordsProvider>
    </ChoiceContext.Provider>
  );
}
