import styles from './States.module.css';

/**
 * The states a thing can be in that are real today (build order A8). The review tranche's - draft,
 * in review, in approval, approved, superseded, archived - are drawn and not built.
 */
export type LozengeKind =
  | 'published'
  | 'changedSince'
  | 'neverPublished'
  | 'notApproved'
  | 'beingEdited'
  | 'notYoursToRead';

export function Lozenge({ kind, children }: { kind: LozengeKind; children: React.ReactNode }) {
  return (
    <span className={styles['lozenge']} data-kind={kind}>
      {children}
    </span>
  );
}
