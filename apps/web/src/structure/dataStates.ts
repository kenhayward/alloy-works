import type { BindingState } from './bindingContexts.js';
import { stateWord, type LozengeKind } from '../states/Lozenge.js';

/** A binding's state in the Data tab, one of the design's (bindings.md, "The Data tab"). */
export type DataState =
  'never' | 'stale' | 'failed' | 'waiting' | 'definition' | 'revised' | 'published' | 'holding';

/** Each state's lozenge, in the design's order, which the filter offers them in. */
export const DATA_STATE_KINDS = {
  never: 'neverResolved',
  stale: 'changedSinceResolved',
  failed: 'failed',
  waiting: 'revisionWaiting',
  definition: 'definitionChanged',
  revised: 'revisedByHand',
  published: 'changedSincePublished',
  holding: 'holding',
} as const satisfies Record<DataState, LozengeKind>;

/** Each state in words, as the filter names them. */
export const DATA_STATE_WORDS = {
  get never() {
    return stateWord(DATA_STATE_KINDS.never);
  },
  get stale() {
    return stateWord(DATA_STATE_KINDS.stale);
  },
  get failed() {
    return stateWord(DATA_STATE_KINDS.failed);
  },
  get waiting() {
    return stateWord(DATA_STATE_KINDS.waiting);
  },
  get definition() {
    return stateWord(DATA_STATE_KINDS.definition);
  },
  get revised() {
    return stateWord(DATA_STATE_KINDS.revised);
  },
  get published() {
    return stateWord(DATA_STATE_KINDS.published);
  },
  get holding() {
    return stateWord(DATA_STATE_KINDS.holding);
  },
} as const satisfies Record<DataState, string>;

/**
 * **A binding's state** (B4-C): the first of the design's that holds, from what the view answered and
 * whether the check this page made failed for it - which the service records nowhere (DAT-086) - and,
 * for a bound table's, whether `checkTable` fails it (the TB2 plan, TB2-H): a table holding a result
 * it cannot lay out holds nothing a reader sees.
 */
export function dataState(
  view: BindingState,
  checkFailed: boolean,
  tableFailed = false,
): DataState {
  if (view.unread) return 'failed';
  const { held } = view;
  if (held === null) return 'never';
  if (held.stale) return 'stale';
  if (tableFailed) return 'failed';
  // A bound table's binding holds the whole result, which it takes nothing from (TB1-C).
  const holds = held.taken !== null && ('value' in held.taken || 'table' in held.taken);
  if (checkFailed || !holds) return 'failed';
  // A person's value on a row the result no longer has fails the publish (DAT-063).
  const standing = (view.revisions ?? []).filter((each) => each.stands);
  if (standing.some((each) => each.rowMissing === true || each.columnUnavailable === true)) {
    return 'failed';
  }
  if (view.waiting !== null) return 'waiting';
  if (view.definitionChanged) return 'definition';
  if (standing.length > 0) return 'revised';
  if (view.sincePublished !== null) return 'published';
  return 'holding';
}
