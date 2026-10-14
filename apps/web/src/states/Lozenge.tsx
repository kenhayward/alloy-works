import { Chip, type ChipTone } from '../parts/Chip.js';

/**
 * The states a thing can be in that are real today (build order A8). Of the review tranche's - draft,
 * in review, in approval, approved, superseded, archived - the seed workflow's three are built (the WF1
 * plan, WF-G); the rest are drawn and not built.
 */
export type LozengeKind =
  | 'published'
  | 'changedSince'
  | 'neverPublished'
  | 'notApproved'
  | 'beingEdited'
  | 'notYoursToRead'
  | 'draft'
  | 'inReview'
  | 'approved';

/** Each state's tone, by what it means (ADR-0046): not approved and behind are warn, editing info. */
const TONES: Readonly<Record<LozengeKind, ChipTone>> = {
  published: 'ok',
  changedSince: 'warn',
  neverPublished: 'neutral',
  notApproved: 'warn',
  beingEdited: 'info',
  notYoursToRead: 'neutral',
  draft: 'neutral',
  inReview: 'info',
  approved: 'ok',
};

/** A state, as a chip in its tone (LG5). */
export function Lozenge({ kind, children }: { kind: LozengeKind; children: React.ReactNode }) {
  return (
    <Chip tone={TONES[kind]} data-kind={kind}>
      {children}
    </Chip>
  );
}

/** The seed workflow's states, by key, as the lozenges drawn for them. */
const SEEDED: Readonly<Record<string, LozengeKind>> = {
  draft: 'draft',
  in_review: 'inReview',
  approved: 'approved',
};

/**
 * A workflow state, by the name its workflow gives it (LIF-005): the seed's in their own tones, any
 * other a tenant declares a neutral fact.
 */
export function StateLozenge({
  state,
}: {
  state: { readonly key: string; readonly name: string };
}) {
  const kind = Object.hasOwn(SEEDED, state.key) ? SEEDED[state.key] : undefined;
  return kind === undefined ? (
    <Chip data-kind="state">{state.name}</Chip>
  ) : (
    <Lozenge kind={kind}>{state.name}</Lozenge>
  );
}
