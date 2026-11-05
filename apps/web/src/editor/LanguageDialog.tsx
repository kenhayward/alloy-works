import { useId, useMemo, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import { languageNames, useNamedLanguages } from '../parts/DeclaredLanguages.js';
import { words, useWords } from '../words/words.js';
import styles from './LanguageDialog.module.css';

/**
 * A part's language, chosen from the declared list (LOC-044): by name in the reader's language, narrowed
 * by typing, since the list is long, the current one first. One outside the list, kept as it was typed
 * on the component's own page, stands there too until another is chosen. A press chooses and closes.
 */
export function LanguageDialog({
  current,
  onChoose,
  onClose,
}: {
  readonly current: string;
  readonly onChoose: (tag: string) => void;
  readonly onClose: () => void;
}) {
  const heading = useId();
  const { language } = useWords();
  const named = useNamedLanguages();
  const [typed, setTyped] = useState('');
  const rows = useMemo(() => {
    const order = new Intl.Collator(language.formats);
    const others = named
      .filter((each) => each.tag !== current)
      .sort((one, two) => order.compare(one.name, two.name));
    const name =
      current === 'und'
        ? words('editor.language-not-set')
        : languageNames(language.formats)(current);
    return [{ tag: current, name }, ...others];
  }, [named, current, language.formats]);
  const sought = typed.trim().toLocaleLowerCase(language.formats);
  const found = rows.filter(
    (each) =>
      each.name.toLocaleLowerCase(language.formats).includes(sought) ||
      each.tag.toLowerCase().includes(sought),
  );
  return (
    <Modal labelledBy={heading} size="narrow" onClose={onClose}>
      <div className={styles['dialog']}>
        <h2 id={heading}>{words('editor.choose-a-language')}</h2>
        <input
          className={styles['find']}
          aria-label={words('editor.find-a-language')}
          placeholder={words('editor.find-a-language')}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            const first = found[0];
            if (event.key !== 'Enter' || first === undefined) return;
            event.preventDefault();
            onChoose(first.tag);
          }}
        />
        {found.length === 0 ? (
          <p role="status">{words('editor.no-language-matches')}</p>
        ) : (
          <ul className={styles['list']} aria-labelledby={heading}>
            {found.map((each) => (
              <li key={each.tag}>
                <button
                  type="button"
                  className={styles['row']}
                  aria-label={words('editor.language-and-tag', {
                    name: each.name,
                    tag: each.tag,
                  })}
                  {...(each.tag === current ? { 'aria-current': 'true' as const } : {})}
                  onClick={() => onChoose(each.tag)}
                >
                  {/* The locale data's name, not the catalogue's words; "Not set" alone is ours. */}
                  <span {...(each.tag === 'und' ? {} : { 'data-content': '' })}>{each.name}</span>
                  <span className={styles['tag']} data-content>
                    {each.tag}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
