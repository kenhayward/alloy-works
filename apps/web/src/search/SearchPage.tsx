import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Notice } from '../states/Notice.js';
import { Chip } from '../parts/Chip.js';
import { StateLozenge } from '../states/Lozenge.js';
import { PlaceIntoButton } from '../structure/PlaceSection.js';
import { resultLink, whereFound, type SearchScope } from './links.js';
import { searchSaid, type SearchSaid } from './said.js';
import styles from './SearchPage.module.css';
import { formats, words, wordsWith } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

interface FacetValue {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly capped: boolean;
}

interface Result {
  readonly kind: string;
  readonly artifactId: string;
  readonly node: string | null;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string } | null;
  readonly changedAt: string;
  readonly place: string | null;
  readonly passage: readonly { readonly text: string; readonly matched: boolean }[];
  readonly version?: {
    readonly id: string;
    readonly number: string;
    readonly latest: boolean;
  } | null;
  readonly baseline?: {
    readonly id: string;
    readonly name: string;
    readonly document: string;
    readonly node: string | null;
  } | null;
  readonly thread?: {
    readonly id: string;
    readonly on: 'component' | 'document';
    readonly resolved: boolean;
  } | null;
  /** A component's or a document's state now, a section's its document's (WF-H). */
  readonly state?: { readonly key: string; readonly name: string } | null;
  /** A component's open divergent lines (LIF-046); absent where it has not diverged. */
  readonly lines?: readonly string[];
  /** How it was found (SCH-014; the G7 plan): absent from a service before G7, which finds by words. */
  readonly found?: 'words' | 'meaning' | 'both';
  /** A section's document and the components it places (SCH-053); absent from a service before R14. */
  readonly section?: {
    readonly document: { readonly id: string; readonly title: string };
    readonly components: readonly { readonly id: string; readonly title: string }[];
  } | null;
}

interface Facets {
  readonly kinds: readonly FacetValue[];
  /** Absent from a service before workflow (WF-H). */
  readonly states?: readonly FacetValue[];
  readonly spaces: readonly FacetValue[];
  readonly componentTypes: readonly FacetValue[];
  readonly owners: readonly FacetValue[];
  readonly changed: readonly FacetValue[];
  readonly fields: readonly {
    readonly field: string;
    readonly name: string;
    readonly dataType: string;
    readonly values: readonly FacetValue[];
  }[];
  /** Absent from a service before R14 (SCH-061). */
  readonly conditions?: readonly {
    readonly axis: string;
    readonly values: readonly FacetValue[];
  }[];
  /** Absent from a service before R14 (SCH-063). */
  readonly relations?: readonly {
    readonly type: string;
    readonly typeName: string;
    readonly field: string;
    readonly name: string;
    readonly dataType: string;
    readonly values: readonly FacetValue[];
  }[];
}

type Answer =
  | Exclude<SearchSaid, { readonly outcome: 'results' }>
  | {
      readonly outcome: 'results';
      readonly message: string;
      readonly count: number;
      readonly capped: boolean;
      readonly facetsBounded?: boolean;
      readonly items: readonly Result[];
      readonly facets: Facets;
      /** Whether meaning was searched beside the words (the G7 plan, G7-I). */
      readonly meaning?: 'used' | 'unavailable' | 'unconfigured' | 'skipped';
    };

/** What narrows the search: each dimension's chosen values, and a field's as `<field>:<value>`. */
interface Chosen {
  readonly kinds: readonly string[];
  readonly states: readonly string[];
  readonly spaces: readonly string[];
  readonly componentTypes: readonly string[];
  readonly owners: readonly string[];
  readonly changed: string | null;
  readonly values: readonly string[];
  /** Each `<axis>:<value>` (SCH-061). */
  readonly conditions: readonly string[];
  /** Each `<type>:<field>:<value>` (SCH-063). */
  readonly related: readonly string[];
}

const LATEST: SearchScope = { versions: 'latest', baseline: null };

/** Which version or baseline a result was found in, or that a thread is resolved; else null. */
const foundIn = (item: Result): string | null =>
  item.thread?.resolved
    ? words('search.resolved')
    : item.baseline
      ? words('search.in-baseline', { name: item.baseline.name })
      : item.version && !item.version.latest
        ? words('search.version-earlier', { number: item.version.number })
        : null;

const NOTHING_CHOSEN: Chosen = {
  kinds: [],
  states: [],
  spaces: [],
  componentTypes: [],
  owners: [],
  changed: null,
  values: [],
  conditions: [],
  related: [],
};

const KINDS: Record<string, string> = {
  get component() {
    return words('search.component');
  },
  get document() {
    return words('search.document');
  },
  get section() {
    return words('search.section');
  },
  get publication() {
    return words('search.publication');
  },
  get template() {
    return words('search.template');
  },
  get asset() {
    return words('search.image');
  },
  get field() {
    return words('search.field');
  },
  get metadataSchema() {
    return words('search.metadata-schema');
  },
  get componentType() {
    return words('search.component-type');
  },
  get queryDefinition() {
    return words('search.query-definition');
  },
  get thread() {
    return words('search.thread');
  },
  get term() {
    return words('search.term');
  },
};

const RANGES: Record<string, string> = {
  get today() {
    return words('search.today');
  },
  get week() {
    return words('search.this-week');
  },
  get month() {
    return words('search.this-month');
  },
  get year() {
    return words('search.this-year');
  },
  get earlier() {
    return words('search.before-this-year');
  },
};

/** A field's value as a reader reads it: a boolean as yes or no, anything else as its label. */
const valueLabel = (dataType: string, facet: FacetValue) =>
  dataType === 'boolean'
    ? facet.value === 'true'
      ? words('search.yes')
      : words('search.no')
    : facet.label;

const toggled = (values: readonly string[], value: string) =>
  values.includes(value) ? values.filter((each) => each !== value) : [...values, value];

/** A dimension's choices as its query parameter, or nothing where none is chosen. */
const listed = (name: string, values: readonly string[]) =>
  values.length === 0 ? {} : { [name]: values.join(',') };

/** One dimension's facet: a checkbox a value, each saying what it would leave. */
function FacetGroup({
  legend,
  values,
  chosen,
  label,
  onToggle,
}: {
  legend: string;
  values: readonly FacetValue[];
  chosen: readonly string[];
  label: (facet: FacetValue) => string;
  onToggle: (value: string) => void;
}) {
  // A value chosen and no longer offered is still shown, so it can be taken off again.
  const shown = [
    ...values,
    ...chosen
      .filter((value) => !values.some((each) => each.value === value))
      .map((value) => ({ value, label: value, count: 0, capped: false })),
  ];
  if (shown.length === 0) return null;
  return (
    <fieldset className={styles['facet']}>
      <legend>{legend}</legend>
      {shown.map((facet) => (
        <label key={facet.value} className={styles['option']}>
          <input
            type="checkbox"
            checked={chosen.includes(facet.value)}
            onChange={() => onToggle(facet.value)}
          />
          {/* Its count exact, or at least the cap where there are more (SCH-073). */}
          {words('search.facet-value', {
            label: label(facet),
            count: facet.count,
            capped: facet.capped ? 'yes' : 'no',
          })}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Search (search.md, "The page"): the query, the outcome said in a sentence, and the results - each
 * with its kind, space, where in it the words were found and a passage from there, linked by identity
 * to that place (SCH-057) - beside the facets, each value saying how many it would leave.
 *
 * The query is the address's, so a search can be linked to and gone back to; the facets chosen are
 * the page's, and a new query keeps them.
 */
/**
 * A section's document and what it places (SCH-053; the R14 plan, R14-C), so a section found is a route
 * to reusing its components: each a link, and **Place in a document** for them all.
 */
function SectionMembers({
  client,
  section,
  node,
}: {
  client: Client;
  section: NonNullable<Result['section']>;
  node: string;
}) {
  const label = useId();
  return (
    <div className={styles['members']}>
      <p className={styles['about']}>
        {wordsWith(
          'search.in-document',
          {},
          {
            document: (
              <a href={`#/documents/${section.document.id}`} data-content>
                {section.document.title}
              </a>
            ),
          },
        )}
      </p>
      {section.components.length > 0 && (
        <>
          <p id={label} className={styles['about']}>
            {words('search.it-places')}
          </p>
          <ul aria-labelledby={label} className={styles['placed']}>
            {section.components.map((each) => (
              <li key={each.id}>
                <a href={`#/components/${each.id}`} data-content>
                  {each.title}
                </a>
              </li>
            ))}
          </ul>
          <PlaceIntoButton
            client={client}
            from={section.document.id}
            section={node}
            onPlaced={(into) => {
              window.location.hash = `#/documents/${into}`;
            }}
          />
        </>
      )}
    </div>
  );
}

export function SearchPage({
  client,
  query,
  scope = LATEST,
  onSearch,
  onScope,
}: {
  readonly client: Client;
  /** The query the address holds. */
  readonly query: string;
  /** Which versions, or which baseline, the address holds (SV-I). */
  readonly scope?: SearchScope;
  /** Told a query to search for, which the address then holds. */
  readonly onSearch: (query: string) => void;
  /** Told the versions or baseline to search, which the address then holds. */
  readonly onScope?: (scope: SearchScope) => void;
}) {
  const [typed, setTyped] = useState(query);
  const [chosen, setChosen] = useState<Chosen>(NOTHING_CHOSEN);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [more, setMore] = useState<readonly Result[]>([]);
  const [problem, setProblem] = useState<'signedOut' | 'failed' | 'noBaseline' | null>(null);
  const [baselineName, setBaselineName] = useState<string | null>(null);
  // A page being fetched: asked for once, however often Show more is pressed meanwhile.
  const fetchingMore = useRef(false);
  const [showingMore, setShowingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const inputId = useId();
  const headingId = useId();

  useEffect(() => setTyped(query), [query]);

  // The baseline searched, named in its chip.
  const { baseline, versions } = scope;
  useEffect(() => {
    setBaselineName(null);
    if (baseline === null) return undefined;
    let current = true;
    client
      .GET('/v1/baselines/{id}', { params: { path: { id: baseline } } })
      .then(({ data }) => {
        if (current && data) setBaselineName(data.name);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, baseline]);

  const ask = useCallback(
    async (offset: number) => {
      const { data, response } = await client.GET('/v1/search', {
        params: {
          query: {
            q: query,
            ...(offset === 0 ? {} : { offset: String(offset) }),
            ...listed('kind', chosen.kinds),
            ...listed('space', chosen.spaces),
            ...listed('state', chosen.states),
            ...listed('type', chosen.componentTypes),
            ...listed('owner', chosen.owners),
            ...(chosen.changed === null ? {} : { changed: chosen.changed as 'today' }),
            ...(chosen.values.length === 0 ? {} : { value: [...chosen.values] }),
            ...(chosen.conditions.length === 0 ? {} : { condition: [...chosen.conditions] }),
            ...(chosen.related.length === 0 ? {} : { related: [...chosen.related] }),
            ...(baseline !== null
              ? { baseline }
              : versions === 'all'
                ? { versions: 'all' as const }
                : {}),
          },
        },
      });
      return { data: data as Answer | undefined, status: response.status };
    },
    [client, query, chosen, baseline, versions],
  );

  useEffect(() => {
    const generation = ++request.current;
    setProblem(null);
    setMore([]);
    if (query.trim() === '') {
      setAnswer(null);
      return undefined;
    }
    ask(0)
      .then(({ data, status }) => {
        if (request.current !== generation) return;
        if (!data) {
          setProblem(status === 401 ? 'signedOut' : status === 404 ? 'noBaseline' : 'failed');
          return;
        }
        setAnswer(data);
      })
      .catch(() => {
        if (request.current === generation) setProblem('failed');
      });
    return () => {
      request.current += 1;
    };
  }, [ask, query, attempt]);

  const showMore = async (offset: number) => {
    if (fetchingMore.current) return;
    fetchingMore.current = true;
    setShowingMore(true);
    const generation = request.current;
    try {
      const { data } = await ask(offset);
      if (request.current !== generation || data?.outcome !== 'results') return;
      setMore((shown) => [...shown, ...data.items]);
    } catch {
      if (request.current === generation) setProblem('failed');
    } finally {
      fetchingMore.current = false;
      setShowingMore(false);
    }
  };

  const results = answer?.outcome === 'results' ? answer : null;
  const items = results === null ? [] : [...results.items, ...more];
  const fields = new Map(results?.facets.fields.map((each) => [each.field, each.name]) ?? []);
  const choose = (dimension: Exclude<keyof Chosen, 'changed'>) => (value: string) =>
    setChosen((now) => ({ ...now, [dimension]: toggled(now[dimension], value) }));

  return (
    <section aria-labelledby={headingId}>
      <h1 id={headingId}>{words('search.search')}</h1>
      <form
        role="search"
        className={styles['form']}
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(typed);
        }}
      >
        <label htmlFor={inputId}>{words('search.search')}</label>
        <input
          id={inputId}
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="submit">{words('search.search')}</button>
      </form>
      <div className={styles['scope']}>
        {baseline === null ? (
          <label className={styles['option']}>
            {words('search.versions')}
            <select
              value={versions}
              onChange={(event) =>
                onScope?.({
                  versions: event.target.value === 'all' ? 'all' : 'latest',
                  baseline: null,
                })
              }
            >
              <option value="latest">{words('search.latest')}</option>
              <option value="all">{words('search.all')}</option>
            </select>
          </label>
        ) : (
          <>
            <Chip tone="accent">
              {baselineName === null
                ? words('search.in-a-baseline')
                : words('search.in-baseline-2', { baselineName })}
            </Chip>
            <button type="button" onClick={() => onScope?.(LATEST)}>
              {words('search.search-without-the-baseline')}
            </button>
          </>
        )}
      </div>
      {problem === 'signedOut' && (
        <Notice tone="signedOut">
          <p>{words('search.you-are-signed-out-sign')}</p>
        </Notice>
      )}
      {problem === 'noBaseline' && (
        <Notice tone="failed">
          <p>{words('search.there-is-no-baseline-you')}</p>
        </Notice>
      )}
      {problem === 'failed' && (
        <Notice tone="failed">
          <p>{words('search.the-search-could-not-be')}</p>
          <button type="button" onClick={() => setAttempt((now) => now + 1)}>
            {words('search.try-again')}
          </button>
        </Notice>
      )}
      {answer !== null && problem === null && <p role="status">{searchSaid(answer)}</p>}
      {answer?.outcome === 'results' && answer.meaning === 'unavailable' && problem === null && (
        <p className={styles['about']}>{words('search.searching-by-meaning-is-unavailable')}</p>
      )}
      {results !== null && problem === null && (
        <div className={styles['layout']}>
          <div className={styles['facets']}>
            <FacetGroup
              legend={words('search.kind')}
              values={results.facets.kinds}
              chosen={chosen.kinds}
              label={(facet) => KINDS[facet.value] ?? facet.label}
              onToggle={choose('kinds')}
            />
            <FacetGroup
              legend={words('search.space')}
              values={results.facets.spaces}
              chosen={chosen.spaces}
              label={(facet) => facet.label}
              onToggle={choose('spaces')}
            />
            <FacetGroup
              legend={words('search.state')}
              values={results.facets.states ?? []}
              chosen={chosen.states}
              label={(facet) => facet.label}
              onToggle={choose('states')}
            />
            <FacetGroup
              legend={words('search.component-type')}
              values={results.facets.componentTypes}
              chosen={chosen.componentTypes}
              label={(facet) => facet.label}
              onToggle={choose('componentTypes')}
            />
            <FacetGroup
              legend={words('search.made-by')}
              values={results.facets.owners}
              chosen={chosen.owners}
              label={(facet) => facet.label}
              onToggle={choose('owners')}
            />
            <FacetGroup
              legend={words('search.changed')}
              values={results.facets.changed.filter(
                (facet) => facet.count > 0 || chosen.changed === facet.value,
              )}
              chosen={chosen.changed === null ? [] : [chosen.changed]}
              label={(facet) => RANGES[facet.value] ?? facet.label}
              onToggle={(value) =>
                setChosen((now) => ({ ...now, changed: now.changed === value ? null : value }))
              }
            />
            {results.facets.fields.map((field) => (
              <FacetGroup
                key={field.field}
                legend={field.name}
                values={field.values.map((facet) => ({
                  ...facet,
                  value: `${field.field}:${facet.value}`,
                  label: valueLabel(field.dataType, facet),
                }))}
                chosen={chosen.values.filter((value) => value.startsWith(`${field.field}:`))}
                label={(facet) => facet.label}
                onToggle={choose('values')}
              />
            ))}
            {/* What results are conditioned on, an axis a heading (SCH-061; the R14 plan, R14-D). */}
            {(results.facets.conditions ?? []).map((axis) => (
              <FacetGroup
                key={`condition:${axis.axis}`}
                legend={words('search.conditioned-on', { axis: axis.axis })}
                values={axis.values}
                chosen={chosen.conditions.filter((value) => value.startsWith(`${axis.axis}:`))}
                label={(facet) => facet.value.slice(axis.axis.length + 1)}
                onToggle={choose('conditions')}
              />
            ))}
            {/* A relationship type's field, under the type (SCH-063; R14-E). */}
            {(results.facets.relations ?? []).map((relation) => (
              <FacetGroup
                key={`relation:${relation.type}:${relation.field}`}
                legend={words('search.relation-field', {
                  type: relation.typeName,
                  field: relation.name,
                })}
                values={relation.values.map((facet) => ({
                  ...facet,
                  value: `${relation.type}:${relation.field}:${facet.value}`,
                  label: valueLabel(relation.dataType, facet),
                }))}
                chosen={chosen.related.filter((value) =>
                  value.startsWith(`${relation.type}:${relation.field}:`),
                )}
                label={(facet) => facet.label}
                onToggle={choose('related')}
              />
            ))}
          </div>
          <ol className={styles['results']}>
            {items.map((item) => {
              const link = resultLink(item);
              const where = whereFound(item.place, fields);
              const found = foundIn(item);
              return (
                <li key={`${item.artifactId}:${item.node ?? ''}:${item.thread?.id ?? ''}`}>
                  <article className={styles['result']}>
                    <p className={styles['about']}>
                      {words('search.result-kind', {
                        kind: item.kind,
                        inSpace: item.space === null ? 'no' : 'yes',
                        name: item.space?.name ?? '',
                      })}
                    </p>
                    <h2 data-content>
                      {link === null ? item.title : <a href={link}>{item.title}</a>}
                    </h2>
                    {item.state && <StateLozenge state={item.state} />}
                    {(item.lines?.length ?? 0) > 0 && (
                      <Chip>
                        {words('search.diverged', {
                          lines: formats().list(item.lines!, { type: 'unit', style: 'short' }),
                        })}
                      </Chip>
                    )}
                    {/* Found by meaning answers another question than by words (SCH-014). */}
                    {item.found === 'meaning' && <Chip>{words('search.found-by-meaning')}</Chip>}
                    {item.found === 'both' && (
                      <Chip>{words('search.found-by-words-and-meaning')}</Chip>
                    )}
                    {found !== null && <p className={styles['about']}>{found}</p>}
                    {where !== null && <p className={styles['about']}>{where}</p>}
                    {item.passage.length > 0 && (
                      <p className={styles['passage']} data-content>
                        {item.passage.map((piece, index) =>
                          piece.matched ? <mark key={index}>{piece.text}</mark> : piece.text,
                        )}
                      </p>
                    )}
                    {item.section && item.node !== null && (
                      <SectionMembers client={client} section={item.section} node={item.node} />
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {results !== null && problem === null && items.length < results.count && (
        <button type="button" disabled={showingMore} onClick={() => void showMore(items.length)}>
          {words('search.show-more-results')}
        </button>
      )}
    </section>
  );
}
