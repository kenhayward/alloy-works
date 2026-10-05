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
 * whether the check this page made failed for it - which the service records nowhere (DAT-086).
 */
export function dataState(view: BindingState, checkFailed: boolean): DataState {
  if (view.unread) return 'failed';
  const { held } = view;
  if (held === null) return 'never';
  if (held.stale) return 'stale';
  if (checkFailed || held.taken === null || !('value' in held.taken)) return 'failed';
  if (view.waiting !== null) return 'waiting';
  if (view.definitionChanged) return 'definition';
  if (view.sincePublished !== null) return 'published';
  return 'holding';
}
