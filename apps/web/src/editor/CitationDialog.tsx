import type { createApiClient } from '@alloy-works/api-client';
import type { CitationChoice } from '@alloy-works/editor';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import {
  entryMatches,
  entryName,
  spaceEntries,
  type EntryOffered,
} from '../bibliography/entries.js';
import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import own from './ReferenceDialog.module.css';

type Client = ReturnType<typeof createApiClient>;

/** What the dialog says where the space holds no entry the author may read. */
export const NO_ENTRIES = 'This space holds no bibliography entries you may read.';
/** What it says where the entries could not be read. */
export const ENTRIES_UNREAD = 'The bibliography could not be read.';

export interface CitationDialogProps {
  readonly client: Client;
  /** The component's space, whose entries alone it may cite (CI-B). */
  readonly space: string;
  /** The citation it opens on and changes, or null where it places a new one. */
  readonly current: CitationChoice | null;
  /** The entry and locator chosen; answers why it could not be placed, or null once it has been. */
  readonly onDone: (choice: CitationChoice) => string | null;
  readonly onCancel: () => void;
}

/**
 * **The Cite dialog** (the CI plan, CId): the space's entries, found by key, author or title as the
 * author types, each a radio named as a reader knows the source; and a locator, a page or the like,
 * which may be left empty. Opened on a citation selected whole it starts on that citation and
 * **Change** changes it; otherwise **Insert** places one at the cursor. Nothing is placed on Cancel,
 * Close or Escape.
 *
 * Worked by keyboard as the Reference dialog is: the focus starts in the search, the one entry found
 * is chosen so Enter cites it, the arrow keys move among the entries, `Tab` wraps inside the dialog.
 */
export function CitationDialog({ client, space, current, onDone, onCancel }: CitationDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const [entries, setEntries] = useState<readonly EntryOffered[] | 'unread' | null>(null);
  const [typed, setTyped] = useState('');
  const [chosen, setChosen] = useState<string | null>(current?.entry ?? null);
  const [locator, setLocator] = useState(current?.locator ?? '');
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    spaceEntries(client, space).then(
      (found) => live && setEntries(found ?? 'unread'),
      () => live && setEntries('unread'),
    );
    return () => {
      live = false;
    };
  }, [client, space]);

  // In the search once the entries are read; on Cancel where there is nothing to find.
  useEffect(() => {
    (search.current ?? dialog.current?.querySelector<HTMLElement>('button'))?.focus();
  }, [entries]);

  const found = Array.isArray(entries) ? entries.filter((each) => entryMatches(each, typed)) : [];
  // What is chosen is always among what is found, so Insert never cites one out of sight.
  const choice = found.find((each) => each.id === chosen) ?? found[0];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'input[type="search"], input[type="radio"]:checked, input[type="text"], button',
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
            if (choice === undefined) return;
            const trimmed = locator.trim();
            setSaid(onDone({ entry: choice.id, locator: trimmed === '' ? null : trimmed }));
          }}
        >
          <h2 id={`${id}-heading`} className={styles['heading']}>
            <span className={styles['tile']} aria-hidden="true">
              <Icon name="Cite" size={22} />
            </span>
            Cite
          </h2>
          {entries === null && <p role="status">Reading the bibliography.</p>}
          {entries === 'unread' && <p role="alert">{ENTRIES_UNREAD}</p>}
          {Array.isArray(entries) && entries.length === 0 && (
            <p className={styles['note']}>{NO_ENTRIES}</p>
          )}
          {Array.isArray(entries) && entries.length > 0 && (
            <>
              <label className={styles['field']}>
                Find an entry
                <input
                  ref={search}
                  type="search"
                  value={typed}
                  aria-describedby={`${id}-found`}
                  onChange={(event) => setTyped(event.target.value)}
                />
              </label>
              <p id={`${id}-found`} className={styles['note']} aria-live="polite">
                {found.length === 1 ? '1 entry found.' : `${found.length} entries found.`}
              </p>
              {found.length > 0 && (
                <fieldset className={own['group']}>
                  <legend>Entry</legend>
                  <div className={own['targets']}>
                    {found.map((each) => (
                      <label key={each.id} className={own['choice']}>
                        <input
                          type="radio"
                          name={`${id}-entry`}
                          value={each.id}
                          checked={each.id === choice?.id}
                          onChange={() => setChosen(each.id)}
                        />
                        {entryName(each)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <label className={styles['field']}>
                Locator, such as a page (optional)
                <input
                  type="text"
                  value={locator}
                  onChange={(event) => setLocator(event.target.value)}
                />
              </label>
            </>
          )}
          {said !== null && (
            <p role="alert" className={styles['complaint']}>
              {said}
            </p>
          )}
          <div className={styles['footer']}>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            {choice !== undefined && (
              <button type="submit" className="primary">
                {current === null ? 'Insert' : 'Change'}
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
