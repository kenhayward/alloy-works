import type { FieldView } from '@alloy-works/api-client';
import {
  canonicaliseDecimal,
  validate,
  valueLabel,
  type EffectiveField,
  type FieldDefinition,
} from '@alloy-works/domain';
import { useId, useMemo, useRef, useState } from 'react';

import { authorZone, instantFor, localIn } from './dateTime.js';
import styles from './FieldsForm.module.css';
import { readerLanguage, useVocabulary, vocabularyOf } from './vocabularies.js';
import { VocabularyChoice } from './VocabularyChoice.js';
import { formats, words } from '../words/words.js';

type Values = Readonly<Record<string, unknown>>;

export interface FieldsFormProps {
  /** The fields that apply here, in resolution order, as a view carries them. */
  readonly fields: readonly FieldView[];
  /** The schemas behind them, by name, for saying which require or fix a field. */
  readonly schemas: readonly { readonly id: string; readonly name: string }[];
  readonly values: Values;
  /** Who a `user` field may name. */
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly readOnly: boolean;
  /** The zone a `dateTime` is entered in: the author's own unless a test says otherwise. */
  readonly zone?: string;
  /** Every change, as the whole set: nothing a field would refuse is held back but a wrong type. */
  readonly onChange: (values: Record<string, unknown>) => void;
}

/** The field as `validate` takes it: the definition the view describes, and how it applies here. */
function effectiveOf(view: FieldView): EffectiveField {
  const field = {
    schemaVersion: 1,
    id: view.id,
    name: view.name,
    dataType: view.dataType,
    multiplicity: view.multiplicity,
    validation: view.validation,
    ...(view.maxValues === undefined ? {} : { maxValues: view.maxValues }),
  } as unknown as FieldDefinition;
  return {
    field,
    required: view.required,
    requiredBy: view.requiredBy,
    fixed: view.fixed,
    fixedBy: view.fixedBy,
    ...(view.default === undefined ? {} : { default: { value: view.default, from: [] } }),
  };
}

/** `2026-03-29T01:30` as its time and its date, `01:30` and `29 March 2026`, for a sentence about it. */
function spoken(local: string): { time: string; date: string } {
  const [date = '', time = ''] = local.split('T');
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0, second] = time.split(':').map(Number);
  // A wall-clock time in no zone, so formatted in UTC, where it is what it says.
  const at = Date.UTC(year, month - 1, day, hour, minute, second ?? 0);
  return {
    time: formats().time(at, {
      hour: '2-digit',
      minute: '2-digit',
      ...(second === undefined ? {} : { second: '2-digit' }),
      hourCycle: 'h23',
      timeZone: 'UTC',
    }),
    date: formats().date(at, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** The offset a stored instant carries, `+01:00`. */
const offsetOf = (value: string) => value.slice(-6);

/**
 * A set of fields and their values (definitions.md, "Shown as they arise"; MET-021): an input per data
 * type, a list for a field holding several, each required field marked with the schemas requiring it
 * and each fixed one read-only with the schemas fixing it, and `validate` run on every change - the
 * one the service and publication use - each failure beside its field and announced. Nothing a failure
 * says stops a change being handed on, except a value that is not its field's kind at all, which the
 * service would refuse: that is held here, as typed, and said beside the field.
 */
export function FieldsForm(props: FieldsFormProps) {
  const zone = props.zone ?? authorZone();
  const effective = useMemo(() => props.fields.map(effectiveOf), [props.fields]);
  const failures = validate(effective, props.values);
  // What a choice says at once, before any failure: a deprecated value chosen (the VO plan, VO-F).
  const [announced, setAnnounced] = useState<string | null>(null);
  const schemaName = (id: string) => props.schemas.find((each) => each.id === id)?.name ?? id;
  const said = [
    ...(announced === null ? [] : [announced]),
    ...failures.map((each) => {
      const name = props.fields.find((field) => field.id === each.field)?.name ?? each.field;
      // The detail is the domain's sentence, in English (packages/domain's `validate`).
      return words('metadata.failure', { name, detail: each.detail });
    }),
  ];
  return (
    <div className={styles['form']}>
      {props.fields.map((field) => (
        <FieldRow
          key={field.id}
          field={field}
          value={props.values[field.id]}
          failures={failures.filter((each) => each.field === field.id).map((each) => each.detail)}
          requiredBy={field.requiredBy.map(schemaName)}
          fixedBy={field.fixedBy.map(schemaName)}
          people={props.people}
          readOnly={props.readOnly || field.fixed}
          zone={zone}
          onAnnounce={setAnnounced}
          onChange={(value) => {
            // Any change ends what was said of the last; a choice says its own after this.
            setAnnounced(null);
            const next: Record<string, unknown> = { ...props.values };
            if (value === undefined) delete next[field.id];
            else next[field.id] = value;
            props.onChange(next);
          }}
        />
      ))}
      <p role="status" className={styles['said']}>
        {said.join('. ')}
      </p>
    </div>
  );
}

interface FieldRowProps {
  readonly field: FieldView;
  readonly value: unknown;
  readonly failures: readonly string[];
  readonly requiredBy: readonly string[];
  readonly fixedBy: readonly string[];
  readonly people: FieldsFormProps['people'];
  readonly readOnly: boolean;
  readonly zone: string;
  readonly onAnnounce: (said: string | null) => void;
  readonly onChange: (value: unknown) => void;
}

function FieldRow(props: FieldRowProps) {
  const base = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const describedBy = `${base}-said`;
  const invalid = props.failures.length > 0 || problem !== null;
  const notes = [
    ...(props.requiredBy.length > 0
      ? [words('metadata.required-by', { schemas: formats().list(props.requiredBy) })]
      : []),
    ...(props.fixedBy.length > 0
      ? [words('metadata.fixed-by', { schemas: formats().list(props.fixedBy) })]
      : []),
  ];
  const described = (
    <span id={describedBy} className={styles['failures']}>
      {[...(problem === null ? [] : [problem]), ...props.failures].join('. ')}
    </span>
  );
  const common = {
    readOnly: props.readOnly,
    required: props.field.required,
    invalid,
    describedBy,
    zone: props.zone,
    people: props.people,
    onProblem: setProblem,
    onAnnounce: props.onAnnounce,
  };

  if (props.field.multiplicity === 'many') {
    return (
      <fieldset className={styles['field']} aria-describedby={describedBy}>
        <legend data-content>{props.field.name}</legend>
        {notes.map((note) => (
          <span key={note} className={styles['note']}>
            {note}
          </span>
        ))}
        <ManyInput
          {...common}
          field={props.field}
          value={Array.isArray(props.value) ? props.value : []}
          onChange={props.onChange}
        />
        {described}
      </fieldset>
    );
  }
  return (
    <div className={styles['field']}>
      <OneInput
        {...common}
        field={props.field}
        label={props.field.name}
        content
        value={props.value}
        onChange={props.onChange}
      />
      {notes.map((note) => (
        <span key={note} className={styles['note']}>
          {note}
        </span>
      ))}
      {described}
    </div>
  );
}

interface InputProps {
  readonly field: FieldView;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly invalid: boolean;
  readonly describedBy: string;
  readonly zone: string;
  readonly people: FieldsFormProps['people'];
  readonly onProblem: (problem: string | null) => void;
  readonly onAnnounce: (said: string | null) => void;
}

/** One value's input, by its field's data type. `null` hands on a clear. */
function OneInput(
  props: InputProps & {
    readonly label: string;
    /** Whether the label is the field's own name, the tenant's words. */
    readonly content?: boolean;
    readonly value: unknown;
    readonly onChange: (value: unknown) => void;
  },
) {
  const id = useId();
  const vocabulary = useVocabulary(vocabularyOf(props.field));
  const aria = {
    'aria-required': props.required,
    'aria-invalid': props.invalid,
    'aria-describedby': props.describedBy,
  };
  const labelled = (control: React.ReactNode) => (
    <>
      <label htmlFor={id} {...(props.content === true ? { 'data-content': '' } : {})}>
        {props.label}
      </label>
      {control}
    </>
  );
  switch (props.field.dataType) {
    case 'boolean':
      return labelled(
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={props.value === true}
          disabled={props.readOnly}
          onChange={(event) => props.onChange(event.target.checked)}
          {...aria}
        />,
      );
    case 'number':
      return labelled(<NumberInput {...props} id={id} aria={aria} />);
    case 'date':
    case 'time':
      return labelled(
        <input
          id={id}
          type={props.field.dataType}
          step={props.field.dataType === 'time' ? 1 : undefined}
          value={typeof props.value === 'string' ? props.value : ''}
          readOnly={props.readOnly}
          onChange={(event) =>
            props.onChange(event.target.value === '' ? null : event.target.value)
          }
          {...aria}
        />,
      );
    case 'dateTime':
      return labelled(<DateTimeInput {...props} id={id} aria={aria} />);
    case 'user': {
      const chosen =
        typeof props.value === 'object' && props.value !== null && 'user' in props.value
          ? String((props.value as { user: unknown }).user)
          : '';
      const known = chosen === '' || props.people.some((each) => each.id === chosen);
      return labelled(
        <select
          id={id}
          value={chosen}
          disabled={props.readOnly}
          onChange={(event) =>
            props.onChange(event.target.value === '' ? null : { user: event.target.value })
          }
          {...aria}
        >
          <option value="">{words('metadata.nobody')}</option>
          {!known && <option value={chosen}>{words('metadata.someone-no-longer-here')}</option>}
          {props.people.map((each) => (
            <option key={each.id} value={each.id} data-content>
              {each.name}
            </option>
          ))}
        </select>,
      );
    }
    default:
      // Drawing on a vocabulary, chosen from it (the VO plan, VO-F); until it arrives, or where it
      // cannot be read, the id held as text, read-only while it is coming, the service checking it.
      if (typeof vocabulary === 'object') {
        return labelled(
          <VocabularyChoice
            id={id}
            name={props.label}
            vocabulary={vocabulary}
            value={props.value}
            readOnly={props.readOnly}
            aria={aria}
            onChange={props.onChange}
            onAnnounce={props.onAnnounce}
          />,
        );
      }
      return labelled(
        <input
          id={id}
          type="text"
          value={typeof props.value === 'string' ? props.value : ''}
          readOnly={props.readOnly || vocabulary === 'reading'}
          onChange={(event) =>
            props.onChange(event.target.value === '' ? null : event.target.value)
          }
          {...aria}
        />,
      );
  }
}

type Aria = {
  readonly 'aria-required': boolean;
  readonly 'aria-invalid': boolean;
  readonly 'aria-describedby': string;
};

/** A decimal kept as typed, and handed on only in its one spelling (component-editor.md). */
function NumberInput(
  props: InputProps & {
    readonly id: string;
    readonly aria: Aria;
    readonly value: unknown;
    readonly onChange: (value: unknown) => void;
  },
) {
  const [typed, setTyped] = useState(typeof props.value === 'string' ? props.value : '');
  return (
    <input
      id={props.id}
      type="text"
      inputMode="decimal"
      value={typed}
      readOnly={props.readOnly}
      onChange={(event) => {
        const raw = event.target.value;
        setTyped(raw);
        if (raw.trim() === '') {
          props.onProblem(null);
          props.onChange(null);
          return;
        }
        const canonical = canonicaliseDecimal(raw.trim());
        props.onProblem(canonical === undefined ? words('metadata.enter-a-number-such-as') : null);
        props.onChange(canonical ?? null);
      }}
      {...props.aria}
    />
  );
}

/**
 * A date and time in the author's zone, stored as its instant with its offset. A time the zone skips
 * is refused in a sentence; one it repeats is asked about, and nothing is handed on until it is.
 */
function DateTimeInput(
  props: InputProps & {
    readonly id: string;
    readonly aria: Aria;
    readonly value: unknown;
    readonly onChange: (value: unknown) => void;
  },
) {
  const [typed, setTyped] = useState(
    typeof props.value === 'string' ? (localIn(props.value, props.zone) ?? '') : '',
  );
  const [twice, setTwice] = useState<{ earlier: string; later: string } | null>(null);
  const question = useId();
  return (
    <>
      <input
        id={props.id}
        type="datetime-local"
        value={typed}
        readOnly={props.readOnly}
        onChange={(event) => {
          const raw = event.target.value;
          setTyped(raw);
          setTwice(null);
          if (raw === '') {
            props.onProblem(null);
            props.onChange(null);
            return;
          }
          const named = instantFor(raw, props.zone);
          if (named.kind === 'one') {
            props.onProblem(null);
            props.onChange(named.value);
          } else if (named.kind === 'two') {
            props.onProblem(null);
            setTwice(named);
            props.onChange(null);
          } else {
            props.onProblem(
              named.kind === 'none'
                ? words('metadata.there-is-no-here-the', spoken(raw))
                : words('metadata.enter-a-date-and-a'),
            );
            props.onChange(null);
          }
        }}
        {...props.aria}
      />
      {twice !== null && (
        <div role="radiogroup" aria-labelledby={question}>
          <span id={question}>{words('metadata.happens-twice-here-which-is', spoken(typed))}</span>
          {(
            [
              ['first', twice.earlier],
              ['second', twice.later],
            ] as const
          ).map(([which, value]) => (
            <label key={value}>
              <input
                type="radio"
                name={question}
                onChange={() => props.onChange(value)}
                disabled={props.readOnly}
              />
              {words('metadata.which-at', { which, offset: offsetOf(value) })}
            </label>
          ))}
        </div>
      )}
    </>
  );
}

/** One value of a list, with a key that stays with it however the list is reordered. */
interface Entry {
  readonly key: number;
  readonly value: unknown;
}

/** A field holding several values: an ordered list of its input, with add, move and remove. */
function ManyInput(
  props: InputProps & {
    readonly value: readonly unknown[];
    readonly onChange: (value: unknown) => void;
  },
) {
  // Entries as the author sees them: one being filled in is kept here and not handed on until it
  // holds something, so the list handed on never carries an empty value that was never meant. Each
  // has a key of its own that moves with it, so an input that keeps what was typed - a number's, a
  // date and time's - moves with its value when the list is reordered (W5.3 review).
  const counter = useRef(0);
  const keyed = (value: unknown): Entry => ({ key: (counter.current += 1), value });
  const [rows, setRows] = useState<Entry[]>(() => props.value.map(keyed));
  const emit = (next: Entry[]) => {
    setRows(next);
    props.onChange(
      next.map((row) => row.value).filter((each) => each !== null && each !== undefined),
    );
  };
  const vocabulary = useVocabulary(vocabularyOf(props.field));
  /** What an entry is called in its buttons' names: what it holds, else where it is. */
  const nameOf = (value: unknown, index: number) => {
    if (typeof value === 'string' && value !== '') {
      // A vocabulary's value by its label, as it is shown (the VO plan, VO-F).
      const drawn =
        typeof vocabulary === 'object'
          ? vocabulary.values.find((each) => each.id === value)
          : undefined;
      const name =
        drawn === undefined || typeof vocabulary !== 'object'
          ? value
          : valueLabel(vocabulary, drawn, readerLanguage());
      return { kind: 'named', name, n: 0 };
    }
    if (typeof value === 'object' && value !== null && 'user' in value) {
      const id = String((value as { user: unknown }).user);
      const name = props.people.find((each) => each.id === id)?.name;
      return name === undefined ? { kind: 'gone', name: '', n: 0 } : { kind: 'named', name, n: 0 };
    }
    return { kind: 'numbered', name: '', n: index + 1 };
  };
  return (
    <ol className={styles['many']}>
      {rows.map(({ key, value: entry }, index) => (
        <li key={key}>
          <OneInput
            {...props}
            label={words('metadata.value-2', { name: props.field.name, n: index + 1 })}
            value={entry}
            onChange={(value) =>
              emit(rows.map((row, at) => (at === index ? { key: row.key, value } : row)))
            }
          />
          {!props.readOnly && (
            <>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  const next = [...rows];
                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                  emit(next);
                }}
              >
                {words('metadata.move-up', nameOf(entry, index))}
              </button>
              <button
                type="button"
                disabled={index === rows.length - 1}
                onClick={() => {
                  const next = [...rows];
                  [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
                  emit(next);
                }}
              >
                {words('metadata.move-down', nameOf(entry, index))}
              </button>
              <button type="button" onClick={() => emit(rows.filter((_, at) => at !== index))}>
                {words('metadata.remove', nameOf(entry, index))}
              </button>
            </>
          )}
        </li>
      ))}
      {!props.readOnly && (
        <li>
          <button type="button" onClick={() => setRows([...rows, keyed(null)])}>
            {words('metadata.add-to', { name: props.field.name })}
          </button>
        </li>
      )}
    </ol>
  );
}
