import { useId, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import styles from '../lifecycle/Hold.module.css';
import { words as say } from '../words/words.js';

/** A title as the dialog edits it: its own words, and its words in the language, where given. */
export interface TitleToTranslate {
  /** The section's outline node, or null for the document's own title. */
  readonly node: string | null;
  readonly own: string;
  readonly translated: string | undefined;
}

/** One title's words in a language set, or cleared with null (the TR plan, TR-L). */
export interface TitleTranslation {
  readonly operation: 'translateTitle';
  readonly node: string | null;
  readonly language: string;
  readonly title: string | null;
}

/** The title given in a language serving `language`, its exact tag first. */
export function titleIn(
  titles: Readonly<Record<string, string>> | undefined,
  language: string,
): string | undefined {
  const asked = language.toLowerCase();
  const entries = Object.entries(titles ?? {}).filter(([tag]) => {
    const each = tag.toLowerCase();
    return each === asked || each.startsWith(`${asked}-`) || asked.startsWith(`${each}-`);
  });
  return (entries.find(([tag]) => tag.toLowerCase() === asked) ?? entries[0])?.[1];
}

/**
 * **Titles in a language** (the TR plan, TR-L): how many of the document's titles - its own and each
 * section's - have words in the language a publish is made in, and, to whoever may edit, a dialog
 * giving or clearing each. A title with none prints in the document's own language, and is reported.
 */
export function TranslatedTitles({
  language,
  titles,
  mayEdit,
  onSave,
}: {
  language: string;
  titles: readonly TitleToTranslate[];
  mayEdit: boolean;
  onSave: (change: TitleTranslation) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const given = titles.filter((each) => each.translated !== undefined).length;
  return (
    <div>
      {say('translation.titles-in-of-given-the', { language, given, length: titles.length })}{' '}
      {mayEdit && (
        <button type="button" onClick={() => setOpen(true)}>
          {say('translation.translate-titles')}
        </button>
      )}
      {open && (
        <TitlesDialog
          language={language}
          titles={titles}
          onSave={onSave}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function TitlesDialog({
  language,
  titles,
  onSave,
  onClose,
}: {
  language: string;
  titles: readonly TitleToTranslate[];
  onSave: (change: TitleTranslation) => Promise<boolean>;
  onClose: () => void;
}) {
  const headingId = useId();
  const [words, setWords] = useState<ReadonlyMap<string, string>>(
    new Map(titles.map((each) => [each.node ?? '', each.translated ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    let refused = false;
    // One act a changed title, in order, as the outline takes one act at a time.
    for (const each of titles) {
      const now = (words.get(each.node ?? '') ?? '').trim();
      if (now === (each.translated ?? '')) continue;
      const done = await onSave({
        operation: 'translateTitle',
        node: each.node,
        language,
        title: now === '' ? null : now,
      });
      if (!done) {
        refused = true;
        break;
      }
    }
    setBusy(false);
    if (refused) setSaid(say('translation.not-every-title-was-saved'));
    else onClose();
  };

  return (
    <Modal labelledBy={headingId} size="wide" onClose={onClose}>
      <form className={styles['form']} onSubmit={(event) => void save(event)}>
        <h2 id={headingId}>{say('translation.titles-in', { language })}</h2>
        {titles.map((each) => (
          <label key={each.node ?? 'document'}>
            {each.node === null ? (
              say('translation.the-document', { own: each.own })
            ) : (
              <span data-content>{each.own}</span>
            )}
            <input
              value={words.get(each.node ?? '') ?? ''}
              maxLength={500}
              lang={language}
              onChange={(event) =>
                setWords((was) => new Map(was).set(each.node ?? '', event.target.value))
              }
            />
          </label>
        ))}
        {said !== '' && <p role="alert">{said}</p>}
        <div className={styles['buttons']}>
          <button type="button" onClick={onClose}>
            {say('translation.cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {say('translation.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
