import type { ContentDocument } from '@alloy-works/domain';
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import { iterationLabel, savedTime, sentenceCase } from './recovery.js';
import styles from './RecoveryPanel.module.css';
import type { IterationPage, SavedIteration } from './session.js';
import { changesBetween, type TextChange } from './textChanges.js';

export interface RecoveryPanelProps {
  /** A page of the author's own saved iterations, newest first: the first, or the one after `cursor`. */
  readonly load: (cursor?: string) => Promise<IterationPage>;
  /** One iteration's text, read to show what restoring it changes, or why it could not be read. */
  readonly peek: (iteration: SavedIteration) => Promise<ContentDocument | string>;
  /** The text on screen now, which a restore would replace. */
  readonly current: () => ContentDocument | null;
  /** Restores one; answers null once restored, or why it was not, which the dialog shows. */
  readonly restore: (iteration: SavedIteration) => Promise<string | null>;
  /** Cancel, Close or Escape: nothing is restored. */
  readonly onCancel: () => void;
  /** The dialog's element, one of the regions the editor keeps a hold of. */
  readonly ref?: Ref<HTMLElement>;
}

type Listing =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }
  | {
      readonly state: 'ready';
      readonly items: readonly SavedIteration[];
      readonly next: string | null;
    };

type Preview =
  | { readonly state: 'reading' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'shown'; readonly changes: readonly TextChange[] };

/** Why a page could not be listed, in the author's words. */
const failure = (code: Extract<IterationPage, { ok: false }>['code']): string =>
  code === 'lock_held' || code === 'lock_required'
    ? 'This session no longer holds the component, so its saved text cannot be listed.'
    : code === 'signed_out'
      ? 'You are signed out. Sign in again to list your saved text.'
      : 'Your saved text could not be listed.';

/**
 * **Saved text** (component-editor.md, "Recovery, as W11 builds it"; CNT-090; the R1 plan): a modal of
 * the author's own saved iterations of this component, newest first, each with when it was saved, from
 * which window, and the version it was written against, a page at a time behind **Show older**.
 * Choosing one shows what restoring it would change against the text on screen, block by block and
 * word by word; **Recover** puts it in place of what is on screen, anything of which not yet saved is
 * saved first. **Cancel**, Close or Escape restore nothing.
 *
 * The focus comes to the dialog as it opens and stays inside it; the page behind is inert.
 */
export function RecoveryPanel({ load, peek, current, restore, onCancel, ref }: RecoveryPanelProps) {
  const heading = useId();
  const own = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => own.current!, []);
  const [listing, setListing] = useState<Listing>({ state: 'loading' });
  const [chosen, setChosen] = useState<SavedIteration | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Asked afresh by Try again.
  const [attempt, setAttempt] = useState(0);
  // The first row a Show older added, which takes the focus once it is drawn.
  const [landing, setLanding] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  // Held in refs, so a parent passing new functions on every render lists and reads nothing again.
  const loadRef = useRef(load);
  loadRef.current = load;
  const peekRef = useRef(peek);
  peekRef.current = peek;
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    own.current?.focus();
  }, []);

  // Modal in full, as the Format dialog is: the rest of the page inert while it stands.
  useLayoutEffect(() => {
    const mine = own.current?.closest('body > *');
    const others = [...document.body.children].filter(
      (each) => each !== mine && !each.hasAttribute('inert'),
    );
    for (const each of others) each.setAttribute('inert', '');
    return () => {
      for (const each of others) each.removeAttribute('inert');
    };
  }, []);

  useEffect(() => {
    let live = true;
    void loadRef.current().then((page) => {
      if (!live) return;
      setListing(
        page.ok
          ? { state: 'ready', items: page.items, next: page.next }
          : { state: 'failed', message: failure(page.code) },
      );
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (landing === null) return;
    rows.current.get(landing)?.focus();
    setLanding(null);
  }, [landing, listing]);

  // What the chosen one would change, read as it is chosen; a later choice drops an earlier read.
  useEffect(() => {
    if (chosen === null) return undefined;
    let live = true;
    setPreview({ state: 'reading' });
    void peekRef.current(chosen).then((read) => {
      if (!live) return;
      const now = currentRef.current();
      if (typeof read === 'string') setPreview({ state: 'failed', message: read });
      else if (now === null)
        setPreview({ state: 'failed', message: 'The text on screen could not be read.' });
      else setPreview({ state: 'shown', changes: changesBetween(now, read) });
    });
    return () => {
      live = false;
    };
  }, [chosen]);

  const older = async () => {
    if (listing.state !== 'ready' || listing.next === null) return;
    setBusy(true);
    const page = await loadRef.current(listing.next);
    setBusy(false);
    if (!page.ok) {
      setRefused(failure(page.code));
      return;
    }
    setListing({ state: 'ready', items: [...listing.items, ...page.items], next: page.next });
    if (page.items[0]) setLanding(page.items[0].id);
  };

  const recover = async () => {
    if (chosen === null || busy) return;
    setBusy(true);
    setRefused(null);
    const why = await restore(chosen);
    // Restored, the dialog is gone; refused, it stays with the reason beside the list.
    if (why !== null) {
      setBusy(false);
      setRefused(why);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    // The focus kept inside, as the Format dialog keeps it.
    const stops = [
      ...(own.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ??
        []),
    ];
    if (stops.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const inside = active !== null && own.current?.contains(active) === true;
    const end = event.shiftKey ? stops[0] : stops.at(-1);
    if (inside && active !== end && active !== own.current) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
  };

  return createPortal(
    <div className={shell['scrim']}>
      <div
        ref={own}
        className={`${shell['dialog']} ${shell['wide']}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className={styles['panel']}>
          <h2 id={heading} className={styles['heading']}>
            Saved text
          </h2>
          <p className={styles['about']}>
            Choose saved text to see what recovering it changes. Recover puts it in place of what is
            on screen; anything on screen not yet saved is saved first, so it can be recovered too.
          </p>
          <div className={styles['columns']}>
            <div className={styles['side']}>
              {listing.state === 'loading' && <p className={styles['about']}>Listing...</p>}
              {listing.state === 'failed' && (
                <p className={styles['about']}>
                  {listing.message}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setListing({ state: 'loading' });
                      setAttempt((count) => count + 1);
                    }}
                  >
                    Try again
                  </button>
                </p>
              )}
              {listing.state === 'ready' && listing.items.length === 0 && (
                <p className={styles['about']}>There is no saved text to recover.</p>
              )}
              {listing.state === 'ready' && listing.items.length > 0 && (
                <ul className={styles['list']}>
                  {listing.items.map((iteration) => (
                    <li key={iteration.id}>
                      <button
                        type="button"
                        className={styles['row']}
                        ref={(element) => {
                          if (element) rows.current.set(iteration.id, element);
                          else rows.current.delete(iteration.id);
                        }}
                        aria-label={sentenceCase(iterationLabel(iteration.savedAt))}
                        aria-pressed={chosen?.id === iteration.id}
                        onClick={() => {
                          setRefused(null);
                          setChosen(iteration);
                        }}
                      >
                        <span className={styles['time']}>
                          {savedTime(iteration.savedAt, new Date(), true)}
                        </span>
                        <span className={styles['detail']}>
                          {iteration.thisWindow ? 'This window' : 'Another window'}
                        </span>
                        <span className={styles['detail']}>
                          Version {iteration.openedFrom.number}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {listing.state === 'ready' && listing.next !== null && (
                <button type="button" disabled={busy} onClick={() => void older()}>
                  Show older
                </button>
              )}
            </div>
            <section className={styles['changes']} aria-label="What restoring it changes">
              {chosen === null && (
                <p className={styles['about']}>Choose saved text to see it here.</p>
              )}
              {preview?.state === 'reading' && <p className={styles['about']}>Reading...</p>}
              {preview?.state === 'failed' && <p className={styles['about']}>{preview.message}</p>}
              {preview?.state === 'shown' && preview.changes.length === 0 && (
                <p className={styles['about']}>It is the same as the text on screen.</p>
              )}
              {preview?.state === 'shown' && preview.changes.length > 0 && (
                <ul className={styles['changeList']}>
                  {preview.changes.map((change, at) => (
                    <li key={at} className={styles['change']} data-change={change.kind}>
                      <span className={styles['kind']}>
                        {change.kind === 'added'
                          ? 'Added'
                          : change.kind === 'removed'
                            ? 'Removed'
                            : 'Changed'}
                      </span>
                      {change.kind === 'added' && <ins>{change.text}</ins>}
                      {change.kind === 'removed' && <del>{change.text}</del>}
                      {change.kind === 'edited' && (
                        <span>
                          {change.parts.map((part, index) => (
                            <span key={index}>
                              {index > 0 && ' '}
                              {part.change === 'added' ? (
                                <ins>{part.text}</ins>
                              ) : part.change === 'removed' ? (
                                <del>{part.text}</del>
                              ) : (
                                part.text
                              )}
                            </span>
                          ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {refused !== null && <p className={styles['refused']}>{refused}</p>}
          <div className={styles['actions']}>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              aria-disabled={chosen === null || busy}
              onClick={() => void recover()}
            >
              Recover
            </button>
          </div>
        </div>
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
    </div>,
    document.body,
  );
}
