import type { FileCondition, FileFetch } from '@alloy-works/domain';

import type { FilterDraft } from './definitionDraft.js';
import {
  draftOfPart,
  formatDraftOf,
  NEW_FORMAT,
  shownPart,
  type FormatDraft,
  type PartDraft,
} from './httpDraft.js';

/**
 * A file as its page holds it while it is written (the D6 plan, task 2): the object's key, a segment
 * each, fixed text or a parameter placed whole; the format its rows are read in; and filters over
 * the declared columns, joined by all or any, which the connector applies to the file's own rows.
 * Pure, so each rule is tested without a page.
 */
export interface FileDraft extends FormatDraft {
  readonly key: readonly PartDraft[];
  readonly filters: readonly FilterDraft[];
  readonly match: 'all' | 'any';
}

export const NEW_FILE: FileDraft = {
  ...NEW_FORMAT,
  format: 'csv',
  key: [],
  filters: [],
  match: 'all',
};

/** One comparison as a filter row holds it, or undefined where a row cannot hold it. */
function filterOf(condition: FileCondition): FilterDraft | undefined {
  if (!('column' in condition)) return undefined;
  const { column, is, to } = condition;
  if (to === undefined) return { column, is, to: { value: '', type: { base: 'text' } } };
  if ('parameter' in to) return { column, is, to: { parameter: to.parameter } };
  if (Array.isArray(to.literal)) return undefined;
  return { column, is, to: { value: String(to.literal), type: to.type } };
}

/** A stored file fetch as the page holds it, or why the page cannot show it to edit. */
export function fileDraftOf(stored: FileFetch): FileDraft | { readonly reason: string } {
  const unshown = {
    reason:
      'Its filter holds more than a list of comparisons matched all or any, which this page cannot show to edit.',
  };
  let filters: FilterDraft[] = [];
  let match: FileDraft['match'] = 'all';
  const { where } = stored;
  if (where !== undefined) {
    const each = 'and' in where ? where.and : 'or' in where ? where.or : [where];
    match = 'or' in where ? 'any' : 'all';
    const read = each.map(filterOf);
    if (read.some((filter) => filter === undefined)) return unshown;
    filters = read as FilterDraft[];
  }
  return {
    ...formatDraftOf(stored.format),
    key: stored.key.map(draftOfPart),
    filters,
    match,
  };
}

/** A file's key as its reader is shown it: its segments, a parameter by its name in braces. */
export function fileText(fetch: FileFetch): string {
  return fetch.key.map(shownPart).join('/');
}
