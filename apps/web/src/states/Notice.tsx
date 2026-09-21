import styles from './States.module.css';

/** Which of the product's sentences this is: each has its own look, and they are not interchangeable. */
export type NoticeTone = 'failed' | 'signedOut' | 'readOnly' | 'refused' | 'withdrawn' | 'editing';

/**
 * Something could not be done, or is not the reader's to change: the sentence, with an edge and a
 * tint for its tone, and - for a failure - the Try again beside it. The words are the caller's.
 */
export function Notice({ tone, children }: { tone: NoticeTone; children: React.ReactNode }) {
  return (
    <div className={styles['notice']} data-tone={tone}>
      {children}
    </div>
  );
}
