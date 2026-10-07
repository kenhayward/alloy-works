import {
  templateParameterSchema,
  type MetadataRule,
  type ParameterRule,
  type TemplateParameter,
} from '@alloy-works/domain';

import { PARAMETER_WORDS } from '../editor/ValueDialog.js';
import styles from '../metadata/FieldsForm.module.css';

/** One value of a parameter as a form holds it: canonical text, or a boolean. */
export type ParameterEntry = string | boolean;
/** A parameter's value as a form holds it: one entry, or a list of them. */
export type ParameterValue = ParameterEntry | readonly ParameterEntry[];

/** A template's declarations, each checked rather than trusted: the client's bodies are `any`. */
export function declarationsIn(value: unknown): TemplateParameter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each) => {
    const parsed = templateParameterSchema.safeParse(each);
    return parsed.success ? [parsed.data] : [];
  });
}

/** What a value refused by its seeded field broke (TP1-G), beside the parameter. */
const FIELD_WORDS: Partial<Record<MetadataRule, string>> = {
  minLength: 'is shorter than the field it fills allows',
  maxLength: 'is longer than the field it fills allows',
  min: 'is below what the field it fills allows',
  max: 'is above what the field it fills allows',
  maxValues: 'has more entries than the field it fills holds',
  multiplicity: 'repeats an entry the field it fills holds once',
  integer: 'is not a whole number, as the field it fills needs',
  scale: 'has more places than the field it fills holds',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The service's refusal of parameter values (templates.md, "Failures"), as words beside each parameter
 * it names: `parameter_invalid`'s rule and value, by the parameter's rule or its seeded field's;
 * `parameter_unknown` and `parameter_fixed` by name. Empty for any other refusal.
 */
export function refusedParameters(refusal: unknown): Map<string, string> {
  const said = new Map<string, string>();
  if (!isRecord(refusal)) return said;
  if (refusal.code === 'parameter_invalid' && Array.isArray(refusal.problems)) {
    for (const problem of refusal.problems as unknown[]) {
      if (!isRecord(problem) || typeof problem.parameter !== 'string') continue;
      const rule = typeof problem.rule === 'string' ? problem.rule : '';
      const words =
        typeof problem.field === 'string'
          ? (FIELD_WORDS[rule as MetadataRule] ?? 'does not fit the field it fills')
          : (PARAMETER_WORDS[rule as ParameterRule] ?? 'does not fit its parameter');
      const value =
        typeof problem.value === 'string' && problem.value !== '' ? problem.value : null;
      said.set(
        problem.parameter,
        `${problem.parameter} ${words}${value === null ? '' : `: ${value}`}.`,
      );
    }
  }
  if (
    (refusal.code === 'parameter_unknown' || refusal.code === 'parameter_fixed') &&
    Array.isArray(refusal.parameters)
  ) {
    for (const each of refusal.parameters as unknown[]) {
      if (!isRecord(each) || typeof each.parameter !== 'string') continue;
      said.set(
        each.parameter,
        refusal.code === 'parameter_fixed'
          ? `${each.parameter} may not change after the document is made.`
          : `${each.parameter} is not a parameter of this template.`,
      );
    }
  }
  return said;
}

/** Whether a value says nothing: no value, empty text, or a list with no entry. */
const blank = (value: ParameterValue | undefined): boolean =>
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.every((each) => each === ''));

/** The required parameters a form holds no value for, by name. */
export function missingParameters(
  declared: readonly TemplateParameter[],
  values: Readonly<Record<string, ParameterValue>>,
): string[] {
  return declared
    .filter((each) => each.required && blank(values[each.name]))
    .map((each) => each.name);
}

/** `a`, `a and b`, `a, b and c`. */
export function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * The values to send, by name: text as typed, anything else trimmed, an empty one and an empty list
 * entry left out, so a parameter given nothing is not given at all.
 */
export function valuesToSend(
  declared: readonly TemplateParameter[],
  values: Readonly<Record<string, ParameterValue>>,
): Record<string, ParameterValue> {
  const sent: Record<string, ParameterValue> = {};
  const clean = (parameter: TemplateParameter, entry: ParameterEntry): ParameterEntry =>
    typeof entry === 'string' && parameter.type.base !== 'text' ? entry.trim() : entry;
  for (const parameter of declared) {
    const value = values[parameter.name];
    if (blank(value)) continue;
    if (Array.isArray(value)) {
      sent[parameter.name] = value
        .map((each) => clean(parameter, each))
        .filter((each) => each !== '');
    } else {
      sent[parameter.name] = clean(parameter, value as ParameterEntry);
    }
  }
  return sent;
}

/** The value a parameter starts with in a form: false for a check box, nothing otherwise. */
export function startingValue(parameter: TemplateParameter): ParameterValue | undefined {
  if (parameter.type.base === 'boolean' && !parameter.list && parameter.permitted === undefined) {
    return false;
  }
  return parameter.list ? [] : undefined;
}

/** What a parameter of each type takes, said under its name. */
function hint(parameter: TemplateParameter): string | null {
  switch (parameter.type.base) {
    case 'integer':
      return 'A whole number.';
    case 'decimal':
      return `A number, at most ${parameter.type.scale} places after the point.`;
    case 'instant':
      return 'A date and time, in UTC.';
    default:
      return null;
  }
}

/** A time or a date and time as an input gives it, with its seconds: `14:30` becomes `14:30:00`. */
const withSeconds = (text: string) => (/(?:^|T)\d{2}:\d{2}$/.test(text) ? `${text}:00` : text);

interface EntryProps {
  readonly parameter: TemplateParameter;
  readonly id: string;
  readonly label?: string;
  readonly value: ParameterEntry | undefined;
  readonly onChange: (value: ParameterEntry) => void;
  readonly readOnly: boolean;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
}

/** One entry, by the parameter's type: a choice, a check box, a date, a time, or a box. */
function Entry({
  parameter,
  id,
  label,
  value,
  onChange,
  readOnly,
  describedBy,
  invalid,
}: EntryProps) {
  const shared = {
    id,
    'aria-label': label,
    'aria-describedby': describedBy,
    'aria-invalid': invalid || undefined,
  };
  const permitted =
    parameter.permitted !== undefined && 'values' in parameter.permitted
      ? parameter.permitted.values.filter((each) => each !== null)
      : null;
  if (permitted !== null) {
    return (
      <select
        {...shared}
        disabled={readOnly}
        value={value === undefined ? '' : String(value)}
        onChange={(event) => {
          const chosen = permitted.find((each) => String(each) === event.target.value);
          onChange(chosen ?? '');
        }}
      >
        <option value="">Not chosen</option>
        {permitted.map((each) => (
          <option key={String(each)} value={String(each)}>
            {String(each)}
          </option>
        ))}
      </select>
    );
  }
  const text = typeof value === 'string' ? value : '';
  switch (parameter.type.base) {
    case 'boolean':
      return (
        <input
          {...shared}
          type="checkbox"
          disabled={readOnly}
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      );
    case 'date':
      return (
        <input
          {...shared}
          type="date"
          readOnly={readOnly}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'time':
      return (
        <input
          {...shared}
          type="time"
          step={1}
          readOnly={readOnly}
          value={text}
          onChange={(event) => onChange(withSeconds(event.target.value))}
        />
      );
    case 'localDateTime':
    case 'instant': {
      const zoned = parameter.type.base === 'instant';
      return (
        <input
          {...shared}
          type="datetime-local"
          step={1}
          readOnly={readOnly}
          value={zoned ? text.replace(/Z$/, '') : text}
          onChange={(event) => {
            const typed = withSeconds(event.target.value);
            onChange(zoned && typed !== '' ? `${typed}Z` : typed);
          }}
        />
      );
    }
    default:
      return (
        <input
          {...shared}
          type="text"
          inputMode={
            parameter.type.base === 'integer'
              ? 'numeric'
              : parameter.type.base === 'decimal'
                ? 'decimal'
                : undefined
          }
          readOnly={readOnly}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

export interface ParameterInputProps {
  readonly parameter: TemplateParameter;
  /** The input's id; a list's entries are numbered from it. */
  readonly id: string;
  readonly value: ParameterValue | undefined;
  readonly onChange: (value: ParameterValue) => void;
  readonly readOnly?: boolean;
  /** Said under the name: why it cannot change, say. */
  readonly note?: string;
  /** The service's refusal of this parameter, in its words, beside it. */
  readonly problem?: string;
}

/**
 * A template parameter's value, asked for by its type (the TP1 plan, TP1-I): a box for text and a
 * number, a date, a time, a date and time, a check box, a choice where the parameter permits values,
 * and repeated entries for a list. Shared by the New document form and the Parameters panel, so the
 * two ask for a value alike.
 */
export function ParameterInput({
  parameter,
  id,
  value,
  onChange,
  readOnly = false,
  note,
  problem,
}: ParameterInputProps) {
  const said = [hint(parameter), note].filter((each): each is string => each != null);
  const noteId = said.length > 0 ? `${id}-note` : undefined;
  const problemId = problem === undefined ? undefined : `${id}-problem`;
  const describedBy = [noteId, problemId].filter(Boolean).join(' ') || undefined;
  const name = `${parameter.name}${parameter.required ? ' (required)' : ''}`;
  const notes = (
    <>
      {noteId !== undefined && (
        <span id={noteId} className={styles['note']}>
          {said.join(' ')}
        </span>
      )}
      {problemId !== undefined && (
        <span id={problemId} className={styles['failures']}>
          {problem}
        </span>
      )}
    </>
  );

  if (!parameter.list) {
    return (
      <div className={styles['field']}>
        <label htmlFor={id}>{name}</label>
        <Entry
          parameter={parameter}
          id={id}
          value={Array.isArray(value) ? undefined : (value as ParameterEntry | undefined)}
          onChange={onChange}
          readOnly={readOnly}
          describedBy={describedBy}
          invalid={problem !== undefined}
        />
        {notes}
      </div>
    );
  }

  const entries: readonly ParameterEntry[] = Array.isArray(value) ? value : [];
  return (
    <fieldset className={styles['field']} aria-describedby={describedBy}>
      <legend>{name}</legend>
      {notes}
      {entries.length > 0 && (
        <ol className={styles['many']}>
          {entries.map((entry, index) => (
            // Entries have no identity but their place: removing one redraws those after it.
            <li key={index}>
              <Entry
                parameter={parameter}
                id={`${id}-${index + 1}`}
                label={`${parameter.name}, entry ${index + 1}`}
                value={entry}
                onChange={(next) =>
                  onChange(entries.map((each, at) => (at === index ? next : each)))
                }
                readOnly={readOnly}
                describedBy={undefined}
                invalid={problem !== undefined}
              />{' '}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onChange(entries.filter((_, at) => at !== index))}
                >
                  {`Remove entry ${index + 1} from ${parameter.name}`}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {!readOnly && (
        <button
          type="button"
          onClick={() => onChange([...entries, parameter.type.base === 'boolean' ? false : ''])}
        >
          {`Add an entry to ${parameter.name}`}
        </button>
      )}
    </fieldset>
  );
}
