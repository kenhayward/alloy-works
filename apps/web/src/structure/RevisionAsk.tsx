import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import type { RevisionShown } from './bindingContexts.js';

/** What an act recording a resolution says of the values revised by hand standing (DAT-060). */
export interface RevisionDecision {
  readonly decision: 'withdraw' | 'keep';
  readonly over: readonly string[];
}

/** What the ask shows: what the query returned, the person's value, and the new result where known. */
export interface RevisionAsked {
  readonly standing: readonly RevisionShown[];
  /** The value the binding holds from the query, as the document shows it. */
  readonly queried: string;
  /** The value of the result it is to hold, as the document will show it, where known. */
  readonly next: string | null;
  /** What the act is, in words: `Accept`, `Resolve` or `Keep`. */
  readonly act: string;
}

/** A revision as the ask names it: its value, a cell's column and key besides. */
const revisionSaid = (each: RevisionShown) =>
  each.cell === null
    ? String(each.value)
    : `${String(each.value)} (${each.cell.column}, ${Object.values(each.cell.key).map(String).join(', ')})`;

/**
 * **Never silent over a value revised by hand** (DAT-060; the RV plan, RV-I): before an accept, a
 * resolve or a Keep replaces what a binding holds, `ask` shows the three values - what the query
 * returned, the person's revision, and the new result - and answers **Withdraw my revision** or
 * **Keep my revision**, with the revisions decided over; null where cancelled. Escape, the close
 * button and Cancel each cancel.
 */
export function useRevisionAsk(): {
  readonly ask: (asked: RevisionAsked) => Promise<RevisionDecision | null>;
  readonly prompt: React.ReactNode;
} {
  const [open, setOpen] = useState<RevisionAsked | null>(null);
  const pending = useRef<((answer: RevisionDecision | null) => void) | null>(null);
  const heading = useId();

  const ask = useCallback(
    (asked: RevisionAsked) =>
      new Promise<RevisionDecision | null>((resolve) => {
        pending.current?.(null);
        pending.current = resolve;
        setOpen(asked);
      }),
    [],
  );
  useEffect(() => () => pending.current?.(null), []);

  const answered = (decision: RevisionDecision['decision'] | null) => {
    const resolve = pending.current;
    const asked = open;
    pending.current = null;
    setOpen(null);
    resolve?.(
      decision === null || asked === null
        ? null
        : { decision, over: asked.standing.map((each) => each.id) },
    );
  };

  const prompt =
    open === null ? null : (
      <Modal labelledBy={heading} onClose={() => answered(null)}>
        <section aria-labelledby={heading}>
          <h2 id={heading}>A value revised by hand stands here</h2>
          <dl>
            <dt>The query returned</dt>
            <dd>{open.queried}</dd>
            <dt>Revised by hand</dt>
            {open.standing.map((each) => (
              <dd key={each.id}>
                {`${revisionSaid(each)}, by ${each.by.displayName ?? 'somebody'}: ${each.reason}`}
              </dd>
            ))}
            {open.next !== null && (
              <>
                <dt>The new result</dt>
                <dd>{open.next}</dd>
              </>
            )}
          </dl>
          <p>{`${open.act} replaces what this value holds. Withdraw the revision, or keep it in front of the new result.`}</p>
          <div>
            <button type="button" onClick={() => answered(null)}>
              Cancel
            </button>{' '}
            <button type="button" onClick={() => answered('withdraw')}>
              Withdraw my revision
            </button>{' '}
            <button type="button" className="primary" onClick={() => answered('keep')}>
              Keep my revision
            </button>
          </div>
        </section>
      </Modal>
    );
  return { ask, prompt };
}
