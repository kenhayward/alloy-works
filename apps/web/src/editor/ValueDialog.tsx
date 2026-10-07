import type { createApiClient } from '@alloy-works/api-client';
import {
  argumentRefusal,
  checkParameterValues,
  PARAMETER_NAME,
  questionSpelledAlike,
  type AnyBinding,
  type Binding,
  type CanonicalValue,
  type Column,
  type Parameter,
  type ParameterRule,
  type ParameterValues,
  type TemplateParameter,
} from '@alloy-works/domain';
import type { BindingChoice, TableChoice } from '@alloy-works/editor';
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
  position: 'cannot stand where the request places it',
} as const satisfies Record<ParameterRule, string>;

/**
 * What a document offers the dialog's **From the document** (the TP2 plan, TP2-F): its template's
 * declarations, as `GET /v1/documents/{id}/parameters` answers a reader of the template, or why there
 * are none - made from no template, a template the reader may not read, or not read.
 */
export type DocumentOffer =
  | { readonly declarations: readonly TemplateParameter[] }
  | { readonly none: 'blank' | 'unreadable' | 'unread' | 'reading' };

/** Why no document parameter is offered, before the dialog takes a typed name instead. */
const NONE_OFFERED = {
  alone: 'A component alone has no document to offer parameters.',
  blank: 'This document holds no parameters to offer.',
  unreadable: "You may not read this document's template, so its parameters cannot be offered.",
  unread: "This document's parameters could not be read, so none can be offered.",
  reading: "Reading this document's parameters.",
  unfit: "None of this document's parameters is given to values of this type, so none is offered.",
} as const;

const TYPE_A_NAME = 'Type the name of the one this value takes.';

/** A document parameter's name typed that no parameter could have (D2's pattern). */
const NOT_A_NAME =
  'takes a name of lower-case letters, digits and underscores, beginning with a letter';

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

/** A binding's arguments taken from the document, by the definition's parameter names. */
function fromDocumentOf(binding: AnyBinding | null): Record<string, string> {
  const named: Record<string, string> = {};
  if (binding === null) return named;
  for (const [name, parameter] of Object.entries(binding.parameters)) {
    if ('document' in parameter) named[name] = parameter.document;
  }
  return named;
}

/** A binding's literal values as fields hold them. */
function typedOf(binding: AnyBinding | null): Record<string, string> {
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

/**
 * Where a binding is placed: its value in the line, an image column's as a figure's image (B6-H), or
 * the whole result as a table (the TB2 plan, TB2-E).
 */
export type PlaceAs = 'line' | 'figure' | 'table';

/** The words each place is offered by. */
export const PLACE_AS = {
  line: 'In the line',
  figure: 'As a figure',
  table: 'As a table',
} as const satisfies Record<PlaceAs, string>;

const NOTHING_READ: DocumentOffer = { none: 'unread' };

export interface ValueDialogProps {
  readonly client: Client;
  /** The component the binding stands in, for its holders. */
  readonly componentId: string;
  /**
   * The binding it opens on and changes - one selected whole, a bound figure's, or a bound table's,
   * which takes nothing - or null where it places a new one.
   */
  readonly current: AnyBinding | null;
  /** Where it is placed: in a document, whether the node is pinned; null on the component's own. */
  readonly inDocument: { readonly pinned: boolean } | null;
  /**
   * What the document offers **From the document** (TP2-F), from the page; absent, nothing read. In a
   * component alone a name is typed whatever it says.
   */
  readonly documentParameters?: DocumentOffer;
  /**
   * Where the value may stand: `offer`, where a block may go, asks **Place as** - _In the line_, _As a
   * figure_ for an image column (the B6 plan, B6-H), or _As a table_ (the TB2 plan, TB2-E); `figure`
   * changes a figure's binding, and so offers image columns alone; `table` changes a bound table's,
   * and so asks for no column; `line`, the default, places it in the line.
   */
  readonly place?: 'line' | 'offer' | 'figure' | 'table';
  /**
   * The binding chosen and where it is placed - as a table with no take, given the version's declared
   * columns - answering why it could not be placed, which the dialog says, or null.
   */
  readonly onDone: (
    ...chosen:
      | [choice: BindingChoice, placeAs: 'line' | 'figure']
      | [choice: TableChoice, placeAs: 'table', columns: readonly Column[]]
  ) => string | null;
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
  documentParameters = NOTHING_READ,
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
  // Each parameter taken from the document, by the definition's name: the document's name for it.
  const [named, setNamed] = useState<Record<string, string>>(() => fromDocumentOf(current));
  const take: Binding['take'] | null =
    current !== null && 'take' in current ? (current as Binding).take : null;
  const [column, setColumn] = useState(take?.column ?? '');
  const [row, setRow] = useState<'only' | 'key'>(take !== null && 'key' in take ? 'key' : 'only');
  const [keyTyped, setKeyTyped] = useState<Record<string, string>>(() =>
    take !== null && 'key' in take
      ? Object.fromEntries(
          Object.entries((take as Extract<Binding['take'], { key: unknown }>).key).map(([k, v]) => [
            k,
            String(v),
          ]),
        )
      : {},
  );
  const [mode, setMode] = useState<Binding['mode']>(current?.mode ?? 'checked');
  const [placeAs, setPlaceAs] = useState<PlaceAs>(
    place === 'figure' ? 'figure' : place === 'table' ? 'table' : 'line',
  );
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
        // Only the chosen version's parameters are taken from the document (the TP2 final review).
        const asks = new Set(
          ((definition.parameters ?? []) as Parameter[]).map((each) => each.name),
        );
        setNamed((now) => {
          const kept = Object.entries(now).filter(([name]) => asks.has(name));
          return kept.length === Object.keys(now).length ? now : Object.fromEntries(kept);
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
  // A parameter taken from the document has its value checked where the binding is resolved.
  const problems =
    ready === null
      ? []
      : checkParameterValues(
          ready.parameters.filter((each) => !Object.hasOwn(named, each.name)),
          values,
        );
  const problemOf = (name: string) =>
    problems.find((each) => each.parameter === name && (tried || each.rule !== 'required'));
  const unnamed = (ready?.parameters ?? [])
    .filter((each) => Object.hasOwn(named, each.name) && !PARAMETER_NAME.test(named[each.name]!))
    .map((each) => each.name);
  const unnamedShown = (parameter: string) =>
    unnamed.includes(parameter) && (tried || named[parameter] !== '');
  // The document's parameters a definition's parameter may take: those fed to values, of its type.
  const fitting = (parameter: Parameter): readonly string[] =>
    inDocument === null || !('declarations' in documentParameters)
      ? []
      : documentParameters.declarations
          .filter((each) => argumentRefusal(each, parameter) === null)
          .map((each) => each.name);
  const reading =
    inDocument !== null && 'none' in documentParameters && documentParameters.none === 'reading';
  // Once the declarations arrive, a parameter ticked while they were read takes the first offered.
  useEffect(() => {
    if (ready === null || inDocument === null || !('declarations' in documentParameters)) return;
    const { declarations } = documentParameters;
    setNamed((now) => {
      let moved = false;
      const next = { ...now };
      for (const parameter of ready.parameters) {
        if (next[parameter.name] !== '') continue;
        const first = declarations.find((each) => argumentRefusal(each, parameter) === null);
        if (first === undefined) continue;
        next[parameter.name] = first.name;
        moved = true;
      }
      return moved ? next : now;
    });
  }, [ready, inDocument, documentParameters]);
  const noneOffered =
    inDocument === null
      ? NONE_OFFERED.alone
      : 'none' in documentParameters
        ? NONE_OFFERED[documentParameters.none]
        : NONE_OFFERED.unfit;

  const imageColumn = ready?.columns.find((each) => each.name === column)?.type.base === 'image';
  const placedAs: PlaceAs =
    place === 'figure' || (place === 'offer' && imageColumn && placeAs === 'figure')
      ? 'figure'
      : place === 'table' || (place === 'offer' && placeAs === 'table')
        ? 'table'
        : 'line';
  // A table takes the whole result: no column and no row (TB2-E).
  const asTable = placedAs === 'table';
  const tableChoice: TableChoice | null =
    ready === null
      ? null
      : {
          query: ready.id,
          ...(pin === 'latest' ? {} : { version: pin }),
          parameters: Object.fromEntries(
            ready.parameters.flatMap(({ name }): [string, TableChoice['parameters'][string]][] =>
              Object.hasOwn(named, name)
                ? [[name, { document: named[name]! }]]
                : Object.hasOwn(values, name)
                  ? [[name, { literal: values[name] as CanonicalValue }]]
                  : [],
            ),
          ),
          mode,
        };
  const choice: BindingChoice | null =
    tableChoice === null || ready === null || column === ''
      ? null
      : {
          ...tableChoice,
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

  // Only the value taken or the mode changed, its parameters spelled alike: every document keeps its
  // value by Keep (BI-J; TP2-D's dialog half).
  const sameQuestion = (() => {
    const chosenNow = asTable ? tableChoice : choice;
    if (current === null || chosenNow === null || ready === null) return false;
    return questionSpelledAlike(
      current,
      { type: 'binding', id: current.id, ...chosenNow } as AnyBinding,
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
            if (
              (problems.length > 0 || unnamed.length > 0) &&
              (asTable ? tableChoice : choice) !== null
            ) {
              setSaid('A value does not fit its parameter.');
              return;
            }
            if (asTable && tableChoice !== null) {
              setSaid(onDone(tableChoice, 'table', ready?.columns ?? []));
            } else if (!asTable && choice !== null) {
              setSaid(onDone(choice, placedAs === 'figure' ? 'figure' : 'line'));
            }
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
                    const fromDocument = Object.hasOwn(named, parameter.name);
                    const offered = fitting(parameter);
                    const held = named[parameter.name];
                    // A name the binding already holds is kept among those offered, fitting or not.
                    const choices =
                      held !== undefined && held !== '' && !offered.includes(held)
                        ? [held, ...offered]
                        : offered;
                    const choosing = fromDocument && offered.length > 0;
                    const complaint = unnamedShown(parameter.name);
                    return (
                      <div key={parameter.name} className={styles['field']}>
                        <label className={own['choice']}>
                          <input
                            type="checkbox"
                            checked={fromDocument}
                            onChange={(event) => {
                              const rest = { ...named };
                              delete rest[parameter.name];
                              setNamed(
                                event.target.checked
                                  ? { ...rest, [parameter.name]: offered[0] ?? '' }
                                  : rest,
                              );
                            }}
                          />
                          Take {parameter.name} from the document
                        </label>
                        {choosing && (
                          <>
                            <label htmlFor={`${field}-document`}>
                              Document parameter for {parameter.name}
                            </label>
                            <select
                              id={`${field}-document`}
                              value={held ?? ''}
                              onChange={(event) =>
                                setNamed({ ...named, [parameter.name]: event.target.value })
                              }
                            >
                              {choices.map((each) => (
                                <option key={each} value={each}>
                                  {each}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                        {fromDocument && !choosing && reading && (
                          <p className={styles['note']}>{NONE_OFFERED.reading}</p>
                        )}
                        {fromDocument && !choosing && !reading && (
                          <>
                            <p id={`${field}-why`} className={styles['note']}>
                              {noneOffered} {TYPE_A_NAME}
                            </p>
                            <label htmlFor={`${field}-document`}>
                              Name of the document parameter for {parameter.name}
                            </label>
                            <input
                              id={`${field}-document`}
                              value={held ?? ''}
                              aria-invalid={complaint}
                              aria-describedby={
                                complaint ? `${field}-why ${field}-unnamed` : `${field}-why`
                              }
                              onChange={(event) =>
                                setNamed({ ...named, [parameter.name]: event.target.value.trim() })
                              }
                            />
                            {complaint && (
                              <p id={`${field}-unnamed`} className={styles['complaint']}>
                                {parameter.name} {NOT_A_NAME}.
                              </p>
                            )}
                          </>
                        )}
                        {!fromDocument && (
                          <label htmlFor={field}>
                            {parameter.name}
                            {parameter.list ? ', one to a line' : ''}
                          </label>
                        )}
                        {fromDocument ? null : parameter.list ? (
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
                        {problem !== undefined && !fromDocument && (
                          <p id={`${field}-problem`} className={styles['complaint']}>
                            {parameter.name} {PARAMETER_WORDS[problem.rule]}.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </fieldset>
              )}
              {!asTable && (
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
                      This query definition has no image column, so it cannot give a figure its
                      image.
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
              )}
              {place === 'offer' && (
                <fieldset className={own['group']}>
                  <legend>Place as</legend>
                  <div className={own['forms']}>
                    {(imageColumn
                      ? (['line', 'figure', 'table'] as const)
                      : (['line', 'table'] as const)
                    ).map((each) => (
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
            {(asTable ? tableChoice : choice) !== null && (
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
