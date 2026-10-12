/**
 * A reviewer's act in a round (collaboration.md, Review rounds; the RR plan, RR-A, RR-D): started,
 * completed with an outcome, or a completion reopened - each a person's explicit statement, never
 * read from what they did elsewhere.
 */
export interface RoundAct {
  readonly reviewer: string;
  readonly act: 'started' | 'completed' | 'reopened';
  /** A completion's: finished with comments, or with nothing to say (COL-032). */
  readonly outcome?: 'commented' | 'nothing_to_say';
  readonly at: string;
}

/** Where one reviewer stands (COL-029). */
export type ReviewerState =
  | { readonly state: 'not_started' }
  | { readonly state: 'in_progress' }
  | {
      readonly state: 'complete';
      readonly outcome: 'commented' | 'nothing_to_say';
      readonly at: string;
    };

/**
 * **A reviewer's state from their own acts, in order** (COL-029, COL-058; RR-D): complete where their
 * latest act is a completion, saying how; in progress where they have started or reopened; not started
 * otherwise. Nothing is read from silence: no act, no state but not started.
 */
export function reviewerState(acts: readonly RoundAct[]): ReviewerState {
  const latest = acts.at(-1);
  if (latest === undefined) return { state: 'not_started' };
  if (latest.act === 'completed') {
    return { state: 'complete', outcome: latest.outcome ?? 'commented', at: latest.at };
  }
  return { state: 'in_progress' };
}

/** Whether everybody on a round has reviewed it, and where each stands (COL-030). */
export interface RoundSummary {
  readonly reviewers: readonly ({ readonly reviewer: string } & ReviewerState)[];
  readonly complete: number;
  readonly of: number;
  readonly everybody: boolean;
}

/**
 * **"Has everybody reviewed this"** (COL-030, COL-058; RR-E): each named reviewer's state from their
 * own acts, in the order given, and how many are complete of all - answered from explicit completion
 * alone. An act by anybody not named counts for nobody.
 */
export function roundSummary(
  reviewers: readonly string[],
  acts: readonly RoundAct[],
): RoundSummary {
  const shown = reviewers.map((reviewer) => ({
    reviewer,
    ...reviewerState(acts.filter((each) => each.reviewer === reviewer)),
  }));
  const complete = shown.filter((each) => each.state === 'complete').length;
  return {
    reviewers: shown,
    complete,
    of: reviewers.length,
    everybody: reviewers.length > 0 && complete === reviewers.length,
  };
}
