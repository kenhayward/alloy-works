import type { PlatformBridge } from './contract.js';

/** The base languages of the components open, as the bridge is told them. */
export interface Spelling {
  /**
   * Holds a component's base language while it is open, and answers what lets it go. A language two
   * components share is held until both have let it go.
   */
  hold(language: string): () => void;
}

const spellings = new WeakMap<PlatformBridge, Spelling>();

/**
 * The one list of languages for a bridge (CNT-178): every component open holds its base language in
 * it, and the bridge is told the list whenever it changes - on the desktop, the dictionaries the
 * spelling checker uses. A list emptied by the last component closing is not told, because setting
 * none would switch the desktop's checker off for the page's other text fields too; nor is a list the
 * same as the last one told, which is what React opening a component twice over in StrictMode makes.
 * A bridge that refuses is left to it: the checker then checks against what it had.
 */
export function spellingFor(bridge: PlatformBridge): Spelling {
  const known = spellings.get(bridge);
  if (known !== undefined) return known;
  // Each language with how many components hold it, in the order first held.
  const held = new Map<string, number>();
  let told = '';
  const tell = () => {
    const languages = [...held.keys()];
    const said = languages.join(' ');
    if (languages.length === 0 || said === told) return;
    told = said;
    bridge.setSpellCheckLanguages(languages).catch(() => {});
  };
  const spelling: Spelling = {
    hold(language) {
      held.set(language, (held.get(language) ?? 0) + 1);
      tell();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = (held.get(language) ?? 1) - 1;
        if (count > 0) held.set(language, count);
        else held.delete(language);
        tell();
      };
    },
  };
  spellings.set(bridge, spelling);
  return spelling;
}
