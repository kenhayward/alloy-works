import { CONTENT_LANGUAGES } from '@alloy-works/domain';
import { useMemo } from 'react';

import { useWords } from '../words/words.js';

/** A language tag's name in the given language where the data has one, or the tag itself. */
export function languageNames(formats: string): (tag: string) => string {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([formats], { type: 'language' });
  } catch {
    names = undefined;
  }
  return (tag) => {
    try {
      return names?.of(tag) ?? tag;
    } catch {
      return tag;
    }
  };
}

/**
 * The declared content languages (the TE plan, TE-E; LOC-044), each named in the interface's language
 * where its data names it.
 */
export function useNamedLanguages(): readonly { readonly tag: string; readonly name: string }[] {
  const { language } = useWords();
  return useMemo(() => {
    const nameOf = languageNames(language.formats);
    return CONTENT_LANGUAGES.map((each) => ({ tag: each.tag, name: nameOf(each.tag) }));
  }, [language.formats]);
}

/** The declared languages, for a language field to offer. A tag is still typed. */
export function DeclaredLanguages({ id }: { readonly id: string }) {
  const named = useNamedLanguages();
  return (
    <datalist id={id}>
      {named.map((each) => (
        <option key={each.tag} value={each.tag} label={each.name} />
      ))}
    </datalist>
  );
}
