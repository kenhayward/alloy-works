import type { createApiClient } from '@alloy-works/api-client';
import {
  checkParameterValues,
  literalValues,
  questionUnchanged,
  type Binding,
  type CanonicalValue,
  type Column,
  type Parameter,
  type ParameterRule,
  type ParameterValues,
} from '@alloy-works/domain';
import type { BindingChoice } from '@alloy-works/editor';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import shell from '../layouts/Modal.module.css';
import { Icon } from './Icon.js';
import styles from './MarkPrompt.module.css';
import own from './ReferenceDialog.module.css';

type Client = ReturnType<typeof createApiClient>;
type Identity = 'service' | 'endUser';

/** Whose identity a definition's query runs as, in words (DAT-022; bindings.md, "Placing"). */
export const RUNS_AS = {
  service: 'the service account',
  endUser: "each reader's own view, as the source sees them",
} as const satisfies Record<Identity, string>;

/** What a value refused by its parameter broke, beside its field (D2-R). */
export const PARAMETER_WORDS = {
  required: 'needs a value',
  type: 'is not of its type',
  permitted: 'is not one of its permitted values',
  range: 'is outside its range',
  list: 'is not a list as its parameter declares',
  precision: 'has more digits than its type holds',
  scale: 'has more places than its type holds',
  zone: 'needs its time zone',
  variation: 'is not one of its keys',
} as const satisfies Record<ParameterRule, string>;

const MODES = {
  checked: 'Checked - looked for each time the document is opened',
  pinned: 'Pinned - never looked for',
} as const satisfies Record<Binding['mode'], string>;

/** One definition as the listing offers it. */
interface Listed {
  readonly id: string;
  readonly title: string;
  readonly space: string;
  readonly identity: Identity | null;
}

/** The definition chosen, at its latest version, as `GET /v1/query-definitions/{id}` answers it. */
interface Chosen {
  readonly id: string;
  readonly version: { readonly id: string; readonly number: string };
  readonly parameters: readonly Parameter[];
  readonly columns: readonly Column[];
  readonly key: readonly string[];
  readonly identity: Identity | null;
  readonly mayUse: boolean;
}

/** The documents holding a value for the binding being changed. */
interface Holders {
  readonly readable: readonly { readonly id: string; readonly title: string }[];
  readonly others: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const identityOf = (connection: unknown): Identity | null =>
  isRecord(connection) && (connection.identity === 'service' || connection.identity === 'endUser')
    ? connection.identity
    : null;

/** A typed value in its type's canonical form: `true` and `false` for a boolean, the text otherwise. */
const canonical = (base: string, text: string): CanonicalValue =>
  base === 'boolean' && (text === 'true' || text === 'false') ? text === 'true' : text;

/** The values typed, by the version's parameters: a list one to a line, an empty field none. */
function valuesOf(
  parameters: readonly Parameter[],
  typed: Readonly<Record<string, string>>,
): Record<string, CanonicalValue | CanonicalValue[]> {
  const values: Record<string, CanonicalValue | CanonicalValue[]> = {};
  for (const parameter of parameters) {
    const text = typed[parameter.name] ?? '';
    if (text.trim() === '') continue;
    values[parameter.name] = parameter.list
      ? text
          .split('\n')
          .map((each) => each.trim())
          .filter((each) => each !== '')
          .map((each) => canonical(parameter.type.base, each))
      : canonical(parameter.type.base, parameter.type.base === 'text' ? text : text.trim());
  }
  return values;
}

/** A binding's literal values as fields hold them. */
function typedOf(binding: Binding | null): Record<string, string> {
  const typed: Record<string, string> = {};
  if (binding === null) return typed;
  for (const [name, parameter] of Object.entries(binding.parameters)) {
    if (!('literal' in parameter) || parameter.literal === null) continue;
    typed[name] = Array.isArray(parameter.literal)
      ? parameter.literal.map(String).join('\n')
      : String(parameter.literal);
  }
  return typed;
}

/** `Site report, Annual review and 2 more`: readable titles, the rest counted. */
function holdersSaid({ readable, others }: Holders): string {
  const names = [...readable.map((each) => each.title)];
  if (others > 0) names.push(`${others} you cannot read`);
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Where an image column's value is placed (B6-H): in the line, or as a figure's image. */
export type PlaceAs = 'line' | 'figure';

/** The words each place is offered by. */
export const PLACE_AS = {
  line: 'In the line',
  figure: 'As a figure',
} as const satisfies Record<PlaceAs, string>;

export interface ValueDialogProps {
  readonly client: Client;
  /** The component the binding stands in, for its holders. */
  readonly componentId: string;
  /** The binding selected whole, which it opens on and changes; null where it places a new one. */
  readonly current: Binding | null;
  /** Where it is placed: in a document, whether the node is pinned; null on the component's own. */
  readonly inDocument: { readonly pinned: boolean } | null;
  /**
   * Where an image column's value may stand (the B6 plan, B6-H): `offer` asks _In the line_ or _As a
   * figure_, where a figure may go; `figure` changes a figure's binding, and so offers image columns
   * alone; `line`, the default, places it in the line.
   */
  readonly place?: 'line' | 'offer' | 'figure';
  /**
   * The binding chosen, and where an image column's is placed; answers why it could not be placed,
   * which the dialog says, or null.
   */
  readonly onDone: (choice: BindingChoice, placeAs: PlaceAs) => string | null;
  readonly onCancel: () => void;
}

/**
 * **The Value dialog** (the B2 plan, task 4; bindings.md, "Placing and changing one"), on the
 * Reference dialog's model: a query definition, searched by title, each with its space and whose
 * identity it runs as (DAT-022); the version; its parameters, checked as typed by D2's own rule; the
 * value it takes; and its mode. Opened on a binding selected whole it changes it, keeping its
 * identifier, and says first which documents will hold no value until resolved again, unless only
 * what it takes or its mode changed (BI-J). Nothing is placed on Cancel, Close or Escape. An image
 * column is offered as any other, and on one it asks **Place as**: _In the line_ or, where a figure
 * may go, _As a figure_ (the B6 plan, B6-H).
 */
export function ValueDialog({
  client,
  componentId,
  current,
  inDocument,
  place = 'line',
  onDone,
  onCancel,
}: ValueDialogProps) {
  const id = useId();
  const dialog = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = useState('');
  const [listed, setListed] = useState<readonly Listed[] | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(current?.query ?? null);
  const [chosen, setChosen] = useState<Chosen | 'unreadable' | null>(null);
  const [pin, setPin] = useState<string>(current?.version ?? 'latest');
  // Another definition is chosen at its latest: a pin is a version of the definition it binds only.
  const choose = (definition: string) => {
    setChosenId(definition);
    setPin(definition === current?.query ? (current.version ?? 'latest') : 'latest');
  };
  // The definition it binds, as read by its identifier, for one beyond the listing's first page.
  const [currentRead, setCurrentRead] = useState<Listed | 'unreadable' | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>(() => typedOf(current));
  const [column, setColumn] = useState(current?.take.column ?? '');
  const [row, setRow] = useState<'only' | 'key'>(
    current !== null && 'key' in current.take ? 'key' : 'only',
  );
  const [keyTyped, setKeyTyped] = useState<Record<string, string>>(() =>
    current !== null && 'key' in current.take
      ? Object.fromEntries(Object.entries(current.take.key).map(([k, v]) => [k, String(v)]))
      : {},
  );
  const [mode, setMode] = useState<Binding['mode']>(current?.mode ?? 'checked');
  const [placeAs, setPlaceAs] = useState<PlaceAs>(place === 'figure' ? 'figure' : 'line');
  const [holders, setHolders] = useState<Holders | null>(null);
  const [tried, setTried] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => search.current?.focus(), []);

  useEffect(() => {
    let live = true;
    void client
      .GET('/v1/query-definitions', { params: { query: { limit: '100' } } })
      .then(({ data }) => {
        if (!live) return;
        const items: unknown[] = isRecord(data) && Array.isArray(data.items) ? data.items : [];
        setListed(
          items.flatMap((each): Listed[] =>
            isRecord(each) &&
            typeof each.id === 'string' &&
            typeof each.title === 'string' &&
            each.retired !== true
              ? [
                  {
                    id: each.id,
                    title: each.title,
                    space: isRecord(each.space) ? String(each.space.name) : '',
                    identity: identityOf(each.connection),
                  },
                ]
              : [],
          ),
        );
      })
      .catch(() => live && setListed([]));
    return () => {
      live = false;
    };
  }, [client]);

  useEffect(() => {
    if (chosenId === null) return undefined;
    let live = true;
    setChosen(null);
    void client
      .GET('/v1/query-definitions/{id}', { params: { path: { id: chosenId } } })
      .then(({ data }) => {
        if (!live) return;
        const definition = isRecord(data) && isRecord(data.definition) ? data.definition : null;
        if (definition === null || !isRecord(data) || !isRecord(data.version)) {
          setChosen('unreadable');
          if (chosenId === current?.query) setCurrentRead('unreadable');
          return;
        }
        if (chosenId === current?.query) {
          setCurrentRead({
            id: chosenId,
            title: String(definition.title),
            space: isRecord(data.space) ? String(data.space.name) : '',
            identity: identityOf(data.connection),
          });
        }
        const declared = (definition.columns ?? []) as Column[];
        // A figure's binding takes an image, so it is offered image columns alone (B6-H).
        const columns =
          place === 'figure' ? declared.filter((each) => each.type.base === 'image') : declared;
        setChosen({
          id: chosenId,
          version: { id: String(data.version.id), number: String(data.version.number) },
          parameters: (definition.parameters ?? []) as Parameter[],
          columns,
          key: (definition.key ?? []) as string[],
          identity: identityOf(data.connection),
          mayUse: data.mayUse === true,
        });
        setColumn((now) =>
          columns.some((each) => each.name === now) ? now : (columns[0]?.name ?? ''),
        );
      })
      .catch(() => {
        if (!live) return;
        setChosen('unreadable');
        if (chosenId === current?.query) setCurrentRead('unreadable');
      });
    return () => {
      live = false;
    };
  }, [client, chosenId, current?.query, place]);

  useEffect(() => {
    if (current === null) return undefined;
    let live = true;
    void client
      .GET('/v1/components/{id}/bindings/{binding}/holders', {
        params: { path: { id: componentId, binding: current.id } },
      })
      .then(({ data }) => {
        const documents = isRecord(data) && isRecord(data.documents) ? data.documents : null;
        if (!live || documents === null || !Array.isArray(documents.readable)) return;
        setHolders({
          readable: (documents.readable as unknown[]).flatMap((each) =>
            isRecord(each) && typeof each.id === 'string' && typeof each.title === 'string'
              ? [{ id: each.id, title: each.title }]
              : [],
          ),
          others: typeof documents.others === 'number' ? documents.others : 0,
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, componentId, current]);

  const ready = chosen !== null && chosen !== 'unreadable' ? chosen : null;
  const values: ParameterValues = useMemo(
    () => (ready === null ? {} : valuesOf(ready.parameters, typed)),
    [ready, typed],
  );
  const problems = ready === null ? [] : checkParameterValues(ready.parameters, values);
  const problemOf = (name: string) =>
    problems.find((each) => each.parameter === name && (tried || each.rule !== 'required'));

  const imageColumn = ready?.columns.find((each) => each.name === column)?.type.base === 'image';
  const placedAs: PlaceAs =
    place === 'figure' || (place === 'offer' && imageColumn && placeAs === 'figure')
      ? 'figure'
      : 'line';
  const choice: BindingChoice | null =
    ready === null || column === ''
      ? null
      : {
          query: ready.id,
          ...(pin === 'latest' ? {} : { version: pin }),
          parameters: Object.fromEntries(
            Object.entries(values).map(([name, value]) => [
              name,
              { literal: value as CanonicalValue },
            ]),
          ),
          mode,
          take:
            row === 'key' && ready.key.length > 0
              ? {
                  key: Object.fromEntries(
                    ready.key.map((name) => [
                      name,
                      canonical(
                        ready.columns.find((each) => each.name === name)?.type.base ?? 'text',
                        keyTyped[name] ?? '',
                      ) as string | boolean,
                    ]),
                  ),
                  column,
                }
              : { column },
        };

  // Only the value taken or the mode changed: every document keeps its value by Keep (BI-J).
  const sameQuestion = (() => {
    if (current === null || choice === null || ready === null) return false;
    const held = literalValues(current);
    if (!('values' in held)) return false;
    return questionUnchanged(
      { type: 'binding', id: current.id, ...choice },
      {
        queryDefinition: { artifact: current.query, version: current.version ?? ready.version.id },
        parameters: held.values,
      },
      ready.version.id,
    );
  })();
  const holding = holders === null ? 0 : holders.readable.length + holders.others;
  const warning =
    current !== null && holders !== null && holding > 0 && !sameQuestion
      ? `${holding === 1 ? 'One document' : `${holding} documents`} will hold no value for it until resolved again: ${holdersSaid(holders)}.`
      : null;
  const note =
    inDocument === null
      ? 'The value will show in each document that resolves it.'
      : inDocument.pinned
        ? 'It shows in this document once the node takes a version holding it.'
        : ready !== null && !ready.mayUse
          ? "You may not use this definition's connection: it holds no value here until somebody who may use it resolves it."
          : null;

  const shown = (listed ?? []).filter((each) =>
    each.title.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  // The definition it binds, where the listing's first page does not hold it: by its title where it
  // reads, and as one it cannot read only once it is known not to.
  const outsideCurrent =
    current !== null && listed !== null && !listed.some((each) => each.id === current.query)
      ? currentRead
      : null;
  const unreadableCurrent = outsideCurrent === 'unreadable';
  const shownWithCurrent =
    outsideCurrent !== null && outsideCurrent !== 'unreadable' ? [outsideCurrent, ...shown] : shown;

  // Tab moves as the browser moves it, through the radio groups as it takes them, and is turned
  // back only at either end of the dialog, or from outside it.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'input:not([type="radio"]):not(:disabled), select, textarea, button',
      ) ?? []),
    ];
    if (stops.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const inside = active !== null && dialog.current?.contains(active) === true;
    const end = event.shiftKey ? stops[0] : stops.at(-1);
    if (inside && active !== end) return;
    event.preventDefault();
    stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
  };

  const radio = (name: string, value: string, checked: boolean, onChange: () => void) => (
    <input
      type="radio"
      name={`${id}-${name}`}
      value={value}
      checked={checked}
      onChange={onChange}
    />
  );

  return (
    <div className={shell['scrim']}>
      <div
        ref={dialog}
        className={shell['dialog']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        onKeyDown={onKeyDown}
      >
        <form
          className={styles['form']}
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (choice === null) return;
            if (problems.length > 0) {
              setSaid('A value does not fit its parameter.');
              return;
            }
            setSaid(onDone(choice, placedAs));
          }}
        >
          <h2 id={`${id}-heading`} className={styles['heading']}>
            <span className={styles['tile']} aria-hidden="true">
              <Icon name="Value" size={22} />
            </span>
            Value
          </h2>
          <div className={styles['field']}>
            <label htmlFor={`${id}-search`}>Find a query definition by title</label>
            <input
              id={`${id}-search`}
              ref={search}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <fieldset className={own['group']}>
            <legend>Query definition</legend>
            <div className={own['targets']}>
              {listed === null && <p className={styles['note']}>Finding query definitions.</p>}
              {listed !== null && shownWithCurrent.length === 0 && !unreadableCurrent && (
                <p className={styles['note']}>No query definition you may read has that title.</p>
              )}
              {unreadableCurrent && current !== null && (
                <label className={own['choice']}>
                  {radio('definition', current.query, chosenId === current.query, () =>
                    choose(current.query),
                  )}
                  a query definition you cannot read
                </label>
              )}
              {shownWithCurrent.map((each) => (
                <label key={each.id} className={own['choice']}>
                  {radio('definition', each.id, chosenId === each.id, () => choose(each.id))}
                  {each.title}
                  <span className={styles['hint']}>
                    {' '}
                    - {each.space}
                    {each.identity !== null && ` - Runs as ${RUNS_AS[each.identity]}`}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {chosen === 'unreadable' && (
            <p className={styles['note']}>
              You may not read this query definition: keep the binding as it is, or choose another.
            </p>
          )}
          {ready !== null && (
            <>
              {ready.identity !== null && (
                <p className={styles['note']}>Runs as {RUNS_AS[ready.identity]}.</p>
              )}
              <fieldset className={own['group']}>
                <legend>Version</legend>
                <div className={own['forms']}>
                  <label className={own['choice']}>
                    {radio('version', 'latest', pin === 'latest', () => setPin('latest'))}
                    Always the latest
                  </label>
                  <label className={own['choice']}>
                    {radio('version', ready.version.id, pin === ready.version.id, () =>
                      setPin(ready.version.id),
                    )}
                    Version {ready.version.number}, the latest now
                  </label>
                  {pin !== 'latest' && pin !== ready.version.id && (
                    <label className={own['choice']}>
                      {radio('version', pin, true, () => undefined)}
                      The version it pins now
                    </label>
                  )}
                </div>
              </fieldset>
              {ready.parameters.length > 0 && (
                <fieldset className={own['group']}>
                  <legend>Parameters</legend>
                  {ready.parameters.map((parameter) => {
                    const problem = problemOf(parameter.name);
                    const field = `${id}-parameter-${parameter.name}`;
                    return (
                      <div key={parameter.name} className={styles['field']}>
                        <label htmlFor={field}>
                          {parameter.name}
                          {parameter.list ? ', one to a line' : ''}
                        </label>
                        {parameter.list ? (
                          <textarea
                            id={field}
                            rows={3}
                            value={typed[parameter.name] ?? ''}
                            aria-invalid={problem !== undefined}
                            aria-describedby={problem ? `${field}-problem` : undefined}
                            onChange={(event) =>
                              setTyped({ ...typed, [parameter.name]: event.target.value })
                            }
                          />
                        ) : (
                          <input
                            id={field}
                            value={typed[parameter.name] ?? ''}
                            aria-invalid={problem !== undefined}
                            aria-describedby={problem ? `${field}-problem` : undefined}
                            onChange={(event) =>
                              setTyped({ ...typed, [parameter.name]: event.target.value })
                            }
                          />
                        )}
                        {problem !== undefined && (
                          <p id={`${field}-problem`} className={styles['complaint']}>
                            {parameter.name} {PARAMETER_WORDS[problem.rule]}.
                          </p>
                        )}
                        <label className={own['choice']}>
                          <input type="checkbox" disabled />
                          From the document - unavailable until documents have parameters
                        </label>
                      </div>
                    );
                  })}
                </fieldset>
              )}
              <fieldset className={own['group']}>
                <legend>Value</legend>
                <div className={styles['field']}>
                  <label htmlFor={`${id}-column`}>Column</label>
                  <select
                    id={`${id}-column`}
                    value={column}
                    onChange={(event) => setColumn(event.target.value)}
                  >
                    {ready.columns.map((each) => (
                      <option key={each.name} value={each.name}>
                        {each.name}
                        {each.type.base === 'image' ? ', an image' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {place === 'figure' && ready.columns.length === 0 && (
                  <p className={styles['note']}>
                    This query definition has no image column, so it cannot give a figure its image.
                  </p>
                )}
                <div className={own['forms']}>
                  <label className={own['choice']}>
                    {radio('row', 'only', row === 'only' || ready.key.length === 0, () =>
                      setRow('only'),
                    )}
                    The only row
                  </label>
                  {ready.key.length > 0 && (
                    <label className={own['choice']}>
                      {radio('row', 'key', row === 'key', () => setRow('key'))}
                      The row whose key is
                    </label>
                  )}
                </div>
                {row === 'key' &&
                  ready.key.map((name) => (
                    <div key={name} className={styles['field']}>
                      <label htmlFor={`${id}-key-${name}`}>{name} is</label>
                      <input
                        id={`${id}-key-${name}`}
                        value={keyTyped[name] ?? ''}
                        onChange={(event) =>
                          setKeyTyped({ ...keyTyped, [name]: event.target.value })
                        }
                      />
                    </div>
                  ))}
              </fieldset>
              {place === 'offer' && imageColumn && (
                <fieldset className={own['group']}>
                  <legend>Place as</legend>
                  <div className={own['forms']}>
                    {(['line', 'figure'] as const).map((each) => (
                      <label key={each} className={own['choice']}>
                        {radio('place', each, placeAs === each, () => setPlaceAs(each))}
                        {PLACE_AS[each]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <fieldset className={own['group']}>
                <legend>Mode</legend>
                <div className={own['forms']}>
                  {(['checked', 'pinned'] as const).map((each) => (
                    <label key={each} className={own['choice']}>
                      {radio('mode', each, mode === each, () => setMode(each))}
                      {MODES[each]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          {note !== null && <p className={styles['note']}>{note}</p>}
          {warning !== null && (
            <p id={`${id}-warning`} className={styles['warning']}>
              {warning}
            </p>
          )}
          {said !== null && (
            <p role="alert" className={styles['complaint']}>
              {said}
            </p>
          )}
          <div className={styles['footer']}>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            {choice !== null && (
              <button
                type="submit"
                className="primary"
                {...(warning === null ? {} : { 'aria-describedby': `${id}-warning` })}
              >
                {current === null ? 'Insert' : 'Change'}
              </button>
            )}
          </div>
        </form>
        <button
          type="button"
          className={shell['close']}
          aria-label="Close"
          title="Close"
          onClick={onCancel}
        >
          <Icon name="Close" size={13} />
        </button>
      </div>
    </div>
  );
}
