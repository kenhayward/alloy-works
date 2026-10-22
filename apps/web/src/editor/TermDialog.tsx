import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import own from './ReferenceDialog.module.css';
import type { TermChoice } from './terming.js';

/** What the dialog says where the space holds no term to offer. */
export const NO_TERMS = 'This space holds no approved terms you may read.';
/** What it says where the terms could not be read. */
export const TERMS_UNREAD = 'The terms could not be read.';
/** What it says where the space held more terms than are offered. */
export const TERMS_TRUNCATED = 'Only the first 5,000 terms of the space are offered.';

export interface TermDialogProps {
  /** The space's terms, null while they are read. */
  readonly terms: readonly TermChoice[] | 'unread' | null;
  /** Whether the space held more terms than are offered. */
  readonly truncated?: boolean;
  /** The term the words already carry, or null. */
  readonly current: string | null;
  /** Whether there is a term there to take off. */
  readonly removable: boolean;
  /** The words the term goes on, as the dialog opened, or null. */
  readonly selected: string | null;
  readonly onApply: (values: { readonly term: string }) => void;
  readonly onRemove: () => void;
  readonly onCancel: () => void;
}

const named = (term: TermChoice) =>
  `${term.label}${term.abbreviation === null ? '' : ` (${term.abbreviation})`}`;

const matches = (term: TermChoice, typed: string) => {
  const sought = typed.trim().toLowerCase();
  return sought === '' || term.forms.some((form) => form.toLowerCase().includes(sought));
};

/**
 * **The Term dialog** (the TM plan, TMc; CNT-165): the space's approved terms and its deprecated ones,
 * found by any label, alternative or abbreviation as the author types, each a radio; **Apply** puts
 * the one chosen over the selection or the word at the caret, and **Remove term** takes off the one
 * there. A deprecated term is flagged as it is chosen, its replacement named and offered (LIB-057).
 * Worked by keyboard as the Cite dialog is.
 */
export function TermDialog({
  terms,
  truncated = false,
  current,
  removable,
  selected,
  onApply,
  onRemove,
  onCancel,
}: TermDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const [typed, setTyped] = useState('');
  const [chosen, setChosen] = useState<string | null>(current);

  useEffect(() => {
    (search.current ?? dialog.current?.querySelector<HTMLElement>('button'))?.focus();
  }, [terms]);

  const offered = Array.isArray(terms) ? terms.filter((each) => each.standing !== 'draft') : [];
  const found = offered.filter((each) => matches(each, typed));
  const choice = found.find((each) => each.id === chosen) ?? found[0];
  const instead =
    choice?.standing === 'deprecated' && choice.replacedBy !== null
      ? offered.find((each) => each.id === choice.replacedBy)
      : undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'input[type="search"], input[type="radio"]:checked, button',
      ) ?? []),
    ];
    if (stops.length === 0) return;
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? at - 1 : at + 1;
    if (at >= 0 && next >= 0 && next < stops.length) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
  };

  return (
    <div className={shell['scrim']}>
      <div
        ref={dialog}
        className={shell['dialog']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        onKeyDown={onKeyDown}
      >
        <form
          className={styles['form']}
          onSubmit={(event) => {
            event.preventDefault();
            if (choice !== undefined) onApply({ term: choice.id });
          }}
        >
          <h2 id={`${id}-heading`} className={styles['heading']}>
            <span className={styles['tile']} aria-hidden="true">
              <Icon name="Term" size={22} />
            </span>
            Term
          </h2>
          {selected !== null && <p className={styles['note']}>{`On: ${selected}`}</p>}
          {terms === null && <p role="status">Reading the terms.</p>}
          {terms === 'unread' && <p role="alert">{TERMS_UNREAD}</p>}
          {truncated && <p className={styles['note']}>{TERMS_TRUNCATED}</p>}
          {Array.isArray(terms) && offered.length === 0 && (
            <p className={styles['note']}>{NO_TERMS}</p>
          )}
          {offered.length > 0 && (
            <>
              <label className={styles['field']}>
                Find a term
                <input
                  ref={search}
                  type="search"
                  value={typed}
                  aria-describedby={`${id}-found`}
                  onChange={(event) => setTyped(event.target.value)}
                />
              </label>
              <p id={`${id}-found`} className={styles['note']} aria-live="polite">
                {found.length === 1 ? '1 term found.' : `${found.length} terms found.`}
              </p>
              {found.length > 0 && (
                <fieldset className={own['group']}>
                  <legend>Term</legend>
                  <div className={own['targets']}>
                    {found.map((each) => (
                      <label key={each.id} className={own['choice']}>
                        <input
                          type="radio"
                          name={`${id}-term`}
                          value={each.id}
                          checked={each.id === choice?.id}
                          onChange={() => setChosen(each.id)}
                        />
                        {named(each)}
                        {each.standing === 'deprecated' && ', deprecated'}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </>
          )}
          {choice?.standing === 'deprecated' && (
            <div role="alert" className={styles['complaint']}>
              {instead === undefined
                ? `${choice.label} is deprecated.`
                : `${choice.label} is deprecated. Use ${instead.label} instead.`}
            </div>
          )}
          {instead !== undefined && (
            <button
              type="button"
              onClick={() => {
                setTyped('');
                setChosen(instead.id);
              }}
            >
              {`Use ${instead.label}`}
            </button>
          )}
          <div className={styles['footer']}>
            {removable && (
              <button type="button" onClick={onRemove}>
                Remove term
              </button>
            )}
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            {choice !== undefined && (
              <button type="submit" className="primary">
                Apply
              </button>
            )}
          </div>
        </form>
        <button
          type="button"
          className={shell['close']}
          aria-label="Close"
          title="Close"
          onClick={onCancel}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
    </div>
  );
}
