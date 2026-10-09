import { useId, useRef, useState } from 'react';

import { Icon } from '../editor/Icon.js';
import { Modal } from '../layouts/Modal.js';
import styles from './parts.module.css';

/**
 * Removing anything asks first (ADR-0049, decision 6): a 480px dialog named by its question, saying
 * what goes with it, the focus on keeping, and a filled danger button that acts once, however often
 * it is pressed. Escape keeps.
 */
export function ConfirmDialog({
  question,
  sentence,
  detail,
  keep,
  act,
  onKeep,
  onAct,
}: {
  question: string;
  sentence: string;
  /** What else goes, such as a group's members, set apart under the sentence. */
  detail?: React.ReactNode;
  keep: string;
  act: string;
  onKeep: () => void;
  /** The removal; it rejects where it failed, so it may be tried again. */
  onAct: () => Promise<void>;
}) {
  const id = useId();
  const [acting, setActing] = useState(false);
  // Held apart from the state, so a second press before the page redraws is still the same act.
  const busy = useRef(false);
  return (
    <Modal labelledBy={id} size="dialog" onClose={onKeep}>
      <div className={styles['confirm']}>
        <span className={styles['confirmIcon']}>
          <Icon name="Delete" />
        </span>
        <div>
          <h2 id={id}>{question}</h2>
          <p>{sentence}</p>
          {detail !== undefined && <div className={styles['confirmDetail']}>{detail}</div>}
        </div>
      </div>
      <div className={styles['confirmActions']}>
        <button type="button" data-autofocus onClick={onKeep}>
          {keep}
        </button>
        <button
          type="button"
          className={styles['danger']}
          data-tone="danger"
          aria-disabled={acting}
          onClick={() => {
            if (busy.current) return;
            busy.current = true;
            setActing(true);
            // Done, it stays done until its owner closes it; failed, it may be pressed again.
            onAct().catch(() => {
              busy.current = false;
              setActing(false);
            });
          }}
        >
          {act}
        </button>
      </div>
    </Modal>
  );
}
