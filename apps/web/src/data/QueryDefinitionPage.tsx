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
  NEW_BUILDER,
  NEW_PARAMETER,
  parameterSummary,
  DATASET_BUILDER,
  DATASET_TABLE,
  datasetColumnsOf,
  definitionOf,
  draftOf,
  everyColumnConfirmed,
  extensionRequestOf,
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
import { Act, FileFields, Section } from './FileFields.js';
import { HttpFields } from './HttpFields.js';
import { formatOf, partOf, requestText, templateOf } from './httpDraft.js';
import { connectionLink, queryDefinitionLink } from './links.js';
import { useDefinitionPlaces, useStoredResults, type Place } from './places.js';
import { Icon } from '../editor/Icon.js';
import { Chip } from '../parts/Chip.js';
import {
  readStanding,
  RevisionChip,
  standingIn,
  TransitionButtons,
  type Standing,
} from '../lifecycle/Workflow.js';
import { StateLozenge } from '../states/Lozenge.js';
import { DetailPage } from '../parts/DetailPage.js';
import { IconButton } from '../parts/IconButton.js';
import type { PanelTab } from '../parts/PanelTabs.js';
import { RowActions } from '../parts/RowActions.js';
import { RowTable } from '../parts/RowTable.js';
import { Segmented } from '../parts/Segmented.js';
import type { StripCell } from '../parts/StateStrip.js';
import { Tooltip } from '../parts/Tooltip.js';
import styles from './QueryDefinitionPage.module.css';
import { isConnectionView, isRecord, isRelations, refusalText, type Described } from './shapes.js';
import { isUses, PagedUses, type Uses } from './uses.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** What a connection the person may not read is called, where its name is withheld. */
const UNREADABLE_CONNECTION = (): string => words('data.a-connection-you-may-not');

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
  /** Where it stands in its workflow (DAT-121), read by `standingIn`. */
  readonly state?: unknown;
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
    // A query over a stored result runs on no connection (R21-A).
    (typeof definition.connection === 'string' ||
      (definition.connection === undefined &&
        isRecord(statement) &&
        statement.kind === 'dataset')) &&
    isRecord(statement) &&
    (typeof statement.text === 'string' ||
      ((statement.kind === 'builder' || statement.kind === 'dataset') &&
        isRecord(statement.query)) ||
      (statement.kind === 'http' && isRecord(statement.request) && isRecord(statement.format)) ||
      (statement.kind === 'extension' && isRecord(statement.request)) ||
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
        | { readonly object: { readonly bucket: string; readonly key: string } }
        | { readonly dataset: { readonly artifact: string; readonly version: string } };
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

/** The bases a sample's rows align to the right, as figures. */
const NUMBERS: ReadonlySet<string> = new Set(['integer', 'decimal']);

const FORMAT_WORDS = { png: 'PNG', jpeg: 'JPEG' } as const;

/** A size in bytes, in words: bytes, then KB and MB of 1,024, to one place. */
function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${words('data.bytes', { count: bytes })}`;
  const [size, unit] = bytes < 1024 * 1024 ? [bytes / 1024, 'KB'] : [bytes / 1024 / 1024, 'MB'];
  return `${Number(size.toFixed(1))} ${unit}`;
}

/** A sample's cell in words: an image by its header, an empty cell, or the value as it is. */
function cellWords(
  value: string | boolean | null,
  base: string | undefined,
  images: Readonly<Record<string, SampledImage>> | undefined,
): string {
  if (value === null) return words('data.empty');
  const image = base === 'image' && typeof value === 'string' ? images?.[value] : undefined;
  if (image === undefined) return String(value);
  return words('data.image-by-pixels', {
    value1: FORMAT_WORDS[image.format],
    value2: sizeWords(image.bytes),
    width: image.width,
    height: image.height,
  });
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
      (isRecord(value.ran.dataset) && typeof value.ran.dataset.artifact === 'string') ||
      (isRecord(value.ran.object) &&
        typeof value.ran.object.bucket === 'string' &&
        typeof value.ran.object.key === 'string'))
  );
}

/** What a value refused by its declaration broke, in words (D2-R). */
const PARAMETER_RULES: Readonly<Record<string, string>> = {
  get type() {
    return words('data.is-not-of-its-type');
  },
  get permitted() {
    return words('data.is-not-one-of-its');
  },
  get range() {
    return words('data.is-outside-its-range');
  },
  get list() {
    return words('data.is-not-a-list-as');
  },
  get precision() {
    return words('data.has-more-digits-than-its');
  },
  get scale() {
    return words('data.has-more-places-than-its');
  },
  get zone() {
    return words('data.needs-its-time-zone');
  },
  get variation() {
    return words('data.is-not-one-of-its-2');
  },
  get position() {
    return words('data.cannot-stand-where-the-request');
  },
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
            ? words('data.needs-a-value', { parameter: problem.parameter })
            : `${problem.parameter}: ${String(problem.value)} ${PARAMETER_RULES[problem.rule] ?? words('data.is-refused')}.`,
        );
      } else if (typeof problem.path === 'string' && typeof problem.message === 'string') {
        lines.push(`${problem.path}: ${problem.message}.`);
      }
    }
  }
  return lines;
}

/** "1 component", "2 documents". */
const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

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
  part,
}: {
  readonly type: TypeDraft;
  readonly onChange: (type: TypeDraft) => void;
  /** What each field's label names, as "Type of depth"; the parameter's own fields say "Type". */
  readonly name?: string;
  readonly disabled?: boolean;
  /** A column's: the definition's text columns, any of which may describe an image. */
  readonly textColumns?: readonly string[];
  /**
   * In a table's cells (the postgres query handoff): the type alone, or its own fields alone, each
   * shown in short words and named in full ("Digits", named "Digits of depth").
   */
  readonly part?: 'base' | 'own';
}) {
  const of = (label: string) => (name === undefined ? label : words('data.of-4', { label, name }));
  const shown = (label: string) => (part === undefined ? of(label) : label);
  const named = (label: string) => (part === undefined ? {} : { 'aria-label': of(label) });
  const bases = textColumns === undefined ? BASES : COLUMN_BASES;
  const base = (id?: string) => (
    <select
      {...(id === undefined ? { 'aria-label': of(words('data.type')) } : { id })}
      value={type.base}
      disabled={disabled}
      onChange={(event) => onChange({ ...type, base: event.target.value as TypeDraft['base'] })}
    >
      {type.base === '' && <option value="">{words('data.choose-a-type-2')}</option>}
      {bases.map((each) => (
        <option key={each.base} value={each.base}>
          {each.label}
        </option>
      ))}
    </select>
  );
  if (part === 'base') return base();
  return (
    <span className={styles[part === 'own' ? 'ownFields' : 'type']}>
      {part !== 'own' && <Choice label={of(words('data.type'))}>{(id) => base(id)}</Choice>}
      {type.base === 'decimal' && (
        <>
          <label>
            {shown(words('data.digits'))}
            <input
              {...named(words('data.digits'))}
              inputMode="numeric"
              value={type.precision}
              disabled={disabled}
              onChange={(event) => onChange({ ...type, precision: event.target.value })}
            />
          </label>
          <label>
            {shown(words('data.places'))}
            <input
              {...named(words('data.places'))}
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
          {shown(words('data.places-of-a-second'))}
          <input
            {...named(words('data.places-of-a-second'))}
            inputMode="numeric"
            value={type.fraction}
            disabled={disabled}
            onChange={(event) => onChange({ ...type, fraction: event.target.value })}
          />
        </label>
      )}
      {type.base === 'image' && textColumns !== undefined && (
        <>
          <Choice label={shown(words('data.encoding'))}>
            {(id) => (
              <select
                id={id}
                {...named(words('data.encoding'))}
                value={type.encoding}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...type, encoding: event.target.value as TypeDraft['encoding'] })
                }
              >
                {type.encoding === '' && (
                  <option value="">{words('data.choose-how-the-source-holds-2')}</option>
                )}
                {ENCODINGS.map((each) => (
                  <option key={each.encoding} value={each.encoding}>
                    {each.label}
                  </option>
                ))}
              </select>
            )}
          </Choice>
          <Choice label={shown(words('data.description'))}>
            {(id) => (
              <select
                id={id}
                {...named(words('data.description'))}
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
                {type.description === null && (
                  <option value="">{words('data.choose-its-description')}</option>
                )}
                {type.description !== null &&
                  type.description !== 'decorative' &&
                  !textColumns.includes(type.description.column) && (
                    <option value={`column:${type.description.column}`}>
                      {words('data.not-a-text-column', { column: type.description.column })}
                    </option>
                  )}
                {textColumns.map((column) => (
                  <option key={column} value={`column:${column}`}>
                    {column}
                  </option>
                ))}
                <option value="decorative">{words('data.decorative-with-no-description')}</option>
              </select>
            )}
          </Choice>
        </>
      )}
    </span>
  );
}

/**
 * One parameter's declaration (DAT-010), open (the postgres query handoff): a band on one line - its
 * name, type, what it permits, required, a list, and for SQL whether it chooses a fragment - with a
 * second line for what that needs (a decimal's digits, the values listed, a range), and its fragments
 * a row each.
 */
function ParameterFields({
  index,
  parameter,
  built,
  onChange,
}: {
  readonly index: number;
  readonly parameter: ParameterDraft;
  /** A built query's parameter, which chooses no fragment of SQL (D4-M). */
  readonly built: boolean;
  readonly onChange: (parameter: ParameterDraft) => void;
}) {
  const variation = parameter.variation.length > 0;
  const { base } = parameter.type;
  const own =
    base === 'decimal' || base === 'time' || base === 'localDateTime' || base === 'instant';
  const permits = !variation && parameter.permitted !== 'none';
  const setFragment = (at: number, over: Partial<ParameterDraft['variation'][number]>) =>
    onChange({
      ...parameter,
      variation: parameter.variation.map((held, place) =>
        place === at ? { ...held, ...over } : held,
      ),
    });
  return (
    <div
      role="group"
      aria-label={words('data.parameter-3', { value1: index + 1 })}
      className={styles['band']}
    >
      <div className={styles['bandLine']}>
        <input
          aria-label={words('data.name')}
          className={styles['bandName']}
          value={parameter.name}
          spellCheck={false}
          onChange={(event) => onChange({ ...parameter, name: event.target.value })}
        />
        <span className={styles['bandType']}>
          <TypeFields
            part="base"
            type={parameter.type}
            onChange={(type) => onChange({ ...parameter, type })}
          />
        </span>
        {!variation && (
          <select
            aria-label={words('data.permits')}
            className={styles['bandPermits']}
            value={parameter.permitted}
            onChange={(event) =>
              onChange({
                ...parameter,
                permitted: event.target.value as ParameterDraft['permitted'],
              })
            }
          >
            <option value="none">{words('data.any-value-of-its-type-2')}</option>
            <option value="values">{words('data.only-the-values-listed-2')}</option>
            <option value="range">{words('data.only-values-in-a-range-2')}</option>
          </select>
        )}
        <label className={styles['check']}>
          <input
            type="checkbox"
            checked={parameter.required}
            onChange={(event) => onChange({ ...parameter, required: event.target.checked })}
          />
          {words('data.required')}
        </label>
        <label className={styles['check']}>
          <input
            type="checkbox"
            checked={parameter.list}
            onChange={(event) => onChange({ ...parameter, list: event.target.checked })}
          />
          {words('data.a-list-of-values')}
        </label>
        {!built && (
          <label className={styles['check']} title={words('data.chooses-a-fragment-of-sql-2')}>
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
            {words('data.chooses-a-fragment-of-sql-3')}
          </label>
        )}
      </div>
      {(own || permits) && (
        <div className={styles['bandMore']}>
          {own && (
            <TypeFields
              part="own"
              type={parameter.type}
              onChange={(type) => onChange({ ...parameter, type })}
            />
          )}
          {permits && parameter.permitted === 'values' && (
            <label>
              {words('data.permitted-values-one-to-a')}
              <textarea
                rows={2}
                value={parameter.values}
                onChange={(event) => onChange({ ...parameter, values: event.target.value })}
              />
            </label>
          )}
          {permits && parameter.permitted === 'range' && (
            <>
              <label>
                {words('data.lowest')}
                <input
                  value={parameter.minimum}
                  onChange={(event) => onChange({ ...parameter, minimum: event.target.value })}
                />
              </label>
              <label>
                {words('data.highest')}
                <input
                  value={parameter.maximum}
                  onChange={(event) => onChange({ ...parameter, maximum: event.target.value })}
                />
              </label>
            </>
          )}
        </div>
      )}
      {variation && (
        <div className={styles['bandFragments']}>
          <RowTable
            label={words('data.fragments-of-parameter', { value1: index + 1 })}
            columns={[{ head: words('data.key'), width: 230 }, { head: words('data.fragment') }]}
            rows={parameter.variation.map((each, at) => ({
              key: at,
              cells: [
                <input
                  key="key"
                  aria-label={words('data.key-2', { value1: at + 1 })}
                  value={each.key}
                  spellCheck={false}
                  onChange={(event) => setFragment(at, { key: event.target.value })}
                />,
                <input
                  key="sql"
                  aria-label={words('data.fragment-2', { value1: at + 1 })}
                  className={styles['code']}
                  value={each.sql}
                  spellCheck={false}
                  onChange={(event) => setFragment(at, { sql: event.target.value })}
                />,
              ],
              remove: words('data.remove-fragment', { value1: at + 1 }),
              onRemove: () =>
                onChange({
                  ...parameter,
                  variation: parameter.variation.filter((_, place) => place !== at),
                }),
            }))}
          />
          <Act
            words="Add a fragment"
            onClick={() =>
              onChange({ ...parameter, variation: [...parameter.variation, { key: '', sql: '' }] })
            }
          />
        </div>
      )}
    </div>
  );
}

/**
 * The parameters, a line each (the query file handoff, QF-A): its name, what it takes in words, its
 * pencil opening it as a band in place (QF-B, the postgres query handoff), and its bin. The pencil
 * and the bin keep their places, open or closed, so the focus stays where it was.
 */
function ParameterLines({
  parameters,
  built,
  opened,
  onOpen,
  onChange,
  onRemove,
}: {
  readonly parameters: readonly ParameterDraft[];
  readonly built: boolean;
  readonly opened: ReadonlySet<number>;
  readonly onOpen: (at: number) => void;
  readonly onChange: (at: number, parameter: ParameterDraft) => void;
  readonly onRemove: (at: number) => void;
}) {
  return (
    <ul className={styles['parameterLines']}>
      {parameters.map((parameter, at) => {
        const open = opened.has(at);
        return (
          <li key={at} {...(open ? { 'data-open': 'true' } : {})}>
            <div className={styles['parameterLine']}>
              {open ? (
                <ParameterFields
                  key="fields"
                  index={at}
                  built={built}
                  parameter={parameter}
                  onChange={(changed) => onChange(at, changed)}
                />
              ) : (
                <span key="said" className={styles['parameterSaid']}>
                  <span className={styles['parameterName']}>
                    {parameter.name === '' ? words('data.not-named-yet') : parameter.name}
                  </span>
                  <span className={styles['hint']}>{parameterSummary(parameter)}</span>
                </span>
              )}
              <IconButton
                key="edit"
                label={words('data.edit-parameter', { value1: at + 1 })}
                className={styles['lineIcon']}
                aria-expanded={open}
                onClick={() => onOpen(at)}
              >
                <Icon name={open ? 'Move up' : 'Edit'} />
              </IconButton>
              <IconButton
                key="remove"
                label={words('data.remove-parameter', { value1: at + 1 })}
                className={styles['lineIcon']}
                onClick={() => onRemove(at)}
              >
                <Icon name="Delete" />
              </IconButton>
            </div>
          </li>
        );
      })}
    </ul>
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
            <option value="">{words('data.no-value')}</option>
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
      <figcaption id={id}>{words('data.the-sql-it-runs')}</figcaption>
      <pre className={styles['sql']}>{'sql' in shown ? shown.sql : shown.needs}</pre>
    </figure>
  );
}

/** A column's type in words, for a reader who may change nothing. */
function typeName(type: ColumnType) {
  const label = COLUMN_BASES.find((each) => each.base === type.base)?.label ?? type.base;
  if (type.base !== 'image') return label;
  const held = type.encoding === 'binary' ? 'binary' : words('data.base64-text-2');
  const described =
    type.description === 'decorative'
      ? 'decorative'
      : words('data.described-by', { column: type.description.column });
  return `${label}, ${held}, ${described}`;
}

/** The SQL, request or object of a definition the person may only read. */
function ReadOnlyStatement({ definition }: { readonly definition: QueryDefinition }) {
  const { fetch: statement } = definition;
  return statement.kind === 'http' ? (
    <figure className={styles['generated']}>
      <figcaption>{words('data.the-request-it-sends-after')}</figcaption>
      <pre className={styles['sql']}>{sqlOf(definition)}</pre>
    </figure>
  ) : statement.kind === 'extension' ? (
    <figure className={styles['generated']}>
      <figcaption>{words('data.the-request-it-sends-to')}</figcaption>
      <pre className={styles['sql']}>{sqlOf(definition)}</pre>
    </figure>
  ) : statement.kind === 'file' ? (
    <figure className={styles['generated']}>
      <figcaption>{words('data.the-object-it-reads-in')}</figcaption>
      <pre className={styles['sql']}>{sqlOf(definition)}</pre>
    </figure>
  ) : statement.kind === 'builder' ? (
    <GeneratedSql shown={{ sql: sqlOf(definition) }} />
  ) : (
    <pre className={styles['sql']}>{sqlOf(definition)}</pre>
  );
}

/** The columns of a definition the person may only read, each with its type in words. */
function ReadOnlyColumns({ definition }: { readonly definition: QueryDefinition }) {
  return (
    <table className={styles['table']}>
      <caption>{words('data.columns-2')}</caption>
      <thead>
        <tr>
          <th scope="col">{words('data.name')}</th>
          <th scope="col">{words('data.type')}</th>
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
  tab = null,
}: {
  readonly client: Client;
  readonly id: string;
  /** The tab the address names, or null for Details (ADR-0050). */
  readonly tab?: string | null;
}) {
  const isNew = id === 'new';
  const places = useDefinitionPlaces(client);
  const stored = useStoredResults(client);
  const [view, setView] = useState<DefinitionView | 'missing' | 'failed' | null>(null);
  const [draft, setDraft] = useState<DefinitionDraft>(() => newDraft(defaultLimits));
  /** Which parameters show their fields under their line (QF-B). */
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [space, setSpace] = useState('');
  const [described, setDescribed] = useState<string[] | null>(null);
  const [source, setSource] = useState<Described | null>(null);
  const [sourceLines, setSourceLines] = useState<string[] | null>(null);
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
  const [sampled, setSampled] = useState<Sampled | string[] | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  // Its workflow standing as a move or a decision answered it, until its view is read again (DAT-121).
  const [standingNow, setStandingNow] = useState<Standing | undefined>(undefined);
  const [workflowSaid, setWorkflowSaid] = useState('');
  const viewed = typeof view === 'object' && view !== null ? view.version.id : null;
  useEffect(() => setStandingNow(undefined), [viewed]);
  const [busy, setBusy] = useState<string | null>(null);
  const [uses, setUses] = useState<DefinitionUses | 'failed' | null>(null);
  const working = useRef(false);
  const ids = useId();
  const heldId = `${ids}-held`;
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
      // An HTTP connection's query is a request template, an S3 connection's a file (the D6 plan),
      // an extension's its own request (EX-G).
      return {
        ...held,
        connection: first,
        mode: places.http.has(first)
          ? 'http'
          : places.s3.has(first)
            ? 'file'
            : places.extension.has(first)
              ? 'extension'
              : held.mode,
      };
    });
  }, [isNew, places]);

  // Whether the extension a request is sent to binds parameters, as its connection's snapshot of its
  // manifest says (DAT-079): null where that could not be read.
  const [binding, setBinding] = useState<{
    readonly connection: string;
    readonly binds: boolean | null;
  } | null>(null);
  useEffect(() => {
    if (draft.mode !== 'extension' || draft.connection === '') return undefined;
    let current = true;
    const connection = draft.connection;
    client
      .GET('/v1/connections/{id}', { params: { path: { id: connection } } })
      .then(({ data }) => {
        const answer: unknown = data;
        if (!current) return;
        setBinding({
          connection,
          binds:
            isConnectionView(answer) && answer.settings.type === 'extension'
              ? answer.settings.source.capabilities.parameters
              : null,
        });
      })
      .catch(() => current && setBinding({ connection, binds: null }));
    return () => {
      current = false;
    };
  }, [client, draft.mode, draft.connection]);

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
            ? words('data.there-is-no-such-query')
            : words('data.the-query-definition-could-not')}
        </p>
        {view === 'failed' && (
          <button type="button" onClick={() => void load()}>
            {words('data.try-again')}
          </button>
        )}
      </Notice>
    );
  }

  const shown = view;
  // Where it stands in its workflow, as its view says, and as a move or a decision since answered.
  const standing = shown === null ? undefined : standingIn(shown);
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
  const addParameter = () => {
    setOpened(new Set([...opened, draft.parameters.length]));
    changeStatement({ parameters: [...draft.parameters, NEW_PARAMETER] });
  };
  const removeParameter = (at: number) => {
    setOpened(
      new Set(
        [...opened].filter((each) => each !== at).map((each) => (each > at ? each - 1 : each)),
      ),
    );
    changeStatement({ parameters: draft.parameters.filter((_, place) => place !== at) });
  };
  const parameterLines = (
    <ParameterLines
      parameters={draft.parameters}
      built={draft.mode !== 'sql'}
      opened={opened}
      onOpen={(at) =>
        setOpened(
          opened.has(at)
            ? new Set([...opened].filter((each) => each !== at))
            : new Set([...opened, at]),
        )
      }
      onChange={(at, changed) => setParameter(at, changed)}
      onRemove={removeParameter}
    />
  );
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
      ? [{ id: shown.connection.id, name: shown.connection.name ?? UNREADABLE_CONNECTION() }]
      : []),
  ];

  /** Lists the source's tables and views, which the builder chooses its table or view from (D1). */
  const describeSource = () =>
    act('source', async () => {
      setSourceLines(null);
      if (draft.connection === '') {
        setSourceLines([words('data.choose-a-connection-first')]);
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
        setSourceLines(refusalLines(error, words('data.the-source-could-not-be')));
      } catch {
        setSourceLines([words('data.the-source-could-not-be')]);
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
      if (draft.mode === 'dataset') {
        // A query over a stored result is described here, from the stored result's own columns.
        const over = stored?.find((each) => each.id === draft.dataset);
        const query = queryOf(draft.builder, draft.order);
        if (over === undefined || typeof query === 'string') {
          setDescribed([
            over === undefined ? words('data.choose-a-stored-result-first') : String(query),
          ]);
          return;
        }
        const proposed = proposedColumns(datasetColumnsOf(query, over.columns), draft.columns);
        setDraft((held) => ({
          ...held,
          columns: proposed,
          key: held.key.filter((name) => proposed.some((each) => each.name === name)),
          order:
            held.order === 'multiset'
              ? 'multiset'
              : held.order.filter((each) => proposed.some((column) => column.name === each.column)),
        }));
        setDescribed([
          words('data.proposed-confirm-the-type-of', {
            length: proposed.length,
            value2: proposed.length === 1 ? 'column' : 'columns',
          }),
        ]);
        return;
      }
      if (draft.connection === '') {
        setDescribed([words('data.choose-a-connection-first')]);
        return;
      }
      const built = draft.mode === 'builder';
      const query = built ? queryOf(draft.builder, draft.order) : null;
      if (typeof query === 'string') {
        setDescribed([query]);
        return;
      }
      const request = draft.mode === 'extension' ? extensionRequestOf(draft.extension) : null;
      if (typeof request === 'string') {
        setDescribed([request]);
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
              : request !== null
                ? {
                    // An extension is described by its rows, as an HTTP response is (EX-G).
                    extension: {
                      request,
                      parameters: parameters as never,
                      values: sampleValues(draft.parameters, typed) as never,
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
                ? words('data.the-query-changed-while-it')
                : words('data.the-sql-changed-while-it'),
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
            words('data.proposed-confirm-the-type-of', {
              length: proposed.length,
              value2: proposed.length === 1 ? 'column' : 'columns',
            }),
          ]);
          return;
        }
        setDescribed(refusalLines(error, words('data.the-query-could-not-be')));
      } catch {
        setDescribed([words('data.the-query-could-not-be')]);
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
        const body = {
          definition: definition as never,
          values: sampleValues(draft.parameters, typed),
        };
        const { data, error, response } =
          draft.mode === 'dataset'
            ? await client.POST('/v1/datasets/{id}/sample', {
                params: { path: { id: draft.dataset } },
                body,
              })
            : await client.POST('/v1/connections/{id}/sample', {
                params: { path: { id: draft.connection } },
                body,
              });
        if (isSampled(data)) {
          setSampled(data);
          return;
        }
        setSampled(
          response.status === 401
            ? [words('data.you-are-signed-out-sign-5')]
            : refusalLines(error, words('data.the-sample-could-not-be')),
        );
      } catch {
        setSampled([words('data.the-sample-could-not-be')]);
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
        setSaved([
          data.version.id === shown.version.id ? words('data.nothing-had-changed') : done(data),
        ]);
        return;
      }
      const refusal: unknown = error;
      if (response.status === 409 && isRecord(refusal) && isDefinitionView(refusal.current)) {
        show(refusal.current);
        setSaved([words('data.somebody-saved-a-newer-version-2')]);
        return;
      }
      setSaved(
        response.status === 401
          ? [words('data.you-are-signed-out-sign-6')]
          : refusalLines(error, words('data.the-query-definition-could-not-2')),
      );
    } catch {
      setSaved([words('data.the-query-definition-could-not-2')]);
    }
  };

  const save = () =>
    act('save', async () => {
      setSaved(null);
      if (draft.title.trim() === '') {
        setSaved([words('data.give-the-query-definition-a')]);
        return;
      }
      const definition = definitionOf(draft);
      if (typeof definition === 'string') {
        setSaved([definition]);
        return;
      }
      await send(definition, (made) =>
        words('data.saved-as-version', { number: made.version.number }),
      );
    });

  const retire = (to: boolean) =>
    act('retire', async () => {
      if (shown === null) return;
      setSaved(null);
      await send(
        { ...shown.definition, retired: to },
        () => (to ? words('data.retired-it-runs-nothing-now') : words('data.reinstated')),
        true,
      );
    });

  const retired = shown?.definition.retired === true;
  const columnNames = draft.columns.map((column) => column.name);
  const textColumns = draft.columns
    .filter((column) => column.type.base === 'text')
    .map((column) => column.name);
  // What the strip and Save version say of the columns (ADR-0050, decisions 3 and 4).
  const confirmed = draft.columns.filter((column) => column.confirmed).length;
  const toConfirm = draft.columns.length - confirmed;
  const held = editable && !everyColumnConfirmed(draft);
  const connectionName = connections.find((each) => each.id === draft.connection)?.name ?? null;
  const kind =
    draft.mode === 'http'
      ? words('data.an-http-api')
      : draft.mode === 'file'
        ? words('data.an-s3-bucket')
        : draft.mode === 'extension'
          ? words('data.an-extension')
          : words('data.a-postgresql');
  const storedName =
    draft.mode === 'dataset'
      ? (stored?.find((each) => each.id === draft.dataset)?.name ??
        words('data.a-stored-result-you-may'))
      : null;
  const usedBy =
    uses === null || uses === 'failed'
      ? null
      : {
          components: uses.components.readable.length + uses.components.others,
          documents: uses.documents.readable.length + uses.documents.others,
        };
  // A new definition's other tabs wait for its connection (the DP plan, DP-I).
  const waiting =
    isNew && (draft.mode === 'dataset' ? draft.dataset === '' : draft.connection === '');
  const tabs: PanelTab[] = [
    { key: 'details', label: words('data.details') },
    { key: 'query', label: words('data.query'), disabled: waiting },
    toConfirm > 0 && editable
      ? {
          key: 'columns',
          label: words('data.columns-2'),
          name: words('data.columns-to-confirm', { toConfirm }),
          tone: 'warn',
          disabled: waiting,
        }
      : { key: 'columns', label: words('data.columns-2'), disabled: waiting },
    ...(editable ? [{ key: 'rows', label: words('data.rows'), disabled: waiting }] : []),
    ...(mayRun ? [{ key: 'sample', label: words('data.sample'), disabled: waiting }] : []),
    ...(shown === null
      ? []
      : [
          {
            key: 'used-by',
            label: words('data.used-by'),
            ...(usedBy === null ? {} : { count: usedBy.components + usedBy.documents }),
          },
        ]),
  ];
  const runsAgainst =
    storedName !== null ? (
      draft.dataset === '' ? (
        words('data.no-stored-result-chosen')
      ) : (
        storedName
      )
    ) : shown !== null && !editable ? (
      shown.connection === null ? (
        words('data.a-connection-that-is-no')
      ) : shown.connection.name === null ? (
        words('data.a-connection-you-may-not-2')
      ) : (
        <a href={connectionLink(shown.connection.id)}>{shown.connection.name}</a>
      )
    ) : connectionName === null ? (
      words('data.no-connection-chosen')
    ) : connectionName === UNREADABLE_CONNECTION() ? (
      words('data.a-connection-you-may-not-2')
    ) : (
      <a href={connectionLink(draft.connection)}>{connectionName}</a>
    );
  const strip: StripCell[] = [
    {
      key: 'runs-against',
      icon: words('data.connection'),
      tone: 'muted',
      label: words('data.runs-against'),
      value: runsAgainst,
      ...(storedName !== null
        ? { detail: words('data.a-stored-result-queried-in') }
        : connectionName === null
          ? {}
          : { detail: words('data.connection-2', { kind }) }),
    },
    draft.columns.length === 0
      ? {
          key: 'columns',
          icon: words('data.needs-attention'),
          tone: 'muted',
          label: words('data.columns-2'),
          value: words('data.none-yet'),
          detail: words('data.describe-the-query-to-propose-2'),
        }
      : toConfirm === 0 || !editable
        ? {
            key: 'columns',
            icon: words('data.done-editing'),
            tone: 'ok',
            label: words('data.columns-2'),
            value: words('data.of-confirmed', { length: draft.columns.length }),
            detail: words('data.every-type-confirmed'),
          }
        : {
            key: 'columns',
            icon: words('data.needs-attention'),
            tone: 'warn',
            label: words('data.columns-2'),
            value: words('data.of-confirmed-2', { confirmed, length: draft.columns.length }),
            detail: words('data.confirm-the-rest-to-save'),
          },
    ...(shown === null
      ? []
      : [
          {
            key: 'used-by',
            icon: words('data.used-by'),
            tone: 'muted' as const,
            label: words('data.used-by'),
            value:
              uses === 'failed'
                ? words('data.could-not-be-read')
                : usedBy === null
                  ? ''
                  : counted(usedBy.components, 'component', 'components'),
            ...(usedBy === null
              ? {}
              : {
                  detail: words('data.and', {
                    value1: counted(usedBy.documents, 'document', 'documents'),
                  }),
                }),
          },
        ]),
  ];

  return (
    <DetailPage
      trail={
        <>
          <a href="#/query-definitions">{words('data.query-definitions-2')}</a>
          {shown !== null && ` / ${shown.space.name}`}
        </>
      }
      title={isNew ? words('data.new-query-definition') : shown!.definition.title}
      chips={
        shown === null ? undefined : (
          <>
            <Chip className={styles['mono']}>
              {words('data.version', { number: shown.version.number })}
            </Chip>
            <Chip>{words('data.in-2', { name: shown.space.name })}</Chip>
            {standing && <StateLozenge state={standing.state} />}
            <RevisionChip revision={standing?.revision} />
            {retired && <Chip tone="warn">{words('data.retired')}</Chip>}
            {shown.definition.description !== '' && (
              <span className={styles['described']}>{shown.definition.description}</span>
            )}
          </>
        )
      }
      actions={
        <>
          {held && (
            <span id={heldId} className={styles['held']}>
              {words('data.confirm-every-column-to-save')}
            </span>
          )}
          {editable && (
            <button
              type="button"
              className="primary"
              disabled={busy !== null}
              aria-disabled={held}
              {...(held ? { 'aria-describedby': heldId } : {})}
              onClick={() => {
                if (!held) save();
              }}
            >
              {words('data.save-version')}
            </button>
          )}
          {/* Reviewed and approved as content is (DAT-121; the WF2 plan, WF2-K). */}
          {standing && shown !== null && (
            <TransitionButtons
              client={client}
              kind="queryDefinition"
              id={shown.id}
              title={shown.definition.title}
              standing={standingNow ?? standing}
              versionId={shown.version.id}
              onMoved={(now, said) => {
                setStandingNow(now);
                setWorkflowSaid(said);
              }}
              onNotice={setWorkflowSaid}
              onStale={() => {
                void readStanding(client, 'queryDefinition', shown.id).then((now) => {
                  if (now) setStandingNow(now);
                });
              }}
            />
          )}
          {mayEdit && shown !== null && (
            <RowActions
              subject={shown.definition.title}
              shown={[]}
              more={[
                {
                  label: retired ? words('data.reinstate') : words('data.retire'),
                  onSelect: () => retire(!retired),
                },
              ]}
            />
          )}
        </>
      }
      strip={strip}
      notice={<Status lines={workflowSaid === '' ? saved : [...(saved ?? []), workflowSaid]} />}
      label={words('data.query-definition-2')}
      tabs={tabs}
      chosen={tab}
      link={(key) => queryDefinitionLink(id, key)}
    >
      {(open) =>
        !editable && shown !== null
          ? readOnlyPanel(open, shown)
          : open === 'query'
            ? queryPanel()
            : open === 'columns'
              ? columnsPanel()
              : open === 'rows'
                ? rowsPanel()
                : open === 'sample'
                  ? samplePanel()
                  : open === 'used-by'
                    ? usedByPanel()
                    : detailsPanel()
      }
    </DetailPage>
  );

  /** What a reader who may change nothing is shown on each tab, as is a definition the builder cannot show. */
  function readOnlyPanel(open: string, shown: DefinitionView) {
    if (open === 'sample') return samplePanel();
    if (open === 'used-by') return usedByPanel();
    if (open === 'query') {
      return (
        <section className={styles['card']} aria-label={words('data.query')}>
          <ReadOnlyStatement definition={shown.definition} />
        </section>
      );
    }
    if (open === 'columns') {
      return (
        <section className={styles['card']} aria-label={words('data.columns-2')}>
          <ReadOnlyColumns definition={shown.definition} />
        </section>
      );
    }
    return (
      <section
        className={`${styles['card']} ${styles['narrow']}`}
        aria-label={words('data.details')}
      >
        {unshown !== null && <p>{words('data.this-query-definition-can-be', { unshown })}</p>}
        <p>
          {words('data.runs-against-2')}
          {runsAgainst}.
        </p>
        <p>
          {shown.definition.description === ''
            ? words('data.no-description')
            : shown.definition.description}
        </p>
      </section>
    );
  }

  function detailsPanel() {
    return (
      <section
        className={`${styles['card']} ${styles['narrow']}`}
        aria-label={words('data.details')}
      >
        <div className={styles['form']}>
          {isNew && (
            <Choice label={words('data.space')}>
              {(id) => (
                <select id={id} value={space} onChange={(event) => setSpace(event.target.value)}>
                  {(places?.spaces ?? []).map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.name}
                    </option>
                  ))}
                </select>
              )}
            </Choice>
          )}
          {((stored?.length ?? 0) > 0 || draft.mode === 'dataset') && (
            <Segmented
              label={words('data.runs-against')}
              value={draft.mode === 'dataset' ? 'dataset' : 'connection'}
              onChange={(chosen) => {
                setSource(null);
                setSourceLines(null);
                changeStatement(
                  chosen === 'dataset'
                    ? { mode: 'dataset', connection: '', builder: DATASET_BUILDER }
                    : {
                        mode: 'builder',
                        dataset: '',
                        builder: NEW_BUILDER,
                        connection: places?.connections[0]?.id ?? '',
                      },
                );
              }}
              options={[
                {
                  value: 'connection',
                  label: words('data.a-connection'),
                  name: words('data.a-connection'),
                },
                {
                  value: 'dataset',
                  label: words('data.a-stored-result'),
                  name: words('data.a-stored-result'),
                },
              ]}
            />
          )}
          {draft.mode === 'dataset' ? (
            <>
              <Choice label={words('data.stored-result')}>
                {(id) => (
                  <select
                    id={id}
                    value={draft.dataset}
                    onChange={(event) =>
                      changeStatement({ dataset: event.target.value, builder: DATASET_BUILDER })
                    }
                  >
                    {draft.dataset === '' && (
                      <option value="">{words('data.choose-a-stored-result-2')}</option>
                    )}
                    {(stored ?? []).map((each) => (
                      <option key={each.id} value={each.id}>
                        {each.name}
                      </option>
                    ))}
                  </select>
                )}
              </Choice>
              <p className={styles['hint']}>{words('data.only-stored-results-you-may')}</p>
            </>
          ) : (
            <>
              <Choice label={words('data.connection')}>
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
                              : places?.extension.has(chosen) === true
                                ? 'extension'
                                : draft.mode === 'http' ||
                                    draft.mode === 'file' ||
                                    draft.mode === 'extension'
                                  ? 'builder'
                                  : draft.mode,
                      });
                    }}
                  >
                    {draft.connection === '' && (
                      <option value="">{words('data.choose-a-connection')}</option>
                    )}
                    {connections.map((each) => (
                      <option key={each.id} value={each.id}>
                        {each.name}
                      </option>
                    ))}
                  </select>
                )}
              </Choice>
              <p className={styles['hint']}>{words('data.only-connections-you-may-use')}</p>
            </>
          )}
          <label>
            {words('data.title')}
            <input
              value={draft.title}
              onChange={(event) => change({ title: event.target.value })}
            />
          </label>
          <Choice label={words('data.description')}>
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
      </section>
    );
  }

  function queryPanel() {
    // A file's query is one card, its parameters its last section (the query file handoff, QF-A).
    if (draft.mode === 'file') {
      return (
        <section
          className={`${styles['card']} ${styles['fileCard']}`}
          aria-label={words('data.query')}
        >
          <FileFields
            file={draft.file}
            parameters={draft.parameters}
            columns={draft.columns.map((column) => {
              const type = valueTypeOf(column.type);
              return { name: column.name, type: typeof type === 'string' ? null : type };
            })}
            onChange={(file) => changeStatement({ file })}
          />
          <Section
            heading="Parameters"
            count={draft.parameters.length}
            acts={<Act words="Add parameter" onClick={addParameter} />}
          >
            {parameterLines}
          </Section>
        </section>
      );
    }
    // A stored result's query (R21-A): the builder over its one table, its columns the stored result's.
    if (draft.mode === 'dataset') {
      const over = stored?.find((each) => each.id === draft.dataset);
      const described: Described | null =
        over === undefined
          ? null
          : {
              relations: [
                {
                  ...DATASET_TABLE,
                  kind: 'table',
                  columns: over.columns.map((each) => ({
                    name: each.name,
                    sourceType: each.type.base,
                    proposed: each.type.base === 'image' ? null : each.type,
                  })),
                } as never,
              ],
              truncated: false,
              leftOut: { relations: 0, columns: 0 },
            };
      return (
        <section
          className={`${styles['card']} ${styles['fileCard']}`}
          aria-label={words('data.query')}
        >
          <BuilderFields
            builder={draft.builder}
            parameters={draft.parameters}
            described={described}
            describedLines={
              over === undefined ? [words('data.choose-a-stored-result-first')] : null
            }
            busy={busy !== null}
            onDescribe={() => undefined}
            onChange={(builder) => changeStatement({ builder })}
            head={
              <span className={styles['hint']}>{words('data.built-from-the-stored-result')}</span>
            }
          />
          <Section
            heading="Parameters"
            count={draft.parameters.length}
            acts={<Act words="Add parameter" onClick={addParameter} />}
          >
            {parameterLines}
          </Section>
        </section>
      );
    }
    // Builder or SQL (the postgres query handoff): one card, the query line first, its parameters
    // after, and for a built query the SQL it runs, closed, at its foot (PQ-A).
    if (draft.mode === 'builder' || draft.mode === 'sql') {
      const head = sqlOffered ? (
        <Segmented
          label={words('data.write-the-query-with')}
          value={draft.mode}
          onChange={(mode) => changeStatement({ mode: mode as 'builder' | 'sql' })}
          options={[
            { value: 'builder', label: words('data.builder'), name: words('data.builder') },
            { value: 'sql', label: 'SQL', name: 'SQL' },
          ]}
        />
      ) : (
        <span className={styles['hint']}>{words('data.built-from-the-source-s')}</span>
      );
      const named = connections.find((each) => each.id === draft.connection)?.name;
      return (
        <section
          className={`${styles['card']} ${styles['fileCard']}`}
          aria-label={words('data.query')}
        >
          {draft.mode === 'builder' ? (
            <BuilderFields
              builder={draft.builder}
              parameters={draft.parameters}
              described={source}
              describedLines={sourceLines}
              busy={busy !== null}
              onDescribe={describeSource}
              onChange={(builder) => changeStatement({ builder })}
              head={head}
            />
          ) : (
            <>
              <Section
                heading="Write the query with"
                aside={<span className={styles['queryLine']}>{head}</span>}
                acts={
                  named !== undefined && (
                    <span className={styles['hint']}>
                      {words('data.sql-is-offered-because-you', { named })}
                    </span>
                  )
                }
              />
              <Section
                heading="SQL text"
                region={false}
                hint={
                  <>
                    {words('data.write-a-value-as')}
                    {'{{name}}'} {words('data.and-a-fragment-as')}
                    {'{{#name}}'}
                    {words('data.each-naming-a-parameter-a')}
                  </>
                }
              >
                <textarea
                  aria-label={words('data.sql-text')}
                  className={`${styles['code']} ${styles['sqlText']}`}
                  rows={14}
                  spellCheck={false}
                  value={draft.sql}
                  onChange={(event) => changeStatement({ sql: event.target.value })}
                />
              </Section>
            </>
          )}
          <Section
            heading="Parameters"
            count={draft.parameters.length}
            acts={<Act words="Add parameter" onClick={addParameter} />}
          >
            {parameterLines}
          </Section>
          {/* SQL the author writes, so offered where SQL is (DAT-073; the FR plan, FR-B). */}
          {(sqlOffered || draft.revision !== '') && (
            <Section
              heading="Revision statement"
              region={false}
              hint={<>{words('data.optional-sql-answering-one-value')}</>}
            >
              <textarea
                aria-label={words('data.revision-statement')}
                className={`${styles['code']} ${styles['sqlText']}`}
                rows={3}
                spellCheck={false}
                value={draft.revision}
                onChange={(event) => change({ revision: event.target.value })}
              />
            </Section>
          )}
          {draft.mode === 'builder' && (
            <details className={styles['runs']}>
              <summary>{words('data.the-sql-it-runs')}</summary>
              <GeneratedSql shown={generatedSql(draft)} />
            </details>
          )}
        </section>
      );
    }
    // An extension's: its own request, as JSON, and its parameters where it binds them (EX-G, DAT-079).
    if (draft.mode === 'extension') {
      const binds = binding?.connection === draft.connection ? binding.binds : null;
      return (
        <section
          className={`${styles['card']} ${styles['fileCard']}`}
          aria-label={words('data.query')}
        >
          <Section
            heading="Request"
            region={false}
            hint="Sent to the extension as it is written, with the values bound beside it by name. What it means is the extension's own: at most 64 KiB."
          >
            <textarea
              aria-label={words('data.request-a-json-object')}
              className={`${styles['code']} ${styles['sqlText']}`}
              rows={14}
              spellCheck={false}
              value={draft.extension}
              onChange={(event) => changeStatement({ extension: event.target.value })}
            />
          </Section>
          {binds === true || draft.parameters.length > 0 ? (
            <Section
              heading="Parameters"
              count={draft.parameters.length}
              acts={binds === true && <Act words="Add parameter" onClick={addParameter} />}
            >
              {parameterLines}
            </Section>
          ) : null}
          {binds !== true && (
            <p className={styles['hint']}>
              {binds === false
                ? words('data.this-extension-binds-no-parameters')
                : binding?.connection === draft.connection
                  ? words('data.whether-this-extension-binds-parameters')
                  : ''}
            </p>
          )}
        </section>
      );
    }
    // HTTP: one card too (PQ-E), its request as it is until an HTTP handoff, then its parameters.
    return (
      <section
        className={`${styles['card']} ${styles['fileCard']}`}
        aria-label={words('data.query')}
      >
        <div className={styles['httpBody']}>
          <div className={styles['form']}>
            <HttpFields
              http={draft.http}
              parameters={draft.parameters}
              onChange={(http) => changeStatement({ http })}
            />
          </div>
        </div>
        <Section
          heading="Parameters"
          count={draft.parameters.length}
          acts={<Act words="Add parameter" onClick={addParameter} />}
        >
          {parameterLines}
        </Section>
      </section>
    );
  }

  /**
   * Columns (the postgres query handoff): a column a row - its type and the type's own fields
   * apart - Confirm and Confirmed one shape in one place, and Confirm all counting what is left.
   */
  function columnsPanel() {
    // Every column with a type and not yet confirmed: what Confirm all confirms at once.
    const left = draft.columns.filter((each) => !each.confirmed && each.type.base !== '').length;
    return (
      <div className={`${styles['card']} ${styles['fileCard']}`}>
        <Section
          heading="Columns"
          count={draft.columns.length}
          aside={
            <span className={styles['statusChip']}>
              <Status lines={described} />
            </span>
          }
          hint={
            draft.mode === 'file'
              ? words('data.sample-for-columns-reads-the')
              : draft.mode === 'http' || draft.mode === 'extension'
                ? words('data.sample-for-columns-sends-the')
                : words('data.describe-asks-the-source-what')
          }
          acts={
            <>
              {draft.columns.length > 0 && (
                <button
                  type="button"
                  className={styles['confirmAll']}
                  aria-disabled={left === 0}
                  onClick={() =>
                    left > 0 &&
                    change({
                      columns: draft.columns.map((each) =>
                        each.type.base === '' ? each : { ...each, confirmed: true },
                      ),
                    })
                  }
                >
                  <Icon name="Confirmed" />
                  {words('data.confirm-all')}
                  {left > 0 && (
                    <>
                      {' '}
                      <Chip>{left}</Chip>
                    </>
                  )}
                </button>
              )}
              {mayRun && (
                <button type="button" disabled={busy !== null} onClick={describe}>
                  {draft.mode === 'http' || draft.mode === 'file' || draft.mode === 'extension'
                    ? words('data.sample-for-columns')
                    : words('data.describe')}
                </button>
              )}
            </>
          }
        >
          {draft.columns.length > 0 && (
            <RowTable
              label={words('data.columns-2')}
              bins={false}
              columns={[
                { head: words('data.name'), width: 240 },
                { head: words('data.at-the-source'), width: 200 },
                { head: words('data.type'), width: 220 },
                { head: words('data.of-the-type') },
                { head: words('data.confirmed'), width: 136 },
              ]}
              rows={draft.columns.map((column, at) => {
                const typed = (type: TypeDraft) =>
                  setColumn(at, { ...column, type, confirmed: false });
                return {
                  key: column.name,
                  held: !column.confirmed,
                  cells: [
                    <span key="name" className={styles['mono']}>
                      {column.name}
                    </span>,
                    <span key="source" className={styles['source']}>
                      {column.sourceType ?? words('data.not-described')}
                    </span>,
                    <TypeFields
                      key="type"
                      part="base"
                      name={column.name}
                      textColumns={textColumns}
                      type={column.type}
                      onChange={typed}
                    />,
                    column.type.base === '' ? (
                      <span key="own" className={styles['hint']}>
                        {words('data.declare-a-type-for-this')}
                      </span>
                    ) : (
                      <TypeFields
                        key="own"
                        part="own"
                        name={column.name}
                        textColumns={textColumns}
                        type={column.type}
                        onChange={typed}
                      />
                    ),
                    column.confirmed ? (
                      <span key="confirmed" className={styles['confirmed']}>
                        <Icon name="Confirmed" />
                        {words('data.confirmed')}
                      </span>
                    ) : (
                      <button
                        key="confirmed"
                        type="button"
                        className={styles['confirm']}
                        aria-label={words('data.confirm', { name: column.name })}
                        disabled={column.type.base === ''}
                        onClick={() => setColumn(at, { ...column, confirmed: true })}
                      >
                        {words('data.confirm-2')}
                      </button>
                    ),
                  ],
                };
              })}
            />
          )}
        </Section>
      </div>
    );
  }

  /** Rows (the details handoff, query-rows-*): its key, its order, and what it may return. */
  function rowsPanel() {
    const declared = draft.order === 'multiset' ? null : draft.order;
    const setOrder = (
      order: readonly { column: string; direction: 'ascending' | 'descending' }[],
    ) => change({ order: [...order] });
    return (
      <div className={styles['rows']}>
        <section className={styles['card']} aria-labelledby={`${ids}-key`}>
          <div className={styles['cardHead']}>
            <h2 id={`${ids}-key`}>{words('data.key')}</h2>
          </div>
          <fieldset className={styles['plain']} aria-labelledby={`${ids}-key`}>
            {columnNames.length === 0 && <p>{words('data.describe-the-statement-to-choose')}</p>}
            {columnNames.map((name) => (
              <label key={name} className={`${styles['check']} ${styles['mono']}`}>
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
        </section>

        <section className={styles['card']} aria-labelledby={`${ids}-order`}>
          <div className={styles['cardHead']}>
            <h2 id={`${ids}-order`}>{words('data.order')}</h2>
          </div>
          <fieldset className={styles['plain']} aria-labelledby={`${ids}-order`}>
            <label className={styles['check']}>
              <input
                type="radio"
                name="order"
                checked={draft.order === 'multiset'}
                onChange={() => change({ order: 'multiset' })}
              />
              {words('data.check-the-rows-as-a')}
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
              {draft.mode === 'builder' || draft.mode === 'dataset' || draft.mode === 'file'
                ? words('data.return-the-rows-in-a')
                : words('data.check-the-rows-are-in')}
            </label>
          </fieldset>
          {declared !== null && (
            <>
              {declared.length > 0 && (
                <table className={styles['order']}>
                  <caption className={styles['hidden']}>{words('data.the-order')}</caption>
                  <colgroup>
                    <col className={styles['index']} />
                    <col />
                    <col className={styles['direction']} />
                    <col className={styles['remove']} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">{words('data.column')}</th>
                      <th scope="col">{words('data.direction')}</th>
                      <th scope="col">
                        <span className={styles['hidden']}>{words('data.remove-2')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {declared.map((each, at) => (
                      <tr key={at}>
                        <td className={styles['index']}>{at + 1}</td>
                        <td>
                          <label className={styles['hidden']} htmlFor={`${ids}-order-${at}`}>
                            {words('data.order-column', { value1: at + 1 })}
                          </label>
                          <select
                            id={`${ids}-order-${at}`}
                            value={each.column}
                            onChange={(event) =>
                              setOrder(
                                declared.map((held, place) =>
                                  place === at ? { ...held, column: event.target.value } : held,
                                ),
                              )
                            }
                          >
                            {columnNames.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <label className={styles['hidden']} htmlFor={`${ids}-direction-${at}`}>
                            {words('data.direction-2', { value1: at + 1 })}
                          </label>
                          <select
                            id={`${ids}-direction-${at}`}
                            value={each.direction}
                            onChange={(event) =>
                              setOrder(
                                declared.map((held, place) =>
                                  place === at
                                    ? {
                                        ...held,
                                        direction: event.target.value as typeof each.direction,
                                      }
                                    : held,
                                ),
                              )
                            }
                          >
                            <option value="ascending">{words('data.ascending')}</option>
                            <option value="descending">{words('data.descending')}</option>
                          </select>
                        </td>
                        <td>
                          <IconButton
                            label={words('data.remove-order-column', { value1: at + 1 })}
                            tooltip="Remove"
                            className={styles['bin']}
                            onClick={() => setOrder(declared.filter((_, place) => place !== at))}
                          >
                            <Icon name="Delete" />
                          </IconButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {columnNames.length > 0 && (
                <button
                  type="button"
                  className={styles['add']}
                  onClick={() =>
                    setOrder([...declared, { column: columnNames[0]!, direction: 'ascending' }])
                  }
                >
                  {words('data.add-a-column-to-the')}
                </button>
              )}
              <p className={styles['hint']}>
                {draft.mode === 'builder' || draft.mode === 'dataset' || draft.mode === 'file'
                  ? words('data.the-order-covers-the-whole')
                  : words('data.the-order-covers-the-whole-2')}
              </p>
              {(draft.mode === 'builder' || draft.mode === 'dataset') && (
                <label className={styles['field']}>
                  {words('data.return-at-most')}
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
          {(draft.mode === 'builder' || draft.mode === 'dataset') && declared === null && (
            <p className={styles['hint']}>{words('data.return-at-most-is-offered')}</p>
          )}
        </section>

        <section className={styles['card']} aria-labelledby={`${ids}-limits`}>
          <div className={styles['cardHead']}>
            <h2 id={`${ids}-limits`}>{words('data.empty-and-limits')}</h2>
          </div>
          <label className={styles['check']}>
            <input
              type="checkbox"
              checked={draft.empty === 'valid'}
              onChange={(event) => change({ empty: event.target.checked ? 'valid' : 'invalid' })}
            />
            {words('data.no-rows-is-a-valid')}
          </label>
          <fieldset className={styles['maximum']}>
            <legend>{words('data.maximum')}</legend>
            {(
              [
                ['rows', words('data.rows')],
                ['bytes', words('data.bytes-2')],
                ['seconds', words('data.seconds')],
              ] as const
            ).map(([limit, label]) => (
              <label key={limit}>
                <input
                  inputMode="numeric"
                  value={draft.limits[limit]}
                  onChange={(event) =>
                    change({ limits: { ...draft.limits, [limit]: event.target.value } })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <p className={styles['hint']}>{words('data.the-environment-may-lower-each')}</p>
        </section>
      </div>
    );
  }

  /** Sample (the details handoff, query-sample-*): its values, then the first rows and what ran. */
  function samplePanel() {
    const ok =
      sampled !== null && !Array.isArray(sampled) && sampled.outcome === 'ok' ? sampled : null;
    const lines =
      sampled === null
        ? null
        : Array.isArray(sampled)
          ? sampled
          : sampled.outcome === 'failed'
            ? [sampled.failure.message]
            : null;
    return (
      <div className={styles['sample']}>
        <section className={styles['card']} aria-label={words('data.sample-values')}>
          <div className={styles['values']}>
            {draft.parameters.map((parameter, at) => (
              <ValueField
                key={at}
                parameter={parameter}
                value={typed[parameter.name] ?? ''}
                onChange={(value) => setTyped((held) => ({ ...held, [parameter.name]: value }))}
              />
            ))}
            <button type="button" className="primary" disabled={busy !== null} onClick={sample}>
              {words('data.run-sample')}
            </button>
            <p className={styles['hint']}>{words('data.a-sample-runs-the-definition')}</p>
          </div>
          <Status lines={lines} />
          {/* Said once a sample has run, for a reader who cannot see the rows arrive. */}
          <p role="status" className={styles['hidden']}>
            {ok === null ? '' : `${ok.rowCount} ${words('data.rows-3', { count: ok.rowCount })}.`}
          </p>
        </section>
        {ok !== null && (
          <div className={styles['ran']}>
            <section className={styles['card']} aria-labelledby={`${ids}-first`}>
              <div className={styles['cardHead']}>
                <h2 id={`${ids}-first`}>{words('data.the-first-rows')}</h2>
                <Chip tone="ok">{`${ok.rowCount} ${words('data.rows-3', { count: ok.rowCount })}`}</Chip>
                <Tooltip tip={ok.checksum}>
                  <Icon name="Checksum" />
                  {words('data.checksum')}
                </Tooltip>
              </div>
              <table className={styles['first']}>
                <caption className={styles['hidden']}>{words('data.the-first-rows')}</caption>
                <thead>
                  <tr>
                    {ok.columns.map(([name, base]) => (
                      <th key={name} scope="col" data-number={NUMBERS.has(base) || undefined}>
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ok.rows.map((row, at) => (
                    <tr key={at}>
                      {row.map((value, place) => (
                        <td
                          key={place}
                          data-number={NUMBERS.has(ok.columns[place]?.[1] ?? '') || undefined}
                        >
                          {cellWords(value, ok.columns[place]?.[1], ok.images)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className={styles['card']} aria-labelledby={`${ids}-ran`}>
              <div className={styles['cardHead']}>
                <h2 id={`${ids}-ran`}>
                  {'sql' in ok.ran
                    ? words('data.the-sql-that-ran')
                    : 'dataset' in ok.ran
                      ? words('data.the-stored-result-that-was')
                      : 'object' in ok.ran
                        ? words('data.the-object-that-was-read')
                        : words('data.the-request-that-was-sent')}
                </h2>
              </div>
              <pre className={styles['sql']}>
                {'sql' in ok.ran
                  ? ok.ran.sql
                  : 'dataset' in ok.ran
                    ? words('data.version-4', {
                        value1: storedName ?? 'A stored result',
                        version: ok.ran.dataset.version,
                      })
                    : 'object' in ok.ran
                      ? `${ok.ran.object.bucket}/${ok.ran.object.key}`
                      : requestText(ok.ran.request as never)}
              </pre>
              {'sql' in ok.ran && draft.parameters.length > 0 && (
                <p className={styles['hint']}>{words('data.each-value-was-sent-apart')}</p>
              )}
            </section>
          </div>
        )}
      </div>
    );
  }

  function usedByPanel() {
    if (uses === null) return null;
    if (uses === 'failed') return <p>{words('data.what-uses-this-query-definition')}</p>;
    const none =
      uses.components.readable.length === 0 &&
      uses.components.others === 0 &&
      uses.documents.readable.length === 0 &&
      uses.documents.others === 0;
    return (
      <div className={styles['usedBy']}>
        {none ? (
          <p>{words('data.no-component-binds-this-query')}</p>
        ) : (
          <div className={styles['lists']}>
            <PagedUses
              heading="Components"
              uses={uses.components}
              link={(component) => `#/components/${component}`}
              counted={(others) =>
                words('data.bound-by-you-may-not', {
                  others,
                  value2: others === 1 ? 'component' : 'components',
                })
              }
            />
            <PagedUses
              heading="Documents"
              uses={uses.documents}
              link={documentLink}
              counted={(others) =>
                words('data.held-by-you-may-not', {
                  others,
                  value2: others === 1 ? 'document' : 'documents',
                })
              }
            />
          </div>
        )}
        <p className={styles['hint']}>{words('data.a-binding-that-does-not')}</p>
      </div>
    );
  }
}
