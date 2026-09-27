import type { SearchAnswerView, SearchQuery } from '@alloy-works/api-contract';
import { searchWords, type SearchAnswer, type Tenant, type TenantDatabase } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import type { SessionPrincipal } from './sessions.js';

/** A list said as a reader says it: `a`, `a and b`, `a, b and c`. */
function listed(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * Each outcome in a sentence (search.md, "The query"; SCH-039): what was asked and why there is
 * nothing to show, or how many there are. Plain hyphens only, as every string a reader sees.
 */
export function sentenceFor(answer: SearchAnswer): string {
  switch (answer.outcome) {
    case 'empty':
      return 'Type what to look for.';
    case 'nothing_to_match':
      return answer.excluded.length === 0
        ? 'Nothing to look for: the search holds no words.'
        : `Nothing to look for: the search only leaves out ${listed(answer.excluded)}. Add a word to look for.`;
    case 'unknown_field':
      return `No field you can see is called ${answer.name}, so nothing can be looked for in it.`;
    case 'results':
      if (answer.count === 0) return 'Nothing you can see matches this search.';
      if (answer.capped) return `More than ${answer.count.toLocaleString('en-GB')} results.`;
      return answer.count === 1 ? '1 result.' : `${answer.count.toLocaleString('en-GB')} results.`;
  }
}

function view(answer: SearchAnswer): SearchAnswerView {
  const message = sentenceFor(answer);
  if (answer.outcome === 'nothing_to_match') {
    return { outcome: answer.outcome, excluded: [...answer.excluded], message };
  }
  if (answer.outcome !== 'results') return { ...answer, message };
  return {
    outcome: 'results',
    count: answer.count,
    capped: answer.capped,
    message,
    items: answer.items.map((each) => ({
      kind: each.kind,
      artifactId: each.artifactId,
      node: each.node,
      title: each.title,
      space:
        each.spaceId === null || each.spaceName === null
          ? null
          : { id: each.spaceId, name: each.spaceName },
      changedAt: each.changedAt.toISOString(),
      place: each.place,
      passage: each.passage.map((piece) => ({ ...piece })),
    })),
  };
}

export function searchHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    // Anybody signed in may search, over what they may read (search.md, SE-H).
    search: async (request: FastifyRequest): Promise<SearchAnswerView> => {
      const query = request.query as SearchQuery;
      const answer = await db.withTenant(tenantOf(request), (trx) =>
        searchWords(trx, principalOf(request).principalId, query.q ?? '', {
          ...(query.offset === undefined ? {} : { offset: Number(query.offset) }),
          ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
        }),
      );
      // A session names a principal the environment holds; one that has gone reads nothing.
      return view(answer ?? { outcome: 'results', count: 0, capped: false, items: [] });
    },
  };
}
