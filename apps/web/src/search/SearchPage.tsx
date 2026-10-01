import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Notice } from '../states/Notice.js';
import { resultLink, whereFound } from './links.js';
import styles from './SearchPage.module.css';

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
}

interface Facets {
  readonly kinds: readonly FacetValue[];
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
}

type Answer =
  | { readonly outcome: 'empty' | 'nothing_to_match' | 'unknown_field'; readonly message: string }
  | {
      readonly outcome: 'results';
      readonly message: string;
      readonly count: number;
      readonly capped: boolean;
      readonly items: readonly Result[];
      readonly facets: Facets;
    };

/** What narrows the search: each dimension's chosen values, and a field's as `<field>:<value>`. */
interface Chosen {
  readonly kinds: readonly string[];
  readonly spaces: readonly string[];
  readonly componentTypes: readonly string[];
  readonly owners: readonly string[];
  readonly changed: string | null;
  readonly values: readonly string[];
}

const NOTHING_CHOSEN: Chosen = {
  kinds: [],
  spaces: [],
  componentTypes: [],
  owners: [],
  changed: null,
  values: [],
};

const KINDS: Record<string, string> = {
  component: 'Component',
  document: 'Document',
  section: 'Section',
  publication: 'Publication',
  template: 'Template',
  asset: 'Image',
  field: 'Field',
  metadataSchema: 'Metadata schema',
  componentType: 'Component type',
  queryDefinition: 'Query definition',
};

const RANGES: Record<string, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  year: 'This year',
  earlier: 'Before this year',
};

/** A count as a reader is told it: exact, or at least the cap where there are more (SCH-034). */
const countOf = (facet: { readonly count: number; readonly capped: boolean }) =>
  facet.capped
    ? `at least ${facet.count.toLocaleString('en-GB')}`
    : facet.count.toLocaleString('en-GB');

/** A field's value as a reader reads it: a boolean as yes or no, anything else as its label. */
const valueLabel = (dataType: string, facet: FacetValue) =>
  dataType === 'boolean' ? (facet.value === 'true' ? 'Yes' : 'No') : facet.label;

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
          {`${label(facet)} (${countOf(facet)})`}
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
export function SearchPage({
  client,
  query,
  onSearch,
}: {
  readonly client: Client;
  /** The query the address holds. */
  readonly query: string;
  /** Told a query to search for, which the address then holds. */
  readonly onSearch: (query: string) => void;
}) {
  const [typed, setTyped] = useState(query);
  const [chosen, setChosen] = useState<Chosen>(NOTHING_CHOSEN);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [more, setMore] = useState<readonly Result[]>([]);
  const [problem, setProblem] = useState<'signedOut' | 'failed' | null>(null);
  // A page being fetched: asked for once, however often Show more is pressed meanwhile.
  const fetchingMore = useRef(false);
  const [showingMore, setShowingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const inputId = useId();
  const headingId = useId();

  useEffect(() => setTyped(query), [query]);

  const ask = useCallback(
    async (offset: number) => {
      const { data, response } = await client.GET('/v1/search', {
        params: {
          query: {
            q: query,
            ...(offset === 0 ? {} : { offset: String(offset) }),
            ...listed('kind', chosen.kinds),
            ...listed('space', chosen.spaces),
            ...listed('type', chosen.componentTypes),
            ...listed('owner', chosen.owners),
            ...(chosen.changed === null ? {} : { changed: chosen.changed as 'today' }),
            ...(chosen.values.length === 0 ? {} : { value: [...chosen.values] }),
          },
        },
      });
      return { data: data as Answer | undefined, status: response.status };
    },
    [client, query, chosen],
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
          setProblem(status === 401 ? 'signedOut' : 'failed');
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
      <h1 id={headingId}>Search</h1>
      <form
        role="search"
        className={styles['form']}
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(typed);
        }}
      >
        <label htmlFor={inputId}>Search</label>
        <input
          id={inputId}
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="submit">Search</button>
      </form>
      {problem === 'signedOut' && (
        <Notice tone="signedOut">
          <p>You are signed out. Sign in again to search.</p>
        </Notice>
      )}
      {problem === 'failed' && (
        <Notice tone="failed">
          <p>The search could not be made.</p>
          <button type="button" onClick={() => setAttempt((now) => now + 1)}>
            Try again
          </button>
        </Notice>
      )}
      {answer !== null && problem === null && <p role="status">{answer.message}</p>}
      {results !== null && problem === null && (
        <div className={styles['layout']}>
          <div className={styles['facets']}>
            <FacetGroup
              legend="Kind"
              values={results.facets.kinds}
              chosen={chosen.kinds}
              label={(facet) => KINDS[facet.value] ?? facet.label}
              onToggle={choose('kinds')}
            />
            <FacetGroup
              legend="Space"
              values={results.facets.spaces}
              chosen={chosen.spaces}
              label={(facet) => facet.label}
              onToggle={choose('spaces')}
            />
            <FacetGroup
              legend="Component type"
              values={results.facets.componentTypes}
              chosen={chosen.componentTypes}
              label={(facet) => facet.label}
              onToggle={choose('componentTypes')}
            />
            <FacetGroup
              legend="Made by"
              values={results.facets.owners}
              chosen={chosen.owners}
              label={(facet) => facet.label}
              onToggle={choose('owners')}
            />
            <FacetGroup
              legend="Changed"
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
          </div>
          <ol className={styles['results']}>
            {items.map((item) => {
              const link = resultLink(item);
              const where = whereFound(item.place, fields);
              return (
                <li key={`${item.artifactId}:${item.node ?? ''}`}>
                  <article className={styles['result']}>
                    <p className={styles['about']}>
                      {KINDS[item.kind] ?? item.kind}
                      {item.space === null ? '' : ` in ${item.space.name}`}
                    </p>
                    <h2>{link === null ? item.title : <a href={link}>{item.title}</a>}</h2>
                    {where !== null && <p className={styles['about']}>{where}</p>}
                    {item.passage.length > 0 && (
                      <p className={styles['passage']}>
                        {item.passage.map((piece, index) =>
                          piece.matched ? <mark key={index}>{piece.text}</mark> : piece.text,
                        )}
                      </p>
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
          Show more results
        </button>
      )}
    </section>
  );
}
