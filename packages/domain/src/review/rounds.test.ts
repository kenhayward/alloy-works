import { describe, expect, it } from 'vitest';

import { reviewerState, roundSummary, type RoundAct } from './rounds.js';

const ADA = 'ada';
const GRACE = 'grace';
const at = (minute: number) => `2026-10-12T10:${String(minute).padStart(2, '0')}:00.000Z`;
const act = (
  reviewer: string,
  minute: number,
  what: RoundAct['act'],
  outcome?: 'commented' | 'nothing_to_say',
): RoundAct => ({
  reviewer,
  at: at(minute),
  act: what,
  ...(outcome === undefined ? {} : { outcome }),
});

describe("a reviewer's state in a round (collaboration.md, Review rounds)", () => {
  it('COL-029 COL-058 is not started until they act, in progress once started, and complete only when they say so', () => {
    expect(reviewerState([])).toEqual({ state: 'not_started' });
    expect(reviewerState([act(ADA, 1, 'started')])).toEqual({ state: 'in_progress' });
    expect(reviewerState([act(ADA, 1, 'started'), act(ADA, 2, 'completed', 'commented')])).toEqual({
      state: 'complete',
      outcome: 'commented',
      at: at(2),
    });
  });

  it('COL-032 tells finishing with nothing to say apart from finishing with comments, and both apart from not having looked', () => {
    expect(reviewerState([act(ADA, 2, 'completed', 'nothing_to_say')])).toMatchObject({
      state: 'complete',
      outcome: 'nothing_to_say',
    });
    expect(reviewerState([])).not.toMatchObject({ state: 'complete' });
  });

  it('COL-057 is in progress again once a completion is reopened, and complete again once completed again', () => {
    const reopened = [act(ADA, 1, 'completed', 'nothing_to_say'), act(ADA, 2, 'reopened')];
    expect(reviewerState(reopened)).toEqual({ state: 'in_progress' });
    expect(reviewerState([...reopened, act(ADA, 3, 'completed', 'commented')])).toMatchObject({
      state: 'complete',
      outcome: 'commented',
    });
  });
});

describe("a round's summary", () => {
  it('COL-030 COL-058 answers whether everybody has reviewed from completions alone, every reviewer by state', () => {
    const acts = [act(ADA, 1, 'completed', 'commented'), act(GRACE, 2, 'started')];
    expect(roundSummary([ADA, GRACE], acts)).toEqual({
      reviewers: [
        { reviewer: ADA, state: 'complete', outcome: 'commented', at: at(1) },
        { reviewer: GRACE, state: 'in_progress' },
      ],
      complete: 1,
      of: 2,
      everybody: false,
    });
    expect(
      roundSummary([ADA, GRACE], [...acts, act(GRACE, 3, 'completed', 'nothing_to_say')]).everybody,
    ).toBe(true);
    // An act by somebody no longer, or never, a reviewer counts for nobody.
    expect(roundSummary([ADA], [act(GRACE, 1, 'completed', 'commented')])).toMatchObject({
      complete: 0,
      of: 1,
      everybody: false,
    });
  });
});
