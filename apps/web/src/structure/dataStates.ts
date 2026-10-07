import type { BindingState } from './bindingContexts.js';

/** A binding's state in the Data tab, one of the design's (bindings.md, "The Data tab"). */
export type DataState =
  'never' | 'stale' | 'failed' | 'waiting' | 'definition' | 'published' | 'holding';

/** Each state in words, in the design's order, which the filter offers them in. */
export const DATA_STATE_WORDS = {
  never: 'Never resolved',
  stale: 'Changed since resolved',
  failed: 'Failed',
  waiting: 'Revision waiting',
  definition: 'Definition changed',
  published: 'Changed since published',
  holding: 'Holding',
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
  if (view.waiting !== null) return 'waiting';
  if (view.definitionChanged) return 'definition';
  if (view.sincePublished !== null) return 'published';
  return 'holding';
}
