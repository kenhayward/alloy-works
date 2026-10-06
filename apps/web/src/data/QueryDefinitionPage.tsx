import type { createApiClient } from '@alloy-works/api-client';
import { defaultLimits, type ColumnType, type QueryDefinition } from '@alloy-works/domain';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Notice } from '../states/Notice.js';
import { documentLink } from '../structure/links.js';
import { BuilderFields } from './BuilderFields.js';
import { Choice, Status } from './Choice.js';
import {
  BASES,
  COLUMN_BASES,
  ENCODINGS,
  NEW_PARAMETER,
  definitionOf,
  draftOf,
  everyColumnConfirmed,
  fitFilters,
  generatedSql,
  keyNamed,
  newDraft,
  parametersOf,
  proposedColumns,
  queryOf,
  statementOf,
  withStatement,
  sampleDefinition,
  sampleValues,
  sqlOf,
  unshownReason,
  valueTypeOf,
  type ColumnDraft,
  type DefinitionDraft,
  type ParameterDraft,
  type StatementParts,
  type TypeDraft,
} from './definitionDraft.js';
import { FileFields } from './FileFields.js';
import { HttpFields } from './HttpFields.js';
import { formatOf, partOf, requestText, templateOf } from './httpDraft.js';
import { connectionLink, queryDefinitionLink } from './links.js';
import { useDefinitionPlaces, type Place } from './places.js';
import styles from './QueryDefinitionPage.module.css';
import { isRecord, isRelations, refusalText, type Described } from './shapes.js';
import { isUses, UsedList, type Uses } from './uses.js';

type Client = ReturnType<typeof createApiClient>;

/** What a connection the person may not read is called, where its name is withheld. */
const UNREADABLE_CONNECTION = 'A connection you may not read';

/** A definition as the service answers it, checked before it is read. */
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
    (typeof statement.text === 'string' ||
      (statement.kind === 'builder' && isRecord(statement.query)) ||
      (statement.kind === 'http' && isRecord(statement.request) && isRecord(statement.format)) ||
      (statement.kind === 'file' && Array.isArray(statement.key) && isRecord(statement.format))) &&
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
      /**
       * The SQL that ran, an HTTP request's template that was sent, or the S3 object that was read
       * (the D6 plan, D6-L).
       */
      readonly ran:
        | { readonly sql: string }
        | { readonly request: Record<string, unknown> }
        | { readonly object: { readonly bucket: string; readonly key: string } };
      /** Each image in the rows, by its hash, as its header says (D8-G); none before D8. */
      readonly images?: Readonly<Record<string, SampledImage>>;
    }
  | { readonly outcome: 'failed'; readonly failure: Failure };

/** An image a sample ran, as its header says: never stored, never drawn (the D8 plan, D8-G). */
interface SampledImage {
  readonly format: 'png' | 'jpeg';
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

const FORMAT_WORDS = { png: 'PNG', jpeg: 'JPEG' } as const;

/** A size in bytes, in words: bytes, then KB and MB of 1,024, to one place. */
function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const [size, unit] = bytes < 1024 * 1024 ? [bytes / 1024, 'KB'] : [bytes / 1024 / 1024, 'MB'];
  return `${Number(size.toFixed(1))} ${unit}`;
}

/** A sample's cell in words: an image by its header, an empty cell, or the value as it is. */
function cellWords(
  value: string | boolean | null,
  base: string | undefined,
  images: Readonly<Record<string, SampledImage>> | undefined,
): string {
  if (value === null) return 'Empty';
  const image = base === 'image' && typeof value === 'string' ? images?.[value] : undefined;
  if (image === undefined) return String(value);
  return `Image: ${FORMAT_WORDS[image.format]}, ${sizeWords(image.bytes)}, ${image.width} by ${image.height} pixels`;
}

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
    (typeof value.ran.sql === 'string' ||
      isRecord(value.ran.request) ||
      (isRecord(value.ran.object) &&
        typeof value.ran.object.bucket === 'string' &&
        typeof value.ran.object.key === 'string'))
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
  position: 'cannot stand where the request places it',
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
 * A type chosen from the eight bases, with the digits, places or fraction the base needs; or, for a
 * column, an image, with how the source holds it and the text column describing it or decorative
 * (the D8 plan, D8-A).
 */
function TypeFields({
  type,
  onChange,
  name,
  disabled,
  textColumns,
}: {
  readonly type: TypeDraft;
  readonly onChange: (type: TypeDraft) => void;
  /** What each field's label names, as "Type of depth"; the parameter's own fields say "Type". */
  readonly name?: string;
  readonly disabled?: boolean;
  /** A column's: the definition's text columns, any of which may describe an image. */
  readonly textColumns?: readonly string[];
}) {
  const of = (label: string) => (name === undefined ? label : `${label} of ${name}`);
  const bases = textColumns === undefined ? BASES : COLUMN_BASES;
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
            {bases.map((each) => (
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
      {type.base === 'image' && textColumns !== undefined && (
        <>
          <Choice label={of('Encoding')}>
            {(id) => (
              <select
                id={id}
                value={type.encoding}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...type, encoding: event.target.value as TypeDraft['encoding'] })
                }
              >
                {type.encoding === '' && <option value="">Choose how the source holds it</option>}
                {ENCODINGS.map((each) => (
                  <option key={each.encoding} value={each.encoding}>
                    {each.label}
                  </option>
                ))}
              </select>
            )}
          </Choice>
          <Choice label={of('Description')}>
            {(id) => (
              <select
                id={id}
                value={
                  type.description === null
                    ? ''
                    : type.description === 'decorative'
                      ? 'decorative'
                      : `column:${type.description.column}`
                }
                disabled={disabled}
                onChange={(event) => {
                  const chosen = event.target.value;
                  onChange({
                    ...type,
                    description:
                      chosen === 'decorative'
                        ? 'decorative'
                        : chosen === ''
                          ? null
                          : { column: chosen.slice('column:'.length) },
                  });
                }}
              >
                {type.description === null && <option value="">Choose its description</option>}
                {type.description !== null &&
                  type.description !== 'decorative' &&
                  !textColumns.includes(type.description.column) && (
                    <option value={`column:${type.description.column}`}>
                      {`${type.description.column}, not a text column`}
                    </option>
                  )}
                {textColumns.map((column) => (
                  <option key={column} value={`column:${column}`}>
                    {column}
                  </option>
                ))}
                <option value="decorative">Decorative, with no description</option>
              </select>
            )}
          </Choice>
        </>
      )}
    </span>
  );
}

/** One parameter's declaration (DAT-010): its name, type, whether required or a list, and what it permits. */
function ParameterFields({
  index,
  parameter,
  built,
  onChange,
  onRemove,
}: {
  readonly index: number;
  readonly parameter: ParameterDraft;
  /** A built query's parameter, which chooses no fragment of SQL (D4-M). */
  readonly built: boolean;
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
      {!built && (
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
      )}
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

/** The SQL a built query runs, shown and never edited (DAT-099), or what it still needs. */
function GeneratedSql({ shown }: { readonly shown: { sql: string } | { needs: string } }) {
  const id = useId();
  return (
    <figure className={styles['generated']} aria-labelledby={id}>
      <figcaption id={id}>The SQL it runs</figcaption>
      <pre className={styles['sql']}>{'sql' in shown ? shown.sql : shown.needs}</pre>
    </figure>
  );
}

/** The SQL of a definition the person may only read, and its declarations, in words. */
function ReadOnly({ definition }: { readonly definition: QueryDefinition }) {
  const typeName = (type: ColumnType) => {
    const label = COLUMN_BASES.find((each) => each.base === type.base)?.label ?? type.base;
    if (type.base !== 'image') return label;
    const held = type.encoding === 'binary' ? 'binary' : 'base64 text';
    const described =
      type.description === 'decorative' ? 'decorative' : `described by ${type.description.column}`;
    return `${label}, ${held}, ${described}`;
  };
  const { fetch: statement } = definition;
  return (
    <>
      <p>{definition.description === '' ? 'No description.' : definition.description}</p>
      {statement.kind === 'http' ? (
        <figure className={styles['generated']}>
          <figcaption>The request it sends, after the connection&apos;s base URL</figcaption>
          <pre className={styles['sql']}>{sqlOf(definition)}</pre>
        </figure>
      ) : statement.kind === 'file' ? (
        <figure className={styles['generated']}>
          <figcaption>The object it reads, in the connection&apos;s bucket</figcaption>
          <pre className={styles['sql']}>{sqlOf(definition)}</pre>
        </figure>
      ) : statement.kind === 'builder' ? (
        <GeneratedSql shown={{ sql: sqlOf(definition) }} />
      ) : (
        <pre className={styles['sql']}>{sqlOf(definition)}</pre>
      )}
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

/** A stored definition as a sample runs it: the whole of it less its title, description and retired. */
function storedDraft(definition: QueryDefinition) {
  const draft: Partial<QueryDefinition> = { ...definition };
  delete draft.title;
  delete draft.description;
  delete draft.retired;
  return draft;
}

/** Where a definition is used: the components binding it and the documents holding its results. */
interface DefinitionUses {
  readonly components: Uses;
  readonly documents: Uses;
}

/**
 * A query definition (data.md, "What a query definition version holds"; the D2 plan, D2-U; the D4
 * plan, D4-O), at `#/query-definitions/<id>` or `#/query-definitions/new`, written in five steps: the
 * connection; the **Query**, built from one table or view (D4) or, where the person may write SQL on
 * the connection, written as SQL, and its parameters; **Describe**, which proposes each column from
 * the source's metadata for the author to confirm (DAT-105); its key, order, empty and limits; and
 * **Run sample**, which runs it exactly as a document would and shows the first rows or the one reason
 * it failed (DAT-014). **Save version** is offered once every column is confirmed; **Retire** and
 * **Reinstate** are versions too. A built query the page cannot show - joined, nested - opens
 * read-only with its SQL, saying why (D4-D).
 */
export function QueryDefinitionPage({
  client,
  id,
}: {
  readonly client: Client;
  readonly id: string;
}) {
  const isNew = id === 'new';
  const places = useDefinitionPlaces(client);
  const [view, setView] = useState<DefinitionView | 'missing' | 'failed' | null>(null);
  const [draft, setDraft] = useState<DefinitionDraft>(() => newDraft(defaultLimits));
  const [space, setSpace] = useState('');
  const [described, setDescribed] = useState<string[] | null>(null);
  const [source, setSource] = useState<Described | null>(null);
  const [sourceLines, setSourceLines] = useState<string[] | null>(null);
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [sampled, setSampled] = useState<Sampled | string[] | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uses, setUses] = useState<DefinitionUses | 'failed' | null>(null);
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

  // Where it is used, read with it, so a change shows what it affects before it is made (DAT-016).
  useEffect(() => {
    if (isNew) return;
    let current = true;
    void (async () => {
      try {
        const { data } = await client.GET('/v1/query-definitions/{id}/uses', {
          params: { path: { id } },
        });
        const answer: unknown = data;
        const read =
          typeof answer === 'object' &&
          answer !== null &&
          isUses((answer as { components?: unknown }).components) &&
          isUses((answer as { documents?: unknown }).documents)
            ? (answer as DefinitionUses)
            : 'failed';
        if (current) setUses(read);
      } catch {
        if (current) setUses('failed');
      }
    })();
    return () => {
      current = false;
    };
  }, [client, id, isNew]);

  // A new definition starts in the first space and on the first connection the person may use.
  useEffect(() => {
    if (!isNew || places === null) return;
    setSpace((held) => held || (places.spaces[0]?.id ?? ''));
    setDraft((held) => {
      if (held.connection !== '') return held;
      const first = places.connections[0]?.id ?? '';
      // An HTTP connection's query is a request template, an S3 connection's a file (the D6 plan).
      return {
        ...held,
        connection: first,
        mode: places.http.has(first) ? 'http' : places.s3.has(first) ? 'file' : held.mode,
      };
    });
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
  // A built query the builder cannot show opens read-only, saying why (D4-D).
  const unshown = shown === null ? null : unshownReason(shown.definition);
  const editable = mayEdit && unshown === null;
  // SQL is offered where the person may write it on the connection (DAT-101), or to a definition
  // already written as SQL, which the service let them open to change.
  const sqlOffered = (places?.sql.has(draft.connection) ?? false) || draft.mode === 'sql';
  const change = (over: Partial<DefinitionDraft>) => setDraft((held) => ({ ...held, ...over }));
  /**
   * A change to the query or its parameters, which may change what it returns: asked again of each
   * column. A change of parameters fits the builder's filters to them.
   */
  const changeStatement = (over: StatementParts) =>
    setDraft((held) =>
      withStatement(
        held,
        over.parameters === undefined
          ? over
          : { ...over, builder: fitFilters(over.builder ?? held.builder, over.parameters) },
      ),
    );
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

  /** Lists the source's tables and views, which the builder chooses its table or view from (D1). */
  const describeSource = () =>
    act('source', async () => {
      setSourceLines(null);
      if (draft.connection === '') {
        setSourceLines(['Choose a connection first.']);
        return;
      }
      try {
        const { data, error } = await client.POST('/v1/connections/{id}/describe', {
          params: { path: { id: draft.connection } },
          body: {},
        });
        const answer: unknown = data;
        if (isRelations(answer)) {
          setSource(answer);
          return;
        }
        setSourceLines(refusalLines(error, 'The source could not be described. Try again.'));
      } catch {
        setSourceLines(['The source could not be described. Try again.']);
      }
    });

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
      const built = draft.mode === 'builder';
      const query = built ? queryOf(draft.builder, draft.order) : null;
      if (typeof query === 'string') {
        setDescribed([query]);
        return;
      }
      const sent = statementOf(draft);
      try {
        const { data, error } = await client.POST('/v1/connections/{id}/describe', {
          params: { path: { id: draft.connection } },
          body:
            draft.mode === 'file'
              ? {
                  // A file is described by its rows: read by its key, with the values the key takes.
                  file: {
                    key: draft.file.key.map(partOf) as never,
                    format: formatOf(draft.file) as never,
                    parameters: keyNamed(draft, parameters) as never,
                    values: sampleValues(keyNamed(draft, draft.parameters), typed) as never,
                  },
                }
              : draft.mode === 'http'
              ? {
                  // An HTTP response is described by its rows: it is sent with the sample's values.
                  http: {
                    request: templateOf(draft.http) as never,
                    format: formatOf(draft.http) as never,
                    parameters: parameters as never,
                    values: sampleValues(draft.parameters, typed) as never,
                  },
                }
              : query === null
                ? { sql: { text: draft.sql, parameters: parameters as never } }
                : { builder: { query: query as never, parameters: parameters as never } },
        });
        const answer: unknown = data;
        if (isRecord(answer) && Array.isArray(answer.columns)) {
          // An answer for a statement changed since it was sent describes another one: dropped.
          const now = latest.current;
          if (statementOf(now) !== sent) {
            setDescribed([
              built
                ? 'The query changed while it was described. Describe it again.'
                : 'The SQL changed while it was described. Describe it again.',
            ]);
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
        setDescribed(refusalLines(error, 'The query could not be described. Try again.'));
      } catch {
        setDescribed(['The query could not be described. Try again.']);
      }
    });

  const sample = () =>
    act('sample', async () => {
      setSampled(null);
      // A definition the builder cannot show is sampled as it is stored.
      const definition =
        unshown !== null && shown !== null
          ? storedDraft(shown.definition)
          : sampleDefinition(draft);
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
  const textColumns = draft.columns
    .filter((column) => column.type.base === 'text')
    .map((column) => column.name);

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

      {!editable && shown !== null ? (
        <>
          {unshown !== null && (
            <p>{`This query definition can be read here and not changed: ${unshown}. Change it through the API.`}</p>
          )}
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
                    onChange={(event) => {
                      setSource(null);
                      setSourceLines(null);
                      const chosen = event.target.value;
                      // An HTTP connection's query is a request template, an S3 connection's a
                      // file; a database's is built or written (the D6 plan).
                      changeStatement({
                        connection: chosen,
                        mode:
                          places?.http.has(chosen) === true
                            ? 'http'
                            : places?.s3.has(chosen) === true
                              ? 'file'
                              : draft.mode === 'http' || draft.mode === 'file'
                                ? 'builder'
                                : draft.mode,
                      });
                    }}
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
                Only connections you may use are offered. SQL is offered only on one you may write
                SQL against, and runs only on one whose latest test found its account read-only.
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

          <Step title="Query">
            <div className={styles['form']}>
              {draft.mode === 'http' ? (
                <HttpFields
                  http={draft.http}
                  parameters={draft.parameters}
                  onChange={(http) => changeStatement({ http })}
                />
              ) : draft.mode === 'file' ? (
                <FileFields
                  file={draft.file}
                  parameters={draft.parameters}
                  columns={draft.columns.map((column) => {
                    const type = valueTypeOf(column.type);
                    return { name: column.name, type: typeof type === 'string' ? null : type };
                  })}
                  onChange={(file) => changeStatement({ file })}
                />
              ) : sqlOffered ? (
                <fieldset>
                  <legend>Write the query with</legend>
                  <label className={styles['check']}>
                    <input
                      type="radio"
                      name="mode"
                      checked={draft.mode === 'builder'}
                      onChange={() => changeStatement({ mode: 'builder' })}
                    />
                    Builder
                  </label>
                  <label className={styles['check']}>
                    <input
                      type="radio"
                      name="mode"
                      checked={draft.mode === 'sql'}
                      onChange={() => changeStatement({ mode: 'sql' })}
                    />
                    SQL
                  </label>
                </fieldset>
              ) : (
                <p className={styles['hint']}>
                  Built from the source&apos;s tables and views. SQL is offered where you may write
                  SQL on the connection.
                </p>
              )}
              {draft.mode === 'http' || draft.mode === 'file' ? null : draft.mode === 'builder' ? (
                <BuilderFields
                  builder={draft.builder}
                  parameters={draft.parameters}
                  described={source}
                  describedLines={sourceLines}
                  busy={busy !== null}
                  onDescribe={describeSource}
                  onChange={(builder) => changeStatement({ builder })}
                />
              ) : (
                <>
                  <Choice label="SQL text">
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
                </>
              )}
              {draft.parameters.map((parameter, at) => (
                <ParameterFields
                  key={at}
                  index={at}
                  built={draft.mode !== 'sql'}
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
              {draft.mode === 'builder' && <GeneratedSql shown={generatedSql(draft)} />}
            </div>
          </Step>

          <Step title="Columns">
            {mayRun && (
              <button type="button" disabled={busy !== null} onClick={describe}>
                {draft.mode === 'http' || draft.mode === 'file' ? 'Sample for columns' : 'Describe'}
              </button>
            )}
            <p className={styles['hint']}>
              {draft.mode === 'file'
                ? "Sample for columns reads the file with the sample values below and proposes a column, and a type, for each field or member of its first rows. A sample cannot prove a decimal's digits: nothing is saved until you have confirmed every one."
                : draft.mode === 'http'
                ? "Sample for columns sends the request with the sample values below and proposes a column, and a type, for each member of the first rows. A sample cannot prove a decimal's digits: nothing is saved until you have confirmed every one."
                : 'Describe asks the source what the query returns, without running it, and proposes a type for each column. Nothing is saved until you have confirmed every one.'}
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
                          textColumns={textColumns}
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
                  {draft.mode === 'builder' || draft.mode === 'file'
                    ? 'Return the rows in a declared order'
                    : 'Check the rows are in the order the SQL sorts them'}
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
                      {draft.mode === 'builder' || draft.mode === 'file'
                        ? 'The order covers the whole key. Text is ordered by code point.'
                        : 'The order covers the whole key. Text is compared by code point, so order a text column with COLLATE "C" in the SQL.'}
                    </p>
                    {draft.mode === 'builder' && (
                      <label>
                        Return at most
                        <input
                          inputMode="numeric"
                          value={draft.builder.limit}
                          onChange={(event) =>
                            change({ builder: { ...draft.builder, limit: event.target.value } })
                          }
                        />
                      </label>
                    )}
                  </>
                )}
                {draft.mode === 'builder' && draft.order === 'multiset' && (
                  <p className={styles['hint']}>
                    Return at most is offered beside a declared order: over rows in no order it
                    would choose them arbitrarily.
                  </p>
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
                        <td key={place}>
                          {cellWords(value, sampled.columns[place]?.[1], sampled.images)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                {'sql' in sampled.ran
                  ? 'The SQL that ran'
                  : 'object' in sampled.ran
                    ? 'The object that was read'
                    : 'The request that was sent'}
              </p>
              <pre className={styles['sql']}>
                {'sql' in sampled.ran
                  ? sampled.ran.sql
                  : 'object' in sampled.ran
                    ? `${sampled.ran.object.bucket}/${sampled.ran.object.key}`
                    : requestText(sampled.ran.request as never)}
              </pre>
            </div>
          )}
        </Step>
      )}

      {shown !== null && (
        <Step title="Used by">
          {uses === null ? null : uses === 'failed' ? (
            <p>What uses this query definition could not be read.</p>
          ) : uses.components.readable.length === 0 &&
            uses.components.others === 0 &&
            uses.documents.readable.length === 0 &&
            uses.documents.others === 0 ? (
            <p>No component binds this query definition yet.</p>
          ) : (
            <>
              <UsedList
                heading="Components"
                uses={uses.components}
                link={(component) => `#/components/${component}`}
                counted={(others) =>
                  `Bound by ${others} ${others === 1 ? 'component' : 'components'} you may not read.`
                }
              />
              <UsedList
                heading="Documents"
                uses={uses.documents}
                link={documentLink}
                counted={(others) =>
                  `Held by ${others} ${others === 1 ? 'document' : 'documents'} you may not read.`
                }
              />
              <p className={styles['hint']}>
                A binding that does not pin a version runs the latest one the next time it is
                resolved or checked.
              </p>
            </>
          )}
        </Step>
      )}

      {mayEdit && (
        <Step title="Save">
          {unshown !== null ? null : everyColumnConfirmed(draft) ? (
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
