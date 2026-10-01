import type { Parameter, QueryDefinition, ValueType } from '@alloy-works/domain';

/**
 * A query definition as its page holds it while it is written (the D2 plan, D2-U): every field as the
 * person typed it, turned into the definition the service takes only when it is sent, so a half-typed
 * number is never a refusal before the person has finished. Pure, so each rule is tested without a
 * page.
 */

export type Base = ValueType['base'];

/** The bases a parameter or a column may take, in the order a list offers them. */
export const BASES: readonly { readonly base: Base; readonly label: string }[] = [
  { base: 'text', label: 'Text' },
  { base: 'integer', label: 'Integer' },
  { base: 'decimal', label: 'Decimal' },
  { base: 'date', label: 'Date' },
  { base: 'time', label: 'Time' },
  { base: 'localDateTime', label: 'Local date and time' },
  { base: 'instant', label: 'Instant' },
  { base: 'boolean', label: 'Yes or no' },
];

/** A type as typed: a base, or none yet, and the numbers the base needs, as text. */
export interface TypeDraft {
  readonly base: Base | '';
  readonly precision: string;
  readonly scale: string;
  readonly fraction: string;
}

export interface ParameterDraft {
  readonly name: string;
  readonly type: TypeDraft;
  readonly required: boolean;
  readonly list: boolean;
  /** No restriction, a list of permitted values, or a range. */
  readonly permitted: 'none' | 'values' | 'range';
  /** Permitted values, one to a line. */
  readonly values: string;
  readonly minimum: string;
  readonly maximum: string;
  /** A variation's keys and their fragments; empty where the parameter is a value. */
  readonly variation: readonly { readonly key: string; readonly sql: string }[];
}

export interface ColumnDraft {
  /** The result's column, as the source names it. */
  readonly name: string;
  /** The source's name for its type, where a describe gave one. */
  readonly sourceType: string | null;
  readonly type: TypeDraft;
  /** Whether the author has confirmed its type (DAT-105). */
  readonly confirmed: boolean;
}

export interface DefinitionDraft {
  readonly title: string;
  readonly description: string;
  readonly connection: string;
  readonly sql: string;
  readonly parameters: readonly ParameterDraft[];
  readonly columns: readonly ColumnDraft[];
  readonly key: readonly string[];
  /** `multiset`, or the columns in the order the rows are held to. */
  readonly order:
    | 'multiset'
    | readonly { readonly column: string; readonly direction: 'ascending' | 'descending' }[];
  readonly empty: 'valid' | 'invalid';
  readonly limits: { readonly rows: string; readonly bytes: string; readonly seconds: string };
  readonly retired: boolean;
  /**
   * The columns as they stood for the statement last left with any of them confirmed: given back
   * when the connection, the SQL and its parameters are exactly that statement again.
   */
  readonly confirmedFor?: {
    readonly statement: string;
    readonly columns: readonly ColumnDraft[];
  };
}

export const NO_TYPE: TypeDraft = { base: '', precision: '', scale: '', fraction: '' };

/** A new parameter: text, required, one value. */
export const NEW_PARAMETER: ParameterDraft = {
  name: '',
  type: { ...NO_TYPE, base: 'text' },
  required: true,
  list: false,
  permitted: 'none',
  values: '',
  minimum: '',
  maximum: '',
  variation: [],
};

/** A definition being begun: no connection yet, and the product's default limits. */
export function newDraft(limits: {
  rows: number;
  bytes: number;
  seconds: number;
}): DefinitionDraft {
  return {
    title: '',
    description: '',
    connection: '',
    sql: '',
    parameters: [],
    columns: [],
    key: [],
    order: 'multiset',
    empty: 'valid',
    limits: {
      rows: String(limits.rows),
      bytes: String(limits.bytes),
      seconds: String(limits.seconds),
    },
    retired: false,
  };
}

/** A type as typed, from a declared one. */
export function typeDraftOf(type: ValueType): TypeDraft {
  return {
    base: type.base,
    precision: type.base === 'decimal' ? String(type.precision) : '',
    scale: type.base === 'decimal' ? String(type.scale) : '',
    fraction:
      type.base === 'time' || type.base === 'localDateTime' || type.base === 'instant'
        ? String(type.fraction)
        : '',
  };
}

const WHOLE = /^(0|[1-9][0-9]{0,8})$/;

/** A type as the service takes it, or the reason it cannot be one yet. */
export function valueTypeOf(type: TypeDraft): ValueType | string {
  switch (type.base) {
    case '':
      return 'Choose a type.';
    case 'decimal':
      if (!WHOLE.test(type.precision) || !WHOLE.test(type.scale)) {
        return 'A decimal needs its digits and its places, as whole numbers.';
      }
      return { base: 'decimal', precision: Number(type.precision), scale: Number(type.scale) };
    case 'time':
    case 'localDateTime':
    case 'instant':
      if (!/^[0-6]$/.test(type.fraction)) return 'A time needs its places of a second, 0 to 6.';
      return { base: type.base, fraction: Number(type.fraction) };
    default:
      return { base: type.base };
  }
}

/** A permitted value or a bound as the service takes it: a yes or no as a boolean, anything else as typed. */
function canonical(base: Base | '', text: string): string | boolean {
  if (base === 'boolean' && (text === 'true' || text === 'false')) return text === 'true';
  return text;
}

/** A draft's parameters as the service takes them, or the first reason they cannot be yet. */
export function parametersOf(draft: Pick<DefinitionDraft, 'parameters'>): Parameter[] | string {
  const parameters: Parameter[] = [];
  for (const parameter of draft.parameters) {
    const type = valueTypeOf(parameter.type);
    if (typeof type === 'string') return `The parameter ${parameter.name || '(unnamed)'}: ${type}`;
    const permitted =
      parameter.permitted === 'values'
        ? {
            permitted: {
              values: parameter.values
                .split('\n')
                .map((each) => each.trim())
                .filter((each) => each !== '')
                .map((each) => canonical(type.base, each)),
            },
          }
        : parameter.permitted === 'range'
          ? {
              permitted: {
                ...(parameter.minimum.trim() === '' ? {} : { minimum: parameter.minimum.trim() }),
                ...(parameter.maximum.trim() === '' ? {} : { maximum: parameter.maximum.trim() }),
              },
            }
          : {};
    parameters.push({
      name: parameter.name,
      type,
      required: parameter.required,
      list: parameter.list,
      ...permitted,
      ...(parameter.variation.length === 0 ? {} : { variation: [...parameter.variation] }),
    } as Parameter);
  }
  return parameters;
}

/** One draft's parameters, columns and the rest as the service takes them, or the first reason not. */
function parts(draft: DefinitionDraft) {
  const parameters = parametersOf(draft);
  if (typeof parameters === 'string') return parameters;
  const columns = [];
  for (const column of draft.columns) {
    const type = valueTypeOf(column.type);
    if (typeof type === 'string') return `The column ${column.name}: ${type}`;
    columns.push({ name: column.name, from: { column: column.name }, type });
  }
  if (columns.length === 0) return 'Describe the statement to propose its columns first.';
  const limits = {
    rows: Number(draft.limits.rows),
    bytes: Number(draft.limits.bytes),
    seconds: Number(draft.limits.seconds),
  };
  if (
    ![draft.limits.rows, draft.limits.bytes, draft.limits.seconds].every((each) => WHOLE.test(each))
  ) {
    return 'Each limit is a whole number.';
  }
  return {
    schemaVersion: 1 as const,
    connection: draft.connection,
    parameters,
    fetch: { kind: 'sql' as const, text: draft.sql },
    columns,
    key: [...draft.key],
    order:
      draft.order === 'multiset' ? ('multiset' as const) : draft.order.map((each) => ({ ...each })),
    empty: draft.empty,
    limits,
  };
}

/** The draft a sample runs: the definition less its title, description and retired (D2-I). */
export function sampleDefinition(draft: DefinitionDraft) {
  return parts(draft);
}

/** The whole definition a version saves, or the first reason it cannot be one yet. */
export function definitionOf(draft: DefinitionDraft): QueryDefinition | string {
  const made = parts(draft);
  if (typeof made === 'string') return made;
  return {
    ...made,
    title: draft.title.trim(),
    description: draft.description,
    retired: draft.retired,
  } as QueryDefinition;
}

/** A stored definition as its page holds it: every column already confirmed. */
export function draftOf(definition: QueryDefinition): DefinitionDraft {
  // Read by destructuring: the renderer's API test flags any member named for the network.
  const { fetch: statement } = definition;
  return {
    title: definition.title,
    description: definition.description,
    connection: definition.connection,
    sql: statement.text,
    parameters: definition.parameters.map((parameter) => {
      const permitted = parameter.permitted;
      return {
        name: parameter.name,
        type: typeDraftOf(parameter.type),
        required: parameter.required,
        list: parameter.list,
        permitted: permitted === undefined ? 'none' : 'values' in permitted ? 'values' : 'range',
        values:
          permitted !== undefined && 'values' in permitted
            ? permitted.values.map((each) => String(each)).join('\n')
            : '',
        minimum:
          permitted !== undefined && !('values' in permitted) && permitted.minimum !== undefined
            ? String(permitted.minimum)
            : '',
        maximum:
          permitted !== undefined && !('values' in permitted) && permitted.maximum !== undefined
            ? String(permitted.maximum)
            : '',
        variation: parameter.variation?.map((each) => ({ ...each })) ?? [],
      };
    }),
    columns: definition.columns.map((column) => ({
      name: column.name,
      sourceType: null,
      type: typeDraftOf(column.type),
      confirmed: true,
    })),
    key: [...definition.key],
    order:
      definition.order === 'multiset' ? 'multiset' : definition.order.map((each) => ({ ...each })),
    empty: definition.empty,
    limits: {
      rows: String(definition.limits.rows),
      bytes: String(definition.limits.bytes),
      seconds: String(definition.limits.seconds),
    },
    retired: definition.retired,
  };
}

/** Two typed types alike, member by member. */
const sameType = (one: TypeDraft, other: TypeDraft) =>
  one.base === other.base &&
  one.precision === other.precision &&
  one.scale === other.scale &&
  one.fraction === other.fraction;

/**
 * The columns as they are, each to be confirmed again, its declared type kept: what the SQL or a
 * parameter changed may have changed what the statement returns, so nothing is saved until the author
 * has looked again (DAT-105).
 */
export function unconfirmed(columns: readonly ColumnDraft[]): ColumnDraft[] {
  return columns.map((column) => (column.confirmed ? { ...column, confirmed: false } : column));
}

/** What the columns are confirmed for: the connection, the SQL and its parameters, exactly. */
export function statementOf(draft: Pick<DefinitionDraft, 'connection' | 'sql' | 'parameters'>) {
  return JSON.stringify([draft.connection, draft.sql, draft.parameters]);
}

/**
 * The draft with its connection, SQL or parameters changed. A change withdraws every column's
 * confirmation and keeps its declared type; one that returns the statement to exactly what the columns
 * were last confirmed for gives back the confirmations of the columns still declared as they were.
 */
export function withStatement(
  held: DefinitionDraft,
  over: Pick<Partial<DefinitionDraft>, 'connection' | 'sql' | 'parameters'>,
): DefinitionDraft {
  const next = { ...held, ...over };
  const before = statementOf(held);
  const after = statementOf(next);
  if (before === after) return next;
  const remembered = held.columns.some((column) => column.confirmed)
    ? { statement: before, columns: held.columns }
    : held.confirmedFor;
  const confirmedFor = remembered === undefined ? {} : { confirmedFor: remembered };
  if (remembered?.statement === after) {
    return {
      ...next,
      ...confirmedFor,
      columns: next.columns.map((column) => ({
        ...column,
        confirmed: remembered.columns.some(
          (each) => each.confirmed && each.name === column.name && sameType(each.type, column.type),
        ),
      })),
    };
  }
  return { ...next, ...confirmedFor, columns: unconfirmed(next.columns) };
}

/**
 * The columns a describe proposed (DAT-105), each to be confirmed: the source's type where it proposed
 * one, and none where the author must declare it. A column already declared by that name keeps its
 * confirmation where the source proposes the type it was declared as, so describing again asks only
 * about what is new or changed; one the source now proposes otherwise takes the proposal, and one it
 * proposes nothing for keeps the type the author declared - each of those to be confirmed again.
 */
export function proposedColumns(
  described: readonly {
    readonly name: string;
    readonly sourceType: string;
    readonly proposed: ValueType | null;
  }[],
  held: readonly ColumnDraft[],
): ColumnDraft[] {
  return described.map((column) => {
    const declared = held.find((each) => each.name === column.name);
    const proposed = column.proposed === null ? null : typeDraftOf(column.proposed);
    if (declared !== undefined && (proposed === null || declared.type.base !== '')) {
      if (proposed !== null && sameType(proposed, declared.type)) {
        return { ...declared, sourceType: column.sourceType };
      }
      return {
        ...declared,
        sourceType: column.sourceType,
        type: proposed ?? declared.type,
        confirmed: false,
      };
    }
    return {
      name: column.name,
      sourceType: column.sourceType,
      type: column.proposed === null ? NO_TYPE : typeDraftOf(column.proposed),
      confirmed: false,
    };
  });
}

/** Whether every column is confirmed, and there is at least one: what a save needs (DAT-105). */
export function everyColumnConfirmed(draft: DefinitionDraft): boolean {
  return draft.columns.length > 0 && draft.columns.every((column) => column.confirmed);
}

/**
 * A sample's values as the service takes them (D2-R): each as typed, a list one to a line, a yes or
 * no as a boolean, and nothing for a parameter left empty.
 */
export function sampleValues(
  parameters: readonly ParameterDraft[],
  typed: Readonly<Record<string, string>>,
): Record<string, string | boolean | (string | boolean)[]> {
  const values: Record<string, string | boolean | (string | boolean)[]> = {};
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
