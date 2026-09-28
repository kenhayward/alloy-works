import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';

import { iterationLabel, savedTime } from './recovery.js';
import styles from './RecoveryPanel.module.css';
import type { IterationPage, SavedIteration } from './session.js';

export interface RecoveryPanelProps {
  /** A page of the author's own saved iterations, newest first: the first, or the one after `cursor`. */
  readonly load: (cursor?: string) => Promise<IterationPage>;
  /** Restores one; answers null once restored, or why it was not, which the panel shows beside it. */
  readonly restore: (iteration: SavedIteration) => Promise<string | null>;
  /** Closes the list, and the author goes on editing what is on screen. */
  readonly onClose: () => void;
  /** The region's element, one of the regions `F6` moves between while it is shown (CNT-077). */
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

/** Why a page could not be listed, in the author's words. */
const failure = (code: Extract<IterationPage, { ok: false }>['code']): string =>
  code === 'lock_held' || code === 'lock_required'
    ? 'This session no longer holds the component, so its saved text cannot be listed.'
    : code === 'signed_out'
      ? 'You are signed out. Sign in again to list your saved text.'
      : 'Your saved text could not be listed.';

/**
 * The Recovery panel (component-editor.md, "Recovery, as W11 builds it"; CNT-090): the author's own
 * saved iterations of this component, newest first, each with when it was saved, from which window,
 * and the version it was written against, a page at a time behind **Show older**. **Restore** puts one
 * back in place of what is on screen, which is saved first.
 *
 * The focus comes here as it opens, so the list is where the author is; `Escape` or **Close** leave it.
 * Nothing here is a live region: what happens is said through the editor's one status region, and a
 * refusal is also shown here, beside what it refused.
 */
export function RecoveryPanel({ load, restore, onClose, ref }: RecoveryPanelProps) {
  const heading = useId();
  const own = useRef<HTMLElement | null>(null);
  useImperativeHandle(ref, () => own.current!, []);
  const [listing, setListing] = useState<Listing>({ state: 'loading' });
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Asked afresh by Try again.
  const [attempt, setAttempt] = useState(0);
  // The first row a Show older added, which takes the focus once it is drawn.
  const [landing, setLanding] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  // Held in a ref, so a parent passing a new function on every render lists nothing again.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    own.current?.focus();
  }, []);

  useEffect(() => {
    let current = true;
    void loadRef.current().then((page) => {
      if (!current) return;
      setListing(
        page.ok
          ? { state: 'ready', items: page.items, next: page.next }
          : { state: 'failed', message: failure(page.code) },
      );
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (landing === null) return;
    rows.current.get(landing)?.focus();
    setLanding(null);
  }, [landing, listing]);

  const older = async () => {
    if (listing.state !== 'ready' || listing.next === null) return;
    setBusy(true);
    const page = await loadRef.current(listing.next);
    setBusy(false);
    if (!page.ok) {
      setRefused(failure(page.code));
      return;
    }
    setListing({
      state: 'ready',
      items: [...listing.items, ...page.items],
      next: page.next,
    });
    if (page.items[0]) setLanding(page.items[0].id);
  };

  const restoring = async (iteration: SavedIteration) => {
    setBusy(true);
    setRefused(null);
    const why = await restore(iteration);
    // Restored, the panel is gone; refused, it stays with the reason beside the list.
    if (why !== null) {
      setBusy(false);
      setRefused(why);
    }
  };

  return (
    <section
      ref={own}
      className={styles['panel']}
      aria-labelledby={heading}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <h3 id={heading} className={styles['heading']}>
        Saved text
      </h3>
      <p className={styles['about']}>
        Restore puts saved text in place of what is on screen. What is on screen is saved first, so
        it can be restored too.
      </p>
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
        <p className={styles['about']}>There is no saved text to restore.</p>
      )}
      {listing.state === 'ready' && listing.items.length > 0 && (
        <ul className={styles['list']}>
          {listing.items.map((iteration) => {
            const label = iterationLabel(iteration.savedAt);
            return (
              <li key={iteration.id} className={styles['row']}>
                <span className={styles['time']}>
                  {savedTime(iteration.savedAt, new Date(), true)}
                </span>
                <span className={styles['detail']}>
                  {iteration.thisWindow ? 'This window' : 'Another window'}
                </span>
                <span className={styles['detail']}>Version {iteration.openedFrom.number}</span>
                <button
                  type="button"
                  ref={(element) => {
                    if (element) rows.current.set(iteration.id, element);
                    else rows.current.delete(iteration.id);
                  }}
                  aria-label={`Restore ${label}`}
                  disabled={busy}
                  onClick={() => void restoring(iteration)}
                >
                  Restore
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {refused !== null && <p className={styles['refused']}>{refused}</p>}
      <div className={styles['actions']}>
        {listing.state === 'ready' && listing.next !== null && (
          <button type="button" disabled={busy} onClick={() => void older()}>
            Show older
          </button>
        )}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}
