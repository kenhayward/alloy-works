import { indexEntryRefused, type IndexEntryChoice } from '@alloy-works/editor';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import own from './ReferenceDialog.module.css';
import { words } from '../words/words.js';

type Points = 'here' | 'see' | 'seeAlso';
type Member = 'term' | 'sub' | 'see' | 'seeAlso';

export interface IndexEntryDialogProps {
  /** The marker it opens on and changes, or null where it places a new one. */
  readonly current: IndexEntryChoice | null;
  /** The terms the component's markers already carry, offered as the author types (IX plan, Risks). */
  readonly terms: readonly string[];
  /** The entry given; answers why it could not be placed, or null once it has been. */
  readonly onDone: (choice: IndexEntryChoice) => string | null;
  readonly onCancel: () => void;
}

/** What is typed, as the content model holds it: NFC, without the spaces around it. */
const held = (typed: string): string => typed.normalize('NFC').trim();

const REFUSED: Record<Member, () => string> = {
  term: () => words('editor.index.refused-term'),
  sub: () => words('editor.index.refused-sub'),
  see: () => words('editor.index.refused-see'),
  seeAlso: () => words('editor.index.refused-see-also'),
};

/**
 * **The Index entry dialog** (the IX plan, IX-M): a term, an optional sub-entry, and whether the entry
 * locates here, sends the reader to another term ("see"), or locates here and names others ("see
 * also"). Refused as the content model refuses, the member named and the focus put on it. Opened on a
 * marker selected whole it starts on that marker and **Change** changes it; otherwise **Insert** places
 * one at the cursor. Nothing is placed on Cancel, Close or Escape. `Tab` wraps inside the dialog.
 */
export function IndexEntryDialog({ current, terms, onDone, onCancel }: IndexEntryDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const fields = useRef<Partial<Record<Member, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const [term, setTerm] = useState(current?.term ?? '');
  const [sub, setSub] = useState(current?.sub ?? '');
  const [points, setPoints] = useState<Points>(
    current?.see != null ? 'see' : current?.seeAlso != null ? 'seeAlso' : 'here',
  );
  const [see, setSee] = useState(current?.see ?? '');
  const [seeAlso, setSeeAlso] = useState((current?.seeAlso ?? []).join('\n'));
  const [refused, setRefused] = useState<Member | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    fields.current.term?.focus();
  }, []);

  const choice = (): IndexEntryChoice => {
    const others = seeAlso
      .split('\n')
      .map(held)
      .filter((each) => each !== '');
    return {
      term: held(term),
      sub: held(sub) === '' ? null : held(sub),
      see: points === 'see' ? held(see) : null,
      seeAlso: points === 'seeAlso' ? others : null,
    };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'input[type="text"], input[type="radio"]:checked, textarea, button',
      ) ?? []),
    ];
    if (stops.length === 0) return;
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? at - 1 : at + 1;
    if (at >= 0 && next >= 0 && next < stops.length) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
  };

  const invalid = (member: Member) =>
    refused === member ? { 'aria-invalid': true, 'aria-describedby': `${id}-refused` } : {};
  const listed = `${id}-terms`;

  return (
    <div className={shell['scrim']}>
      <div
        ref={dialog}
        className={shell['dialog']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        aria-describedby={`${id}-note`}
        onKeyDown={onKeyDown}
      >
        <form
          className={styles['form']}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const given = choice();
            const member = indexEntryRefused(given);
            setRefused(member);
            if (member !== null) {
              setSaid(REFUSED[member]());
              fields.current[member]?.focus();
              return;
            }
            setSaid(onDone(given));
          }}
        >
          <h2 id={`${id}-heading`} className={styles['heading']}>
            <span className={styles['tile']} aria-hidden="true">
              <Icon name="Index entry" size={22} />
            </span>
            {words('editor.index-entry')}
          </h2>
          <p id={`${id}-note`} className={styles['note']}>
            {words('editor.index.prints-nothing')}
          </p>
          <datalist id={listed}>
            {terms.map((each) => (
              <option key={each} value={each} />
            ))}
          </datalist>
          <label className={styles['field']}>
            {words('editor.index.term')}
            <input
              ref={(element) => {
                fields.current.term = element;
              }}
              type="text"
              list={listed}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              {...invalid('term')}
            />
          </label>
          <label className={styles['field']}>
            {words('editor.index.sub')}
            <input
              ref={(element) => {
                fields.current.sub = element;
              }}
              type="text"
              value={sub}
              onChange={(event) => setSub(event.target.value)}
              {...invalid('sub')}
            />
          </label>
          <fieldset className={own['group']}>
            <legend>{words('editor.index.points')}</legend>
            <div className={own['targets']}>
              {(['here', 'see', 'seeAlso'] as const).map((each) => (
                <label key={each} className={own['choice']}>
                  <input
                    type="radio"
                    name={`${id}-points`}
                    value={each}
                    checked={points === each}
                    onChange={() => {
                      setPoints(each);
                      setRefused(null);
                      setSaid(null);
                    }}
                  />
                  {words(
                    each === 'here'
                      ? 'editor.index.points-here'
                      : each === 'see'
                        ? 'editor.index.points-see'
                        : 'editor.index.points-see-also',
                  )}
                </label>
              ))}
            </div>
          </fieldset>
          {points === 'see' && (
            <label className={styles['field']}>
              {words('editor.index.see')}
              <input
                ref={(element) => {
                  fields.current.see = element;
                }}
                type="text"
                list={listed}
                value={see}
                onChange={(event) => setSee(event.target.value)}
                {...invalid('see')}
              />
            </label>
          )}
          {points === 'seeAlso' && (
            <label className={styles['field']}>
              {words('editor.index.see-also')}
              <textarea
                ref={(element) => {
                  fields.current.seeAlso = element;
                }}
                rows={3}
                value={seeAlso}
                onChange={(event) => setSeeAlso(event.target.value)}
                {...invalid('seeAlso')}
              />
            </label>
          )}
          {said !== null && (
            <p id={`${id}-refused`} role="alert" className={styles['complaint']}>
              {said}
            </p>
          )}
          <div className={styles['footer']}>
            <button type="button" onClick={onCancel}>
              {words('editor.cancel')}
            </button>
            <button type="submit" className="primary">
              {current === null ? words('editor.insert') : words('editor.change')}
            </button>
          </div>
        </form>
        <button
          type="button"
          className={shell['close']}
          aria-label={words('editor.close')}
          title={words('editor.close')}
          onClick={onCancel}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
    </div>
  );
}
