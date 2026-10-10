export {
  configurationFor,
  entriesOf,
  SEARCH_CONFIGURATIONS,
  searchKinds,
  wordsByBlock,
} from './entries.js';
export type {
  BlockWords,
  SearchConfiguration,
  SearchContext,
  SearchEntryDraft,
  SearchKind,
  SearchSource,
  SearchText,
} from './entries.js';
export { parseQuery } from './query.js';
export type { ParsedQuery, ScopedTerm } from './query.js';
