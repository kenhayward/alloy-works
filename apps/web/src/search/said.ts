import { formats, words } from '../words/words.js';

/** A search's answer, as much of it as says its outcome. */
export type SearchSaid =
  | { readonly outcome: 'empty'; readonly message: string }
  | {
      readonly outcome: 'nothing_to_match';
      readonly excluded?: readonly string[];
      readonly message: string;
    }
  | { readonly outcome: 'unknown_field'; readonly name?: string; readonly message: string }
  | {
      readonly outcome: 'results';
      readonly count: number;
      readonly capped: boolean;
      readonly facetsBounded?: boolean;
      readonly message: string;
    };

/** How many changed most recently a capped search ranks: the service's `SEARCH_RANK_BOUND`. */
const BOUND = 1000;

/** The outcome in the reader's language, from what the answer holds (the UI plan, UI-L). */
export function searchSaid(answer: SearchSaid): string {
  switch (answer.outcome) {
    case 'empty':
      return words('search.said.empty');
    case 'nothing_to_match':
      return answer.excluded === undefined || answer.excluded.length === 0
        ? words('search.said.no-words')
        : words('search.said.only-leaves-out', { excluded: formats().list(answer.excluded) });
    case 'unknown_field':
      return answer.name === undefined
        ? answer.message
        : words('search.said.unknown-field', { name: answer.name });
    case 'results':
      if (answer.count === 0) return words('search.said.none');
      if (!answer.capped) return words('search.said.results', { count: answer.count });
      return answer.facetsBounded === true
        ? words('search.said.more-than-bounded', { count: answer.count, bound: BOUND })
        : words('search.said.more-than', { count: answer.count });
  }
}
