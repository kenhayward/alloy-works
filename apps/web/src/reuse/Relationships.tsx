import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useId, useState } from 'react';
import { Modal } from '../layouts/Modal.js';
import { resultLink } from '../search/links.js';
import {
  emptyGraph,
  expandInto,
  foldsOf,
  layout,
  queryOf,
  searchOf,
  type Graph,
  type GraphArtifact,
  type GraphEdge,
  type GraphFilter,
} from './graph.js';
import styles from './Relationships.module.css';
import { formats, words as say, wordsWith } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A declared relationship type, as the dialog offers and words it. */
export interface OfferedType {
  readonly id: string;
  readonly name: string;
  readonly inverseName: string;
  readonly directed: boolean;
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly deprecated: boolean;
  /** The fields its schemas assign, which the graph may be filtered by (REL-051). */
  readonly fields: readonly { readonly id: string; readonly name: string }[];
}

/** Every declared relationship type, by name, or null where they could not be read. */
export async function declaredTypes(client: Client): Promise<OfferedType[] | null> {
  const listed: { id: string; name: string }[] = [];
  const fieldNames = new Map<string, string>();
  let cursor: string | null = null;
  do {
    const query: { cursor?: string } = cursor === null ? {} : { cursor };
    const { data } = await client
      .GET('/v1/definitions', { params: { query } })
      .catch(() => ({ data: undefined }));
    if (!data) return null;
    for (const each of data.items) {
      if (each.kind === 'relationshipType') listed.push({ id: each.id, name: each.name });
      if (each.kind === 'field') fieldNames.set(each.id, each.name);
    }
    cursor = data.next;
  } while (cursor !== null);
  const read = async (id: string) =>
    (
      await client
        .GET('/v1/definitions/{id}', { params: { path: { id } } })
        .catch(() => ({ data: undefined }))
    ).data?.definition as Record<string, unknown> | undefined;
  const types = await Promise.all(
    listed.map(async (each): Promise<OfferedType | null> => {
      const definition = await read(each.id);
      if (!definition) return null;
      const end = (key: 'from' | 'to') =>
        ((definition[key] as { kinds?: string[] } | undefined)?.kinds ?? []) as string[];
      // The fields each assigned schema lists, named as the listing names them.
      const schemas = (definition['schemas'] ?? []) as { schema: string }[];
      const fields: { id: string; name: string }[] = [];
      for (const assigned of schemas) {
        const schema = await read(assigned.schema);
        for (const entry of (schema?.['entries'] ?? []) as { field: string }[]) {
          if (!fields.some((field) => field.id === entry.field)) {
            fields.push({ id: entry.field, name: fieldNames.get(entry.field) ?? entry.field });
          }
        }
      }
      return {
        id: each.id,
        name: each.name,
        inverseName: String(definition['inverseName'] ?? each.name),
        directed: definition['directed'] !== false,
        from: end('from'),
        to: end('to'),
        deprecated: definition['deprecated'] !== undefined,
        fields,
      };
    }),
  );
  return types.filter((each): each is OfferedType => each !== null);
}

/** How a relationship reads from the artifact it was read from: its name, or its inverse's. */
export function saidFrom(edge: GraphEdge, types: readonly OfferedType[]): string {
  return namedFrom(edge, types) ?? say('reuse.related-to');
}

/** The relationship's type's name read from this end; null where its type is not declared. */
function namedFrom(edge: GraphEdge, types: readonly OfferedType[]): string | null {
  const type = types.find((each) => each.id === edge.relationship.type);
  if (!type) return null;
  const outward = edge.relationship.from.artifact === edge.from;
  return outward || !type.directed ? type.name : type.inverseName;
}

const linkOf = (artifact: GraphArtifact) =>
  resultLink({ kind: artifact.kind, artifactId: artifact.id, node: null, place: null });

/** The header's Relationships: an artifact's relationships, drawn and listed (REL-025 to REL-028). */
export function RelationshipsButton({
  client,
  id,
  kind,
  title,
  className,
}: {
  client: Client;
  id: string;
  kind: string;
  title: string;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {say('reuse.relationships')}
      </button>
      {open && (
        <RelationshipsDialog
          client={client}
          centre={{ id, kind, title }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

type Read = { graph: Graph; cut: boolean; more: boolean };

export function RelationshipsDialog({
  client,
  centre,
  onClose,
}: {
  client: Client;
  centre: GraphArtifact;
  onClose: () => void;
}) {
  const headingId = useId();
  const [types, setTypes] = useState<OfferedType[] | null | undefined>(undefined);
  const [filter, setFilter] = useState<GraphFilter>({});
  const [read, setRead] = useState<Read | null | undefined>(undefined);
  const [openFold, setOpenFold] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let current = true;
    void declaredTypes(client).then((found) => {
      if (current) setTypes(found);
    });
    return () => {
      current = false;
    };
  }, [client]);

  const neighboursOf = useCallback(
    async (id: string) => {
      const { data } = await client
        .GET('/v1/artifacts/{id}/relationships', {
          params: { path: { id }, query: queryParams(filter) },
        })
        .catch(() => ({ data: undefined }));
      return data ?? null;
    },
    [client, filter],
  );

  useEffect(() => {
    let current = true;
    setRead(undefined);
    void neighboursOf(centre.id).then((data) => {
      if (!current) return;
      setRead(
        data
          ? {
              graph: expandInto(emptyGraph(centre), centre.id, data.relationships),
              cut: data.cut,
              more: data.more,
            }
          : null,
      );
    });
    return () => {
      current = false;
    };
  }, [neighboursOf, centre, reloads]);

  const expand = async (id: string) => {
    if (!read) return;
    const data = await neighboursOf(id);
    if (!data) {
      setNotice(say('reuse.its-relationships-could-not-be'));
      return;
    }
    setRead((was) =>
      was
        ? {
            graph: expandInto(was.graph, id, data.relationships),
            cut: was.cut || data.cut,
            more: was.more || data.more,
          }
        : was,
    );
  };

  const remove = async (relationship: string) => {
    const { error } = await client
      .DELETE('/v1/relationships/{id}', { params: { path: { id: relationship } } })
      .catch(() => ({ error: { message: say('reuse.the-relationship-could-not-be') } }));
    if (error) {
      setNotice(
        (error as { message?: string }).message ?? say('reuse.the-relationship-could-not-be'),
      );
      return;
    }
    setNotice(say('reuse.the-relationship-is-removed'));
    setReloads((n) => n + 1);
  };

  const filtering = types?.find((each) => each.id === filter.type);
  return (
    <Modal labelledBy={headingId} size="wide" onClose={onClose}>
      <div className={styles['relDialog']}>
        <h2 id={headingId}>{say('reuse.relationships-of', { title: centre.title })}</h2>
        <form
          className={styles['relFilters']}
          aria-label={say('reuse.filter')}
          onSubmit={(event) => event.preventDefault()}
        >
          <label>
            {say('reuse.type')}
            <select
              value={filter.type ?? ''}
              onChange={(event) =>
                setFilter({
                  ...filter,
                  type: event.target.value || undefined,
                  field: undefined,
                  value: undefined,
                })
              }
            >
              <option value="">{say('reuse.every-type')}</option>
              {(types ?? []).map((each) => (
                <option key={each.id} value={each.id} data-content>
                  {each.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {say('reuse.direction')}
            <select
              value={filter.direction ?? ''}
              onChange={(event) =>
                setFilter({
                  ...filter,
                  direction: (event.target.value || undefined) as GraphFilter['direction'],
                })
              }
            >
              <option value="">{say('reuse.both-ways')}</option>
              <option value="out">{say('reuse.from', { title: centre.title })}</option>
              <option value="in">{say('reuse.to', { title: centre.title })}</option>
            </select>
          </label>
          {filtering && filtering.fields.length > 0 && (
            <ValueFilter
              fields={filtering.fields}
              filter={filter}
              onFilter={(field, value) => setFilter({ ...filter, field, value })}
            />
          )}
        </form>
        {/* Every view is a query an integrator can ask too (REL-028). */}
        <p className={styles['relQuery']}>
          {wordsWith('reuse.answered-by', {}, { query: <code data-content>{queryOf(centre.id, filter)}</code> })}
        </p>
        {notice && <p role="status">{notice}</p>}
        {(read === undefined || types === undefined) && (
          <p role="status">{say('reuse.reading-its-relationships')}</p>
        )}
        {(read === null || types === null) && (
          <p role="status">{say('reuse.its-relationships-could-not-be')}</p>
        )}
        {read && types && (
          <>
            <Drawing
              graph={read.graph}
              onExpand={(id) => void expand(id)}
              onFold={(key) => setOpenFold(openFold === key ? null : key)}
            />
            <Listing
              graph={read.graph}
              types={types}
              openFold={openFold}
              onFold={(key) => setOpenFold(openFold === key ? null : key)}
              onExpand={(id) => void expand(id)}
              onRemove={(id) => void remove(id)}
            />
            {read.cut && (
              <p className={styles['relMuted']}>
                {say('reuse.some-relationships-lead-to-artifacts')}
              </p>
            )}
            {read.more && (
              <p className={styles['relMuted']}>
                {say('reuse.only-the-first-1-000', { count: 1000 })}
              </p>
            )}
            <Relate
              client={client}
              centre={centre}
              types={types}
              onRelated={() => {
                setNotice(say('reuse.the-relationship-is-made'));
                setReloads((n) => n + 1);
              }}
            />
          </>
        )}
        <div className={styles['relButtons']}>
          <button type="button" onClick={onClose}>
            {say('reuse.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The filter as the client asks it: only what is set. */
function queryParams(filter: GraphFilter) {
  return Object.fromEntries(new URLSearchParams(searchOf(filter)));
}

function ValueFilter({
  fields,
  filter,
  onFilter,
}: {
  fields: OfferedType['fields'];
  filter: GraphFilter;
  onFilter: (field: string | undefined, value: string | undefined) => void;
}) {
  const [value, setValue] = useState(filter.value ?? '');
  const field = filter.field ?? fields[0]!.id;
  return (
    <>
      <label>
        {say('reuse.field')}
        <select value={field} onChange={(event) => onFilter(event.target.value, filter.value)}>
          {fields.map((each) => (
            <option key={each.id} value={each.id} data-content>
              {each.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {say('reuse.value')}
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => onFilter(field, value || undefined)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onFilter(field, value || undefined);
          }}
        />
      </label>
    </>
  );
}

const SIZE = 480;

/** The graph drawn, centred on its artifact; a pointer expands one, the listing does the same by keyboard. */
function Drawing({
  graph,
  onExpand,
  onFold,
}: {
  graph: Graph;
  onExpand: (id: string) => void;
  onFold: (key: string) => void;
}) {
  const drawn = layout(graph, SIZE);
  return (
    <svg
      className={styles['relGraph']}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={say('reuse.a-graph-of-related-artifacts', {
        count: drawn.nodes.length - 1 + drawn.counts.reduce((n, each) => n + each.ids.length, 0),
      })}
    >
      {drawn.lines.map((line) => (
        <line key={line.key} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
      ))}
      {drawn.nodes.map((node) => (
        <g
          key={node.id}
          className={node.ring === 0 ? styles['relCentre'] : styles['relNode']}
          transform={`translate(${node.x} ${node.y})`}
          onClick={() => node.ring > 0 && !graph.expanded.has(node.id) && onExpand(node.id)}
        >
          <circle r={node.ring === 0 ? 10 : 7} />
          <text y={22} data-content>
            {node.title.length > 24 ? `${node.title.slice(0, 23)}...` : node.title}
          </text>
        </g>
      ))}
      {drawn.counts.map((count) => (
        <g
          key={count.key}
          className={styles['relCount']}
          transform={`translate(${count.x} ${count.y})`}
          onClick={() => onFold(count.key)}
        >
          <circle r={16} />
          <text y={4}>{formats().number(count.ids.length)}</text>
          <text y={30}>{say('reuse.kinds', { kind: count.kind, count: count.ids.length })}</text>
        </g>
      ))}
    </svg>
  );
}

/** The same relationships listed, by the artifact each was read from: what a keyboard and a screen reader use. */
function Listing({
  graph,
  types,
  openFold,
  onFold,
  onExpand,
  onRemove,
}: {
  graph: Graph;
  types: readonly OfferedType[];
  openFold: string | null;
  onFold: (key: string) => void;
  onExpand: (id: string) => void;
  onRemove: (relationship: string) => void;
}) {
  const folds = foldsOf(graph);
  const foldOf = (from: string, to: string) =>
    folds.find((fold) => fold.parent === from && fold.ids.includes(to));
  const sources = [...graph.expanded];
  if (graph.edges.length === 0) return <p>{say('reuse.it-has-no-relationships-you')}</p>;
  return (
    <div className={styles['relListing']}>
      {sources.map((source) => {
        const from = graph.nodes.get(source)!;
        const edges = graph.edges.filter((edge) => edge.from === source);
        const shown = edges.filter((edge) => !foldOf(source, edge.to));
        const folded = folds.filter((fold) => fold.parent === source);
        return (
          <section key={source} aria-label={say('reuse.relationships-of', { title: from.title })}>
            {source !== graph.centre && <h3 data-content>{from.title}</h3>}
            <ul className={styles['relList']}>
              {shown.map((edge) => (
                <EdgeItem
                  key={edge.relationship.id}
                  edge={edge}
                  graph={graph}
                  types={types}
                  onExpand={onExpand}
                  onRemove={onRemove}
                />
              ))}
              {folded.map((fold) => (
                <li key={fold.key}>
                  <button
                    type="button"
                    aria-expanded={openFold === fold.key}
                    onClick={() => onFold(fold.key)}
                  >
                    {say('reuse.kinds-counted', { kind: fold.kind, count: fold.ids.length })}
                  </button>
                  {openFold === fold.key && (
                    <ul className={styles['relList']}>
                      {edges
                        .filter((edge) => fold.ids.includes(edge.to))
                        .map((edge) => (
                          <EdgeItem
                            key={edge.relationship.id}
                            edge={edge}
                            graph={graph}
                            types={types}
                            onExpand={onExpand}
                            onRemove={onRemove}
                          />
                        ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function EdgeItem({
  edge,
  graph,
  types,
  onExpand,
  onRemove,
}: {
  edge: GraphEdge;
  graph: Graph;
  types: readonly OfferedType[];
  onExpand: (id: string) => void;
  onRemove: (relationship: string) => void;
}) {
  const other = graph.nodes.get(edge.to)!;
  const href = linkOf(other);
  const named = namedFrom(edge, types);
  return (
    <li>
      {named === null ? <span>{say('reuse.related-to')}</span> : <span data-content>{named}</span>}
      {href ? (
        <a href={href} data-content>
          {other.title}
        </a>
      ) : (
        <span data-content>{other.title}</span>
      )}
      {!graph.expanded.has(other.id) && (
        <button
          type="button"
          onClick={() => onExpand(other.id)}
          aria-label={say('reuse.expand', { title: other.title })}
        >
          {say('reuse.expand-2')}
        </button>
      )}
      <button
        type="button"
        onClick={() => onRemove(edge.relationship.id)}
        aria-label={
          named === null
            ? say('reuse.remove-related', { title: other.title })
            : // The type's name is the tenant's, read here as a verb in the middle of a sentence.
              say('reuse.remove', {
                relation: named.toLocaleLowerCase(formats().language.formats),
                title: other.title,
              })
        }
      >
        {say('reuse.remove-2')}
      </button>
    </li>
  );
}

const SEARCHABLE = new Set([
  'component',
  'document',
  'template',
  'asset',
  'queryDefinition',
  'publication',
]);

/** Relate this artifact to another by a declared type, either end where the type permits (REL-001). */
function Relate({
  client,
  centre,
  types,
  onRelated,
}: {
  client: Client;
  centre: GraphArtifact;
  types: readonly OfferedType[];
  onRelated: () => void;
}) {
  // Each type offered at each end this artifact's kind may take: a deprecated one is not (REL-037).
  const offers = types
    .filter((each) => !each.deprecated)
    .flatMap((each) => [
      ...(each.from.includes(centre.kind) ? [{ type: each, end: 'from' as const }] : []),
      // An undirected type reads the same either way: offered once.
      ...(each.to.includes(centre.kind) && (each.directed || !each.from.includes(centre.kind))
        ? [{ type: each, end: 'to' as const }]
        : []),
    ]);
  const [offer, setOffer] = useState(0);
  const [words, setWords] = useState('');
  const [found, setFound] = useState<GraphArtifact[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const formId = useId();
  if (offers.length === 0) {
    return (
      <p className={styles['relMuted']}>
        {say('reuse.no-relationship-type-relates-a', { kind: centre.kind })}
      </p>
    );
  }
  const asked = offers[offer]!;
  const others = (asked.end === 'from' ? asked.type.to : asked.type.from).filter((kind) =>
    SEARCHABLE.has(kind),
  );
  const look = async () => {
    setChosen(null);
    const { data } = await client
      .GET('/v1/search', { params: { query: { q: words, kind: others.join(',') } } })
      .catch(() => ({ data: undefined }));
    const results = data?.outcome === 'results' ? data.items : data ? [] : undefined;
    setFound(
      results
        ? results
            .filter((each) => each.artifactId !== centre.id)
            .map((each) => ({ id: each.artifactId, kind: each.kind, title: each.title }))
        : [],
    );
  };
  const relate = async () => {
    if (!chosen) return;
    const ends =
      asked.end === 'from'
        ? { from: { artifact: centre.id }, to: { artifact: chosen } }
        : { from: { artifact: chosen }, to: { artifact: centre.id } };
    const { error } = await client
      .POST('/v1/relationships', { body: { type: asked.type.id, ...ends } })
      .catch(() => ({ error: { message: say('reuse.the-relationship-could-not-be-2') } }));
    if (error) {
      setSaid(
        (error as { message?: string }).message ?? say('reuse.the-relationship-could-not-be-2'),
      );
      return;
    }
    setSaid(null);
    setFound(null);
    setChosen(null);
    setWords('');
    onRelated();
  };
  return (
    <section aria-labelledby={`${formId}heading`} className={styles['relRelate']}>
      <h3 id={`${formId}heading`}>{say('reuse.relate')}</h3>
      <label>
        {say('reuse.relationship')}
        <select value={offer} onChange={(event) => setOffer(Number(event.target.value))}>
          {offers.map((each, at) => (
            <option key={`${each.type.id}${each.end}`} value={at}>
              {say('reuse.relation-offer', {
                title: centre.title,
                relation: each.end === 'from' ? each.type.name : each.type.inverseName,
              })}
            </option>
          ))}
        </select>
      </label>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void look();
        }}
      >
        <label>
          {say('reuse.find')}
          <input value={words} onChange={(event) => setWords(event.target.value)} />
        </label>
        <button type="submit">{say('reuse.find')}</button>
      </form>
      {found && found.length === 0 && <p>{say('reuse.nothing-found-to-relate')}</p>}
      {found && found.length > 0 && (
        <fieldset>
          <legend>{say('reuse.relate-to')}</legend>
          {found.map((each) => (
            <label key={each.id}>
              <input
                type="radio"
                name={`${formId}chosen`}
                checked={chosen === each.id}
                onChange={() => setChosen(each.id)}
              />
              <span data-content>{each.title}</span>
            </label>
          ))}
        </fieldset>
      )}
      {said && <p role="alert">{said}</p>}
      <button type="button" className="primary" disabled={!chosen} onClick={() => void relate()}>
        {say('reuse.relate')}
      </button>
    </section>
  );
}
