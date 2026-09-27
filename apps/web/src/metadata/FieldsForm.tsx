import type { FieldView } from '@alloy-works/api-client';
import {
  canonicaliseDecimal,
  validate,
  type EffectiveField,
  type FieldDefinition,
} from '@alloy-works/domain';
import { useId, useMemo, useRef, useState } from 'react';

import { authorZone, instantFor, localIn } from './dateTime.js';
import styles from './FieldsForm.module.css';

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

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2026-03-29T01:30` as `01:30 on 29 March 2026`, for a sentence about it. */
function spoken(local: string): string {
  const [date = '', time = ''] = local.split('T');
  const [year, month, day] = date.split('-').map(Number);
  return `${time} on ${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

/** The offset a stored instant carries, as `UTC+01:00`. */
const offsetOf = (value: string) => `UTC${value.slice(-6)}`;

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
  const schemaName = (id: string) => props.schemas.find((each) => each.id === id)?.name ?? id;
  const said = failures.map((each) => {
    const name = props.fields.find((field) => field.id === each.field)?.name ?? each.field;
    return `${name}: ${each.detail}`;
  });
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
          onChange={(value) => {
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
  readonly onChange: (value: unknown) => void;
}

function FieldRow(props: FieldRowProps) {
  const base = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const describedBy = `${base}-said`;
  const invalid = props.failures.length > 0 || problem !== null;
  const notes = [
    ...(props.requiredBy.length > 0 ? [`Required by ${props.requiredBy.join(', ')}`] : []),
    ...(props.fixedBy.length > 0 ? [`Fixed by ${props.fixedBy.join(', ')}`] : []),
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
  };

  if (props.field.multiplicity === 'many') {
    return (
      <fieldset className={styles['field']} aria-describedby={describedBy}>
        <legend>{props.field.name}</legend>
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
}

/** One value's input, by its field's data type. `null` hands on a clear. */
function OneInput(
  props: InputProps & {
    readonly label: string;
    readonly value: unknown;
    readonly onChange: (value: unknown) => void;
  },
) {
  const id = useId();
  const aria = {
    'aria-required': props.required,
    'aria-invalid': props.invalid,
    'aria-describedby': props.describedBy,
  };
  const labelled = (control: React.ReactNode) => (
    <>
      <label htmlFor={id}>{props.label}</label>
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
          <option value="">Nobody</option>
          {!known && <option value={chosen}>Someone no longer here</option>}
          {props.people.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </select>,
      );
    }
    default:
      return labelled(
        <input
          id={id}
          type="text"
          value={typeof props.value === 'string' ? props.value : ''}
          readOnly={props.readOnly}
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
        props.onProblem(canonical === undefined ? 'Enter a number, such as 12.5' : null);
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
                ? `There is no ${spoken(raw)} here: the clocks go forward past it`
                : 'Enter a date and a time',
            );
            props.onChange(null);
          }
        }}
        {...props.aria}
      />
      {twice !== null && (
        <div role="radiogroup" aria-labelledby={question}>
          <span id={question}>{`${spoken(typed)} happens twice here. Which is meant?`}</span>
          {(
            [
              ['The first', twice.earlier],
              ['The second', twice.later],
            ] as const
          ).map(([which, value]) => (
            <label key={value}>
              <input
                type="radio"
                name={question}
                onChange={() => props.onChange(value)}
                disabled={props.readOnly}
              />
              {`${which}, at ${offsetOf(value)}`}
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
  const nameOf = (value: unknown, index: number) => {
    if (typeof value === 'string' && value !== '') return value;
    if (typeof value === 'object' && value !== null && 'user' in value) {
      const id = String((value as { user: unknown }).user);
      return props.people.find((each) => each.id === id)?.name ?? 'someone no longer here';
    }
    return `value ${index + 1}`;
  };
  return (
    <ol className={styles['many']}>
      {rows.map(({ key, value: entry }, index) => (
        <li key={key}>
          <OneInput
            {...props}
            label={`${props.field.name}, value ${index + 1}`}
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
                {`Move ${nameOf(entry, index)} up`}
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
                {`Move ${nameOf(entry, index)} down`}
              </button>
              <button type="button" onClick={() => emit(rows.filter((_, at) => at !== index))}>
                {`Remove ${nameOf(entry, index)}`}
              </button>
            </>
          )}
        </li>
      ))}
      {!props.readOnly && (
        <li>
          <button type="button" onClick={() => setRows([...rows, keyed(null)])}>
            {`Add to ${props.field.name}`}
          </button>
        </li>
      )}
    </ol>
  );
}
