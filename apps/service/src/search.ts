import type { SearchAnswerView, SearchQuery } from '@alloy-works/api-contract';
import {
  SEARCH_RANK_BOUND,
  searchWords,
  type SearchAnswer,
  type SearchFilters,
  type Tenant,
  type TenantDatabase,
  openLinesOf,
  readsOnlyShares,
  translationsOf,
  type Translation,
} from '@alloy-works/db';
import type { SearchKind } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { listedTranslations } from './components.js';
import { AppError } from './errors.js';
import type { ConnectorOptions } from './data/connections.js';
import { meaningSearcher, type MeaningState } from './generation/meaning.js';
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
      // Past the bound the latest and every version rank only their most recently changed matches
      // (SV3-C): the count is capped exactly when the ranking is bounded.
      if (answer.capped) {
        return answer.facetsBounded
          ? `More than ${answer.count.toLocaleString('en-GB')} results. Showing the best matches among the ${SEARCH_RANK_BOUND.toLocaleString('en-GB')} changed most recently.`
          : `More than ${answer.count.toLocaleString('en-GB')} results.`;
      }
      return answer.count === 1 ? '1 result.' : `${answer.count.toLocaleString('en-GB')} results.`;
  }
}

function view(
  answer: SearchAnswer,
  open: ReadonlyMap<string, readonly string[]> = new Map(),
  /** Somebody shared a publication alone: named no space and nobody (the R17 plan, R17-I). */
  outside = false,
  /** Whether meaning was searched beside the words (the G7 plan, G7-I). */
  meaning: MeaningState = 'skipped',
  /** Each component found's translations (LOC-016; TE-B). */
  translated: ReadonlyMap<string, readonly Translation[]> = new Map(),
): SearchAnswerView {
  const message = sentenceFor(answer);
  if (answer.outcome === 'nothing_to_match') {
    return { outcome: answer.outcome, excluded: [...answer.excluded], message };
  }
  if (answer.outcome !== 'results') return { ...answer, message };
  return {
    outcome: 'results',
    count: answer.count,
    capped: answer.capped,
    facetsBounded: answer.facetsBounded,
    meaning,
    message,
    facets: {
      kinds: answer.facets.kinds.map((each) => ({ ...each })),
      spaces: outside ? [] : answer.facets.spaces.map((each) => ({ ...each })),
      componentTypes: answer.facets.componentTypes.map((each) => ({ ...each })),
      owners: outside ? [] : answer.facets.owners.map((each) => ({ ...each })),
      states: answer.facets.states.map((each) => ({ ...each })),
      changed: answer.facets.changed.map((each) => ({ ...each })),
      fields: answer.facets.fields.map((each) => ({
        ...each,
        values: each.values.map((value) => ({ ...value })),
      })),
      conditions: answer.facets.conditions.map((each) => ({
        ...each,
        values: each.values.map((value) => ({ ...value })),
      })),
      relations: answer.facets.relations.map((each) => ({
        ...each,
        values: each.values.map((value) => ({ ...value })),
      })),
    },
    items: answer.items.map((each) => ({
      kind: each.kind,
      artifactId: each.artifactId,
      node: each.node,
      title: each.title,
      space:
        outside || each.spaceId === null || each.spaceName === null
          ? null
          : { id: each.spaceId, name: each.spaceName },
      changedAt: each.changedAt.toISOString(),
      place: each.place,
      passage: each.passage.map((piece) => ({ ...piece })),
      version: each.version === null ? null : { ...each.version },
      baseline: each.baseline === null ? null : { ...each.baseline },
      thread: each.thread === null ? null : { ...each.thread },
      state: each.state === null ? null : { ...each.state },
      // A component diverged says so (LIF-046; R16-E).
      ...(each.kind === 'component' && open.has(each.artifactId)
        ? { lines: [...open.get(each.artifactId)!] }
        : {}),
      // And its translations, each with its status (LOC-016; TE-B).
      ...(each.kind === 'component' ? listedTranslations(translated, each.artifactId) : {}),
      section:
        each.section === null
          ? null
          : {
              document: { ...each.section.document },
              components: each.section.components.map((component) => ({ ...component })),
            },
      found: each.found,
    })),
  };
}

/**
 * The filters a query string names (search.md, "Filters and facets"), each already held to its shape by
 * the contract: a list separated by commas, a named range or days, and each field value as its id and
 * the value after the first colon.
 */
export function filtersOf(query: SearchQuery): SearchFilters {
  const list = (value: string | undefined) => (value === undefined ? undefined : value.split(','));
  const values = query.value === undefined ? [] : [query.value].flat();
  const conditions = query.condition === undefined ? [] : [query.condition].flat();
  const related = query.related === undefined ? [] : [query.related].flat();
  const changed =
    query.changed !== undefined
      ? { within: query.changed }
      : query.changedFrom !== undefined || query.changedTo !== undefined
        ? {
            ...(query.changedFrom === undefined ? {} : { from: query.changedFrom }),
            ...(query.changedTo === undefined ? {} : { to: query.changedTo }),
          }
        : undefined;
  const kinds = list(query.kind) as SearchKind[] | undefined;
  const spaces = list(query.space);
  const componentTypes = list(query.type);
  const owners = list(query.owner);
  const states = list(query.state);
  return {
    ...(kinds === undefined ? {} : { kinds }),
    ...(spaces === undefined ? {} : { spaces }),
    ...(componentTypes === undefined ? {} : { componentTypes }),
    ...(owners === undefined ? {} : { owners }),
    ...(states === undefined ? {} : { states }),
    ...(changed === undefined ? {} : { changed }),
    ...(query.internal === undefined ? {} : { internal: query.internal === 'true' }),
    ...(values.length === 0
      ? {}
      : {
          values: values.map((each) => {
            const colon = each.indexOf(':');
            return { field: each.slice(0, colon), value: each.slice(colon + 1) };
          }),
        }),
    ...(conditions.length === 0 ? {} : { conditions }),
    ...(related.length === 0
      ? {}
      : {
          // A type's id and a field's are UUIDs, so the value is everything after the second colon.
          relations: related.map((each) => ({
            type: each.slice(0, 36),
            field: each.slice(37, 73),
            value: each.slice(74),
          })),
        }),
  };
}

export function searchHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
  connector?: ConnectorOptions,
) {
  const meaningOf = meaningSearcher(db, connector);
  return {
    // Anybody signed in may search, over what they may read (search.md, SE-H).
    search: async (request: FastifyRequest): Promise<SearchAnswerView> => {
      const query = request.query as SearchQuery;
      // Every version or one baseline, never both (the SV plan, SV-C); the latest with one is the baseline.
      if (query.versions === 'all' && query.baseline !== undefined) {
        throw new AppError(
          400,
          'invalid_request',
          'Search every version or one baseline, not both.',
        );
      }
      const filters = filtersOf(query);
      // Meaning, beside the words, for the latest alone (the G7 plan, G7-G).
      const meaning = await meaningOf(
        request,
        tenantOf(request),
        principalOf(request).principalId,
        {
          q: query.q ?? '',
          latest: query.baseline === undefined && (query.versions ?? 'latest') === 'latest',
          filters: {
            ...(filters.kinds === undefined ? {} : { kinds: filters.kinds }),
            ...(filters.spaces === undefined ? {} : { spaces: filters.spaces }),
            ...(filters.componentTypes === undefined
              ? {}
              : { componentTypes: filters.componentTypes }),
            ...(filters.owners === undefined ? {} : { owners: filters.owners }),
            ...(filters.states === undefined ? {} : { states: filters.states }),
            ...(filters.changed === undefined ? {} : { changed: filters.changed }),
          },
        },
      );
      const { answer, open, outside, translated } = await db.withTenant(
        tenantOf(request),
        async (trx) => {
          const found = await searchWords(trx, principalOf(request).principalId, query.q ?? '', {
            ...(meaning.hits.length === 0 ? {} : { meaning: meaning.hits }),
            ...(query.offset === undefined ? {} : { offset: Number(query.offset) }),
            ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
            filters,
            scope:
              query.baseline === undefined
                ? (query.versions ?? 'latest')
                : { baseline: query.baseline },
          });
          // The open lines of each component found: of results the reader may read alone.
          const components =
            found !== undefined && found !== 'baseline_not_found' && found.outcome === 'results'
              ? found.items
                  .filter((each) => each.kind === 'component')
                  .map((each) => each.artifactId)
              : [];
          return {
            answer: found,
            open: await openLinesOf(trx, components),
            outside: await readsOnlyShares(trx, principalOf(request).principalId),
            // Read only of what the reader was found to read, so none they may not is named.
            translated: await translationsOf(trx, components),
          };
        },
      );
      if (answer === 'baseline_not_found') {
        throw new AppError(
          404,
          'baseline_not_found',
          'There is no baseline you can read by that id.',
        );
      }
      // A session names a principal the environment holds; one that has gone reads nothing.
      return view(
        answer ?? {
          outcome: 'results',
          count: 0,
          capped: false,
          facetsBounded: false,
          items: [],
          facets: {
            kinds: [],
            spaces: [],
            componentTypes: [],
            owners: [],
            states: [],
            changed: [],
            fields: [],
            conditions: [],
            relations: [],
          },
        },
        open,
        outside,
        meaning.state,
        translated,
      );
    },
  };
}
