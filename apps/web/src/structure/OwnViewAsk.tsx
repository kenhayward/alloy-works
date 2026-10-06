import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Modal } from '../layouts/Modal.js';
import { OWN_VIEW_WARNING } from './ownView.js';

/**
 * DAT-091's warning, asked before a person's own view is held (the D7 plan, D7-H): `ask` opens it and
 * answers whether they agreed; `prompt` is the dialog, drawn wherever the page puts it. Escape, the
 * close button and Cancel each answer no.
 */
export function useOwnViewAsk(): {
  readonly ask: () => Promise<boolean>;
  readonly prompt: React.ReactNode;
} {
  const [answer, setAnswer] = useState<((agreed: boolean) => void) | null>(null);
  const pending = useRef<((agreed: boolean) => void) | null>(null);
  const heading = useId();

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        // A second ask while one is open answers the first no.
        pending.current?.(false);
        pending.current = resolve;
        setAnswer(() => resolve);
      }),
    [],
  );
  // Gone with the page: an ask still open answers no.
  useEffect(() => () => pending.current?.(false), []);

  const answered = (agreed: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setAnswer(null);
    resolve?.(agreed);
  };

  const prompt =
    answer === null ? null : (
      <Modal labelledBy={heading} onClose={() => answered(false)}>
        <section aria-labelledby={heading}>
          <h2 id={heading}>Hold your own view?</h2>
          <p>{OWN_VIEW_WARNING}</p>
          <div>
            <button type="button" onClick={() => answered(false)}>
              Cancel
            </button>{' '}
            <button type="button" className="primary" onClick={() => answered(true)}>
              Hold my own view
            </button>
          </div>
        </section>
      </Modal>
    );
  return { ask, prompt };
}
