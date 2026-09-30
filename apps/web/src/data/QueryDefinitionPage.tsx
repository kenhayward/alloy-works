import type { createApiClient } from '@alloy-works/api-client';
import { defaultLimits, type QueryDefinition, type ValueType } from '@alloy-works/domain';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Notice } from '../states/Notice.js';
import {
  BASES,
  NEW_PARAMETER,
  definitionOf,
  draftOf,
  everyColumnConfirmed,
  newDraft,
  parametersOf,
  proposedColumns,
  unconfirmed,
  sampleDefinition,
  sampleValues,
  type ColumnDraft,
  type DefinitionDraft,
  type ParameterDraft,
  type TypeDraft,
} from './definitionDraft.js';
import { connectionLink, queryDefinitionLink } from './links.js';
import { useSqlPlaces, type Place } from './places.js';
import styles from './QueryDefinitionPage.module.css';
import { isRecord, refusalText } from './shapes.js';

type Client = ReturnType<typeof createApiClient>;

/** A definition as the service answers it, checked before it is read. */
/** What a connection the person may not read is called, where its name is withheld. */
const UNREADABLE_CONNECTION = 'A connection you may not read';

interface DefinitionView {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly id: string; readonly number: string };
  readonly definition: QueryDefinition;
  readonly connection: {
    readonly id: string;
    /** Null where the person may not read the connection. */
    readonly name: string | null;
    readonly retired: boolean;
  } | null;
  readonly mayEdit: boolean;
  readonly mayRun: boolean;
}

function isDefinitionView(value: unknown): value is DefinitionView {
  if (!isRecord(value)) return false;
  const { space, version, definition, connection } = value;
  if (!isRecord(definition)) return false;
  // Read by destructuring: the renderer's API test flags any member named for the network.
  const { fetch: statement } = definition;
  return (
    typeof value.id === 'string' &&
    isRecord(space) &&
    typeof space.name === 'string' &&
    isRecord(version) &&
    typeof version.id === 'string' &&
    typeof version.number === 'string' &&
    isRecord(definition) &&
    typeof definition.title === 'string' &&
    typeof definition.connection === 'string' &&
    isRecord(statement) &&
    typeof statement.text === 'string' &&
    Array.isArray(definition.parameters) &&
    Array.isArray(definition.columns) &&
    (connection === null ||
      (isRecord(connection) &&
        (connection.name === null || typeof connection.name === 'string'))) &&
    typeof value.mayEdit === 'boolean' &&
    typeof value.mayRun === 'boolean'
  );
}

interface Failure {
  readonly code: string;
  readonly message: string;
}

/** A sample's answer: the first rows and what they were, or the one reason it failed (DAT-014). */
type Sampled =
  | {
      readonly outcome: 'ok';
      readonly columns: readonly (readonly [string, string])[];
      readonly rows: readonly (readonly (string | boolean | null)[])[];
      readonly rowCount: number;
      readonly checksum: string;
      readonly ran: { readonly sql: string };
    }
  | { readonly outcome: 'failed'; readonly failure: Failure };

function isSampled(value: unknown): value is Sampled {
  if (!isRecord(value)) return false;
  if (value.outcome === 'failed') {
    return isRecord(value.failure) && typeof value.failure.message === 'string';
  }
  return (
    value.outcome === 'ok' &&
    Array.isArray(value.columns) &&
    Array.isArray(value.rows) &&
    typeof value.rowCount === 'number' &&
    typeof value.checksum === 'string' &&
    isRecord(value.ran) &&
    typeof value.ran.sql === 'string'
  );
}

/** What a value refused by its declaration broke, in words (D2-R). */
const PARAMETER_RULES: Readonly<Record<string, string>> = {
  type: 'is not of its type',
  permitted: 'is not one of its permitted values',
  range: 'is outside its range',
  list: 'is not a list as its parameter declares',
  precision: 'has more digits than its type holds',
  scale: 'has more places than its type holds',
  zone: 'needs its time zone',
  variation: 'is not one of its keys',
};

/**
 * A refusal in words: the service's message, and each problem it named - a definition's rule broken,
 * or a value refused by its declaration, with the parameter and the value (DAT-020).
 */
function refusalLines(error: unknown, fallback: string): string[] {
  const lines = [refusalText(error, fallback)];
  if (isRecord(error) && Array.isArray(error.problems)) {
    for (const problem of error.problems as unknown[]) {
      if (!isRecord(problem)) continue;
      if (typeof problem.parameter === 'string' && typeof problem.rule === 'string') {
        lines.push(
          problem.rule === 'required'
            ? `${problem.parameter} needs a value.`
            : `${problem.parameter}: ${String(problem.value)} ${PARAMETER_RULES[problem.rule] ?? 'is refused'}.`,
        );
      } else if (typeof problem.path === 'string' && typeof problem.message === 'string') {
        lines.push(`${problem.path}: ${problem.message}.`);
      }
    }
  }
  return lines;
}

/** One of the page's steps, a region named by its heading. */
function Step({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={styles['step']}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * A select or a text area and its label, joined by `for`: a label wrapping one would hold every
 * option's text, or the text first typed, beside its own words, and be read so.
 */
function Choice({
  label,
  children,
}: {
  readonly label: string;
  readonly children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <span className={styles['choice']}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </span>
  );
}

/** Lines of words, each a paragraph, in a status region, or an empty one. */
function Status({ lines }: { readonly lines: readonly string[] | null }) {
  return (
    <div role="status">
      {lines?.map((line, at) => (
        <p key={at}>{line}</p>
      ))}
    </div>
  );
}

/** A type chosen from the eight bases, with the digits, places or fraction the base needs. */
function TypeFields({
  type,
  onChange,
  name,
  disabled,
}: {
  readonly type: TypeDraft;
  readonly onChange: (type: TypeDraft) => void;
  /** What each field's label names, as "Type of depth"; the parameter's own fields say "Type". */
  readonly name?: string;
  readonly disabled?: boolean;
}) {
  const of = (label: string) => (name === undefined ? label : `${label} of ${name}`);
  return (
    <span className={styles['type']}>
      <Choice label={of('Type')}>
        {(id) => (
          <select
            id={id}
            value={type.base}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...type, base: event.target.value as TypeDraft['base'] })
            }
          >
            {type.base === '' && <option value="">Choose a type</option>}
            {BASES.map((each) => (
              <option key={each.base} value={each.base}>
                {each.label}
              </option>
            ))}
          </select>
        )}
      </Choice>
      {type.base === 'decimal' && (
        <>
          <label>
            {of('Digits')}
            <input
              inputMode="numeric"
              value={type.precision}
              disabled={disabled}
              onChange={(event) => onChange({ ...type, precision: event.target.value })}
            />
          </label>
          <label>
            {of('Places')}
            <input
              inputMode="numeric"
              value={type.scale}
              disabled={disabled}
              onChange={(event) => onChange({ ...type, scale: event.target.value })}
            />
          </label>
        </>
      )}
      {(type.base === 'time' || type.base === 'localDateTime' || type.base === 'instant') && (
        <label>
          {of('Places of a second')}
          <input
            inputMode="numeric"
            value={type.fraction}
            disabled={disabled}
            onChange={(event) => onChange({ ...type, fraction: event.target.value })}
          />
        </label>
      )}
    </span>
  );
}

/** One parameter's declaration (DAT-010): its name, type, whether required or a list, and what it permits. */
function ParameterFields({
  index,
  parameter,
  onChange,
  onRemove,
}: {
  readonly index: number;
  readonly parameter: ParameterDraft;
  readonly onChange: (parameter: ParameterDraft) => void;
  readonly onRemove: () => void;
}) {
  const variation = parameter.variation.length > 0;
  return (
    <fieldset className={styles['parameter']}>
      <legend>{`Parameter ${index + 1}`}</legend>
      <label>
        Name
        <input
          value={parameter.name}
          spellCheck={false}
          onChange={(event) => onChange({ ...parameter, name: event.target.value })}
        />
      </label>
      <TypeFields type={parameter.type} onChange={(type) => onChange({ ...parameter, type })} />
      <label className={styles['check']}>
        <input
          type="checkbox"
          checked={parameter.required}
          onChange={(event) => onChange({ ...parameter, required: event.target.checked })}
        />
        Required
      </label>
      <label className={styles['check']}>
        <input
          type="checkbox"
          checked={parameter.list}
          onChange={(event) => onChange({ ...parameter, list: event.target.checked })}
        />
        A list of values
      </label>
      <label className={styles['check']}>
        <input
          type="checkbox"
          checked={variation}
          onChange={(event) =>
            onChange({
              ...parameter,
              variation: event.target.checked ? [{ key: '', sql: '' }] : [],
              permitted: 'none',
            })
          }
        />
        Chooses a fragment of SQL, placed at a marker with a hash
      </label>
      {!variation && (
        <Choice label="Permits">
          {(id) => (
            <select
              id={id}
              value={parameter.permitted}
              onChange={(event) =>
                onChange({
                  ...parameter,
                  permitted: event.target.value as ParameterDraft['permitted'],
                })
              }
            >
              <option value="none">Any value of its type</option>
              <option value="values">Only the values listed</option>
              <option value="range">Only values in a range</option>
            </select>
          )}
        </Choice>
      )}
      {!variation && parameter.permitted === 'values' && (
        <Choice label="Permitted values, one to a line">
          {(id) => (
            <textarea
              id={id}
              rows={3}
              value={parameter.values}
              onChange={(event) => onChange({ ...parameter, values: event.target.value })}
            />
          )}
        </Choice>
      )}
      {!variation && parameter.permitted === 'range' && (
        <>
          <label>
            Lowest
            <input
              value={parameter.minimum}
              onChange={(event) => onChange({ ...parameter, minimum: event.target.value })}
            />
          </label>
          <label>
            Highest
            <input
              value={parameter.maximum}
              onChange={(event) => onChange({ ...parameter, maximum: event.target.value })}
            />
          </label>
        </>
      )}
      {variation &&
        parameter.variation.map((each, at) => (
          <div key={at} className={styles['fragment']}>
            <label>
              {`Key ${at + 1}`}
              <input
                value={each.key}
                spellCheck={false}
                onChange={(event) =>
                  onChange({
                    ...parameter,
                    variation: parameter.variation.map((held, place) =>
                      place === at ? { ...held, key: event.target.value } : held,
                    ),
                  })
                }
              />
            </label>
            <label>
              {`Fragment ${at + 1}`}
              <input
                className={styles['code']}
                value={each.sql}
                spellCheck={false}
                onChange={(event) =>
                  onChange({
                    ...parameter,
                    variation: parameter.variation.map((held, place) =>
                      place === at ? { ...held, sql: event.target.value } : held,
                    ),
                  })
                }
              />
            </label>
          </div>
        ))}
      {variation && (
        <button
          type="button"
          onClick={() =>
            onChange({ ...parameter, variation: [...parameter.variation, { key: '', sql: '' }] })
          }
        >
          Add a fragment
        </button>
      )}
      <button type="button" onClick={onRemove}>
        {`Remove parameter ${index + 1}`}
      </button>
    </fieldset>
  );
}

/** A value typed for a sample, by the parameter's declaration: a choice where there is one. */
function ValueField({
  parameter,
  value,
  onChange,
}: {
  readonly parameter: ParameterDraft;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const choices =
    parameter.variation.length > 0
      ? parameter.variation.map((each) => each.key)
      : parameter.type.base === 'boolean' && !parameter.list
        ? ['true', 'false']
        : null;
  if (choices !== null) {
    return (
      <Choice label={parameter.name}>
        {(id) => (
          <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">No value</option>
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        )}
      </Choice>
    );
  }
  return parameter.list ? (
    <Choice label={parameter.name}>
      {(id) => (
        <textarea
          id={id}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Choice>
  ) : (
    <label>
      {parameter.name}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** The SQL of a definition the person may only read, and its declarations, in words. */
function ReadOnly({ definition }: { readonly definition: QueryDefinition }) {
  const { fetch: statement } = definition;
  const typeName = (type: ValueType) =>
    BASES.find((each) => each.base === type.base)?.label ?? type.base;
  return (
    <>
      <p>{definition.description === '' ? 'No description.' : definition.description}</p>
      <pre className={styles['sql']}>{statement.text}</pre>
      <table className={styles['table']}>
        <caption>Columns</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
          </tr>
        </thead>
        <tbody>
          {definition.columns.map((column) => (
            <tr key={column.name}>
              <td>{column.name}</td>
              <td>{typeName(column.type)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * A query definition (data.md, "What a query definition version holds"; the D2 plan, D2-U), at
 * `#/query-definitions/<id>` or `#/query-definitions/new`, written in five steps: the connection; the
 * SQL and its parameters; **Describe**, which proposes each column from the source's metadata for the
 * author to confirm (DAT-105); **Run sample**, which runs it exactly as a document would and shows the
 * first rows or the one reason it failed (DAT-014); and its key, order, empty and limits. **Save
 * version** is offered once every column is confirmed; **Retire** and **Reinstate** are versions too.
 */
export function QueryDefinitionPage({
  client,
  id,
}: {
  readonly client: Client;
  readonly id: string;
}) {
  const isNew = id === 'new';
  const places = useSqlPlaces(client);
  const [view, setView] = useState<DefinitionView | 'missing' | 'failed' | null>(null);
  const [draft, setDraft] = useState<DefinitionDraft>(() => newDraft(defaultLimits));
  const [space, setSpace] = useState('');
  const [described, setDescribed] = useState<string[] | null>(null);
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [sampled, setSampled] = useState<Sampled | string[] | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const working = useRef(false);
  // The draft as it is now, for an answer that arrives after it was asked for.
  const latest = useRef(draft);
  latest.current = draft;

  const show = useCallback((shown: DefinitionView) => {
    setView(shown);
    setDraft(draftOf(shown.definition));
  }, []);

  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const { data, response } = await client.GET('/v1/query-definitions/{id}', {
        params: { path: { id } },
      });
      if (isDefinitionView(data)) show(data);
      else setView(response.status === 404 ? 'missing' : 'failed');
    } catch {
      setView('failed');
    }
  }, [client, id, isNew, show]);

  useEffect(() => {
    void load();
  }, [load]);

  // A new definition starts in the first space and on the first connection the person may use.
  useEffect(() => {
    if (!isNew || places === null) return;
    setSpace((held) => held || (places.spaces[0]?.id ?? ''));
    setDraft((held) =>
      held.connection === '' ? { ...held, connection: places.connections[0]?.id ?? '' } : held,
    );
  }, [isNew, places]);

  /** Runs one act at a time: a second click while one is in flight sends nothing. */
  const act = useCallback(async (name: string, work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(name);
    try {
      await work();
    } finally {
      working.current = false;
      setBusy(null);
    }
  }, []);

  if (!isNew && view === null) return null;
  if (view === 'missing' || view === 'failed') {
    return (
      <Notice tone="failed">
        <p>
          {view === 'missing'
            ? 'There is no such query definition, or it is not one you may read.'
            : 'The query definition could not be loaded.'}
        </p>
        {view === 'failed' && (
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        )}
      </Notice>
    );
  }

  const shown = view;
  const mayEdit = isNew || (shown !== null && shown.mayEdit);
  const mayRun = isNew || (shown !== null && shown.mayRun);
  const change = (over: Partial<DefinitionDraft>) => setDraft((held) => ({ ...held, ...over }));
  /** A change to the SQL or its parameters, which may change what it returns: asked again of each column. */
  const changeStatement = (over: Pick<Partial<DefinitionDraft>, 'sql' | 'parameters'>) =>
    setDraft((held) => ({ ...held, ...over, columns: unconfirmed(held.columns) }));
  const setParameter = (at: number, parameter: ParameterDraft) =>
    changeStatement({
      parameters: draft.parameters.map((held, place) => (place === at ? parameter : held)),
    });
  const setColumn = (at: number, column: ColumnDraft) =>
    change({ columns: draft.columns.map((held, place) => (place === at ? column : held)) });
  const connections: readonly Place[] = [
    ...(places?.connections ?? []),
    ...(shown !== null &&
    shown.connection !== null &&
    !(places?.connections ?? []).some((each) => each.id === shown.connection!.id)
      ? [{ id: shown.connection.id, name: shown.connection.name ?? UNREADABLE_CONNECTION }]
      : []),
  ];

  const describe = () =>
    act('describe', async () => {
      setDescribed(null);
      const parameters = parametersOf(draft);
      if (typeof parameters === 'string') {
        setDescribed([parameters]);
        return;
      }
      if (draft.connection === '') {
        setDescribed(['Choose a connection first.']);
        return;
      }
      const sent = { sql: draft.sql, parameters: JSON.stringify(draft.parameters) };
      try {
        const { data, error } = await client.POST('/v1/connections/{id}/describe', {
          params: { path: { id: draft.connection } },
          body: { sql: { text: draft.sql, parameters: parameters as never } },
        });
        const answer: unknown = data;
        if (isRecord(answer) && Array.isArray(answer.columns)) {
          // An answer for a statement changed since it was sent describes another one: dropped.
          const now = latest.current;
          if (now.sql !== sent.sql || JSON.stringify(now.parameters) !== sent.parameters) {
            setDescribed(['The SQL changed while it was described. Describe it again.']);
            return;
          }
          // Merged into the columns as they are now, keeping a confirmation made meanwhile.
          const proposed = proposedColumns(answer.columns as never, now.columns);
          setDraft((held) => ({
            ...held,
            columns: proposedColumns(answer.columns as never, held.columns),
            key: held.key.filter((name) => proposed.some((each) => each.name === name)),
            order:
              held.order === 'multiset'
                ? 'multiset'
                : held.order.filter((each) =>
                    proposed.some((column) => column.name === each.column),
                  ),
          }));
          setDescribed([
            `${proposed.length} ${proposed.length === 1 ? 'column' : 'columns'} proposed. Confirm the type of each.`,
          ]);
          return;
        }
        setDescribed(refusalLines(error, 'The statement could not be described. Try again.'));
      } catch {
        setDescribed(['The statement could not be described. Try again.']);
      }
    });

  const sample = () =>
    act('sample', async () => {
      setSampled(null);
      const definition = sampleDefinition(draft);
      if (typeof definition === 'string') {
        setSampled([definition]);
        return;
      }
      try {
        const { data, error, response } = await client.POST('/v1/connections/{id}/sample', {
          params: { path: { id: draft.connection } },
          body: {
            definition: definition as never,
            values: sampleValues(draft.parameters, typed),
          },
        });
        if (isSampled(data)) {
          setSampled(data);
          return;
        }
        setSampled(
          response.status === 401
            ? ['You are signed out. Sign in again to run a sample.']
            : refusalLines(error, 'The sample could not be run. Try again.'),
        );
      } catch {
        setSampled(['The sample could not be run. Try again.']);
      }
    });

  /** Saves the definition as the next version, or as the first where it is new. */
  const send = async (
    definition: QueryDefinition,
    done: (view: DefinitionView) => string,
    keepDraft = false,
  ) => {
    try {
      const { data, error, response } =
        shown === null
          ? await client.POST('/v1/spaces/{space}/query-definitions', {
              params: { path: { space } },
              body: { definition: definition as never },
            })
          : await client.POST('/v1/query-definitions/{id}/versions', {
              params: { path: { id: shown.id } },
              body: { openedFrom: shown.version.id, definition: definition as never },
            });
      if (isDefinitionView(data)) {
        if (shown === null) {
          window.location.hash = queryDefinitionLink(data.id);
          return;
        }
        if (keepDraft) {
          // Retiring and reinstating save the version shown with `retired` changed and nothing
          // else, so what is typed and not yet saved stays typed.
          setView(data);
          setDraft((held) => ({ ...held, retired: data.definition.retired }));
        } else show(data);
        setSaved([data.version.id === shown.version.id ? 'Nothing had changed.' : done(data)]);
        return;
      }
      const refusal: unknown = error;
      if (response.status === 409 && isRecord(refusal) && isDefinitionView(refusal.current)) {
        show(refusal.current);
        setSaved([
          'Somebody saved a newer version of this query definition. It is shown now; make your change again.',
        ]);
        return;
      }
      setSaved(
        response.status === 401
          ? ['You are signed out. Sign in again to save this query definition.']
          : refusalLines(error, 'The query definition could not be saved. Try again.'),
      );
    } catch {
      setSaved(['The query definition could not be saved. Try again.']);
    }
  };

  const save = () =>
    act('save', async () => {
      setSaved(null);
      if (draft.title.trim() === '') {
        setSaved(['Give the query definition a title first.']);
        return;
      }
      const definition = definitionOf(draft);
      if (typeof definition === 'string') {
        setSaved([definition]);
        return;
      }
      await send(definition, (made) => `Saved as version ${made.version.number}.`);
    });

  const retire = (to: boolean) =>
    act('retire', async () => {
      if (shown === null) return;
      setSaved(null);
      await send(
        { ...shown.definition, retired: to },
        () => (to ? 'Retired. It runs nothing now.' : 'Reinstated.'),
        true,
      );
    });

  const retired = shown?.definition.retired === true;
  const columnNames = draft.columns.map((column) => column.name);

  return (
    <article className={styles['page']}>
      <p>
        <a href="#/query-definitions">Back to query definitions</a>
      </p>
      <h1>{isNew ? 'New query definition' : shown!.definition.title}</h1>
      {shown !== null && (
        <p className={styles['meta']}>
          <span>In {shown.space.name}</span>
          <span>Version {shown.version.number}</span>
          {retired && <span className={styles['retired']}>Retired</span>}
        </p>
      )}

      {!mayEdit && shown !== null ? (
        <>
          <p>
            Runs against{' '}
            {shown.connection === null ? (
              'a connection that is no longer there'
            ) : shown.connection.name === null ? (
              'a connection you may not read'
            ) : (
              <a href={connectionLink(shown.connection.id)}>{shown.connection.name}</a>
            )}
            .
          </p>
          <ReadOnly definition={shown.definition} />
        </>
      ) : (
        <>
          <Step title="Connection and title">
            <div className={styles['form']}>
              {isNew && (
                <Choice label="Space">
                  {(id) => (
                    <select
                      id={id}
                      value={space}
                      onChange={(event) => setSpace(event.target.value)}
                    >
                      {(places?.spaces ?? []).map((each) => (
                        <option key={each.id} value={each.id}>
                          {each.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Choice>
              )}
              <Choice label="Connection">
                {(id) => (
                  <select
                    id={id}
                    value={draft.connection}
                    onChange={(event) => change({ connection: event.target.value })}
                  >
                    {draft.connection === '' && <option value="">Choose a connection</option>}
                    {connections.map((each) => (
                      <option key={each.id} value={each.id}>
                        {each.name}
                      </option>
                    ))}
                  </select>
                )}
              </Choice>
              <p className={styles['hint']}>
                Only connections you may write SQL against are offered, and SQL runs only on one
                whose latest test found its account read-only.
              </p>
              <label>
                Title
                <input
                  value={draft.title}
                  onChange={(event) => change({ title: event.target.value })}
                />
              </label>
              <Choice label="Description">
                {(id) => (
                  <textarea
                    id={id}
                    rows={2}
                    value={draft.description}
                    onChange={(event) => change({ description: event.target.value })}
                  />
                )}
              </Choice>
            </div>
          </Step>

          <Step title="SQL and parameters">
            <div className={styles['form']}>
              <Choice label="SQL">
                {(id) => (
                  <textarea
                    id={id}
                    className={styles['code']}
                    rows={8}
                    spellCheck={false}
                    value={draft.sql}
                    onChange={(event) => changeStatement({ sql: event.target.value })}
                  />
                )}
              </Choice>
              <p className={styles['hint']}>
                Write a value as {'{{name}}'} and a fragment as {'{{#name}}'}, each naming a
                parameter below. A value is always sent apart from the SQL, never placed in it.
              </p>
              {draft.parameters.map((parameter, at) => (
                <ParameterFields
                  key={at}
                  index={at}
                  parameter={parameter}
                  onChange={(changed) => setParameter(at, changed)}
                  onRemove={() =>
                    changeStatement({
                      parameters: draft.parameters.filter((_, place) => place !== at),
                    })
                  }
                />
              ))}
              <button
                type="button"
                onClick={() =>
                  changeStatement({ parameters: [...draft.parameters, NEW_PARAMETER] })
                }
              >
                Add parameter
              </button>
            </div>
          </Step>

          <Step title="Columns">
            {mayRun && (
              <button type="button" disabled={busy !== null} onClick={describe}>
                Describe
              </button>
            )}
            <p className={styles['hint']}>
              Describe asks the source what the statement returns, without running it, and proposes
              a type for each column. Nothing is saved until you have confirmed every one.
            </p>
            <Status lines={described} />
            {draft.columns.length > 0 && (
              <table className={styles['table']}>
                <caption>Columns</caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">At the source</th>
                    <th scope="col">Type</th>
                    <th scope="col">Confirmed</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.columns.map((column, at) => (
                    <tr key={column.name}>
                      <td>{column.name}</td>
                      <td>{column.sourceType ?? 'Not described'}</td>
                      <td>
                        <TypeFields
                          name={column.name}
                          type={column.type}
                          onChange={(type) => setColumn(at, { ...column, type, confirmed: false })}
                        />
                        {column.type.base === '' && (
                          <p className={styles['hint']}>Declare a type for this column</p>
                        )}
                      </td>
                      <td>
                        {column.confirmed ? (
                          'Confirmed'
                        ) : (
                          <button
                            type="button"
                            aria-label={`Confirm ${column.name}`}
                            disabled={column.type.base === ''}
                            onClick={() => setColumn(at, { ...column, confirmed: true })}
                          >
                            Confirm
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Step>

          <Step title="Key, order, empty and limits">
            <div className={styles['form']}>
              <fieldset>
                <legend>Key</legend>
                {columnNames.length === 0 && <p>Describe the statement to choose its key.</p>}
                {columnNames.map((name) => (
                  <label key={name} className={styles['check']}>
                    <input
                      type="checkbox"
                      checked={draft.key.includes(name)}
                      onChange={(event) =>
                        change({
                          key: event.target.checked
                            ? [...draft.key, name]
                            : draft.key.filter((each) => each !== name),
                        })
                      }
                    />
                    {name}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Order</legend>
                <label className={styles['check']}>
                  <input
                    type="radio"
                    name="order"
                    checked={draft.order === 'multiset'}
                    onChange={() => change({ order: 'multiset' })}
                  />
                  Check the rows as a set, in any order
                </label>
                <label className={styles['check']}>
                  <input
                    type="radio"
                    name="order"
                    checked={draft.order !== 'multiset'}
                    onChange={() =>
                      change({
                        order: draft.key.map((column) => ({ column, direction: 'ascending' })),
                      })
                    }
                  />
                  Check the rows are in the order the SQL sorts them
                </label>
                {draft.order !== 'multiset' && (
                  <>
                    {draft.order.map((each, at) => (
                      <div key={at} className={styles['fragment']}>
                        <Choice label={`Order column ${at + 1}`}>
                          {(id) => (
                            <select
                              id={id}
                              value={each.column}
                              onChange={(event) =>
                                change({
                                  order: (draft.order as (typeof each)[]).map((held, place) =>
                                    place === at ? { ...held, column: event.target.value } : held,
                                  ),
                                })
                              }
                            >
                              {columnNames.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          )}
                        </Choice>
                        <Choice label={`Direction ${at + 1}`}>
                          {(id) => (
                            <select
                              id={id}
                              value={each.direction}
                              onChange={(event) =>
                                change({
                                  order: (draft.order as (typeof each)[]).map((held, place) =>
                                    place === at
                                      ? {
                                          ...held,
                                          direction: event.target.value as typeof each.direction,
                                        }
                                      : held,
                                  ),
                                })
                              }
                            >
                              <option value="ascending">Ascending</option>
                              <option value="descending">Descending</option>
                            </select>
                          )}
                        </Choice>
                      </div>
                    ))}
                    {columnNames.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          change({
                            order: [
                              ...(draft.order as readonly {
                                column: string;
                                direction: 'ascending' | 'descending';
                              }[]),
                              { column: columnNames[0]!, direction: 'ascending' },
                            ],
                          })
                        }
                      >
                        Add a column to the order
                      </button>
                    )}
                    <p className={styles['hint']}>
                      The order covers the whole key. Text is compared by code point, so order a
                      text column with COLLATE &quot;C&quot; in the SQL.
                    </p>
                  </>
                )}
              </fieldset>
              <label className={styles['check']}>
                <input
                  type="checkbox"
                  checked={draft.empty === 'valid'}
                  onChange={(event) =>
                    change({ empty: event.target.checked ? 'valid' : 'invalid' })
                  }
                />
                No rows is a valid answer
              </label>
              <label>
                Most rows
                <input
                  inputMode="numeric"
                  value={draft.limits.rows}
                  onChange={(event) =>
                    change({ limits: { ...draft.limits, rows: event.target.value } })
                  }
                />
              </label>
              <label>
                Most bytes
                <input
                  inputMode="numeric"
                  value={draft.limits.bytes}
                  onChange={(event) =>
                    change({ limits: { ...draft.limits, bytes: event.target.value } })
                  }
                />
              </label>
              <label>
                Most seconds
                <input
                  inputMode="numeric"
                  value={draft.limits.seconds}
                  onChange={(event) =>
                    change({ limits: { ...draft.limits, seconds: event.target.value } })
                  }
                />
              </label>
              <p className={styles['hint']}>
                The environment may lower each limit; a run takes the lower of the two.
              </p>
            </div>
          </Step>
        </>
      )}

      {mayRun && (
        <Step title="Sample">
          <div className={styles['form']}>
            {draft.parameters.map((parameter, at) => (
              <ValueField
                key={at}
                parameter={parameter}
                value={typed[parameter.name] ?? ''}
                onChange={(value) => setTyped((held) => ({ ...held, [parameter.name]: value }))}
              />
            ))}
            <button type="button" disabled={busy !== null} onClick={sample}>
              Run sample
            </button>
          </div>
          <p className={styles['hint']}>
            A sample runs the definition exactly as a document would, and keeps nothing.
          </p>
          {sampled !== null && Array.isArray(sampled) && <Status lines={sampled} />}
          {sampled !== null && !Array.isArray(sampled) && sampled.outcome === 'failed' && (
            <Status lines={[sampled.failure.message]} />
          )}
          {sampled !== null && !Array.isArray(sampled) && sampled.outcome === 'ok' && (
            <div role="status">
              <p>{`${sampled.rowCount} ${sampled.rowCount === 1 ? 'row' : 'rows'}.`}</p>
              <p>{`Checksum ${sampled.checksum.slice(0, 12)}.`}</p>
              <table className={styles['table']}>
                <caption>The first rows</caption>
                <thead>
                  <tr>
                    {sampled.columns.map(([name]) => (
                      <th key={name} scope="col">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampled.rows.map((row, at) => (
                    <tr key={at}>
                      {row.map((value, place) => (
                        <td key={place}>{value === null ? 'Empty' : String(value)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>The SQL that ran</p>
              <pre className={styles['sql']}>{sampled.ran.sql}</pre>
            </div>
          )}
        </Step>
      )}

      {mayEdit && (
        <Step title="Save">
          {everyColumnConfirmed(draft) ? (
            <button type="button" className="primary" disabled={busy !== null} onClick={save}>
              Save version
            </button>
          ) : (
            <p>Confirm every column to save.</p>
          )}
          <Status lines={saved} />
          {shown !== null && (
            <>
              <p>
                {retired
                  ? 'A retired query definition runs nothing. Reinstating it lets it run again.'
                  : 'A retired query definition runs nothing, and keeps every version it had.'}
              </p>
              <button type="button" disabled={busy !== null} onClick={() => retire(!retired)}>
                {retired ? 'Reinstate' : 'Retire'}
              </button>
            </>
          )}
        </Step>
      )}
    </article>
  );
}
