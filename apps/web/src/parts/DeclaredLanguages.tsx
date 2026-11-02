import { CONTENT_LANGUAGES } from '@alloy-works/domain';
import { useMemo } from 'react';

import { useWords } from '../words/words.js';

/**
 * The declared content languages (the TE plan, TE-E; LOC-044), each named in the interface's language
 * where its data names it, for the language field to offer. A tag is still typed.
 */
export function DeclaredLanguages({ id }: { readonly id: string }) {
  const { language } = useWords();
  const named = useMemo(() => {
    let names: Intl.DisplayNames | undefined;
    try {
      names = new Intl.DisplayNames([language.formats], { type: 'language' });
    } catch {
      names = undefined;
    }
    return CONTENT_LANGUAGES.map((each) => {
      let name: string | undefined;
      try {
        name = names?.of(each.tag);
      } catch {
        name = undefined;
      }
      return { tag: each.tag, name: name ?? each.tag };
    });
  }, [language.formats]);
  return (
    <datalist id={id}>
      {named.map((each) => (
        <option key={each.tag} value={each.tag} label={each.name} />
      ))}
    </datalist>
  );
}
