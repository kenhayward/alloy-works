import { Chip, type ChipTone } from '../parts/Chip.js';

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

/** Each state's tone, by what it means (ADR-0046): not approved and behind are warn, editing info. */
const TONES: Readonly<Record<LozengeKind, ChipTone>> = {
  published: 'ok',
  changedSince: 'warn',
  neverPublished: 'neutral',
  notApproved: 'warn',
  beingEdited: 'info',
  notYoursToRead: 'neutral',
};

/** A state, as a chip in its tone (LG5). */
export function Lozenge({ kind, children }: { kind: LozengeKind; children: React.ReactNode }) {
  return (
    <Chip tone={TONES[kind]} data-kind={kind}>
      {children}
    </Chip>
  );
}
