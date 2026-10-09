import {
  checkTree,
  generatePostgres,
  pointerTo,
  type AggregateName,
  type CanonicalValue,
  type ColumnType,
  type Comparison,
  type Condition,
  type FileCondition,
  type Parameter,
  type ProposedType,
  type Query,
  type QueryDefinition,
  type SelectItem,
  type ValueType,
} from '@alloy-works/domain';

import { fileDraftOf, fileText, NEW_FILE, type FileDraft } from './fileDraft.js';
import {
  formatOf,
  httpDraftOf,
  NEW_HTTP,
  partOf,
  requestText,
  templateOf,
  type FormatDraft,
  type HttpDraft,
} from './httpDraft.js';

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

/** A column's bases: the eight, and an image (D8-A), which a parameter never is (DAT-010). */
export const COLUMN_BASES: readonly { readonly base: Base | 'image'; readonly label: string }[] = [
  ...BASES,
  { base: 'image', label: 'Image' },
];

/** How a source holds an image, in the order a list offers them (D8-A). */
export const ENCODINGS = [
  { encoding: 'binary', label: 'Binary' },
  { encoding: 'base64', label: 'Base64 text' },
] as const;

/** An image's description: a declared text column, decorative, or not chosen yet (D8-A). */
export type DescriptionDraft = { readonly column: string } | 'decorative' | null;

/**
 * A type as typed: a base, or none yet, and the numbers the base needs, as text; an image's encoding
 * and description, or none yet, kept while another base is chosen.
 */
export interface TypeDraft {
  readonly base: Base | 'image' | '';
  readonly precision: string;
  readonly scale: string;
  readonly fraction: string;
  readonly encoding: 'binary' | 'base64' | '';
  readonly description: DescriptionDraft;
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

/** A parameter in words, as its line shows it: "Text, not required, any value of its type". */
export function parameterSummary(parameter: ParameterDraft): string {
  const type = BASES.find((each) => each.base === parameter.type.base)?.label ?? 'No type yet';
  const takes =
    parameter.variation.length > 0
      ? 'chooses a fragment of SQL'
      : parameter.permitted === 'values'
        ? 'only the values listed'
        : parameter.permitted === 'range'
          ? 'only values in a range'
          : 'any value of its type';
  return [type, parameter.required ? 'required' : 'not required', parameter.list && 'a list', takes]
    .filter(Boolean)
    .join(', ');
}

export interface ColumnDraft {
  /** The result's column, as the source names it. */
  readonly name: string;
  /** The source's name for its type, where a describe gave one. */
  readonly sourceType: string | null;
  readonly type: TypeDraft;
  /** Whether the author has confirmed its type (DAT-105). */
  readonly confirmed: boolean;
  /** Where an HTTP response's column is read from its row, as its sample proposed (the D6 plan). */
  readonly pointer?: string;
  /** Where a CSV's column is read from its record: its header, or its letter (the D6 plan, D6-F). */
  readonly header?: string;
  readonly letter?: string;
}

/** A column of the table or view the builder reads, returned under a name of the author's. */
export interface PickedColumn {
  /** The source's column. */
  readonly column: string;
  /** The name it is returned as. */
  readonly name: string;
}

/** One filter: a column compared with a parameter, or with a fixed value of a type (D4-C). */
export interface FilterDraft {
  readonly column: string;
  readonly is: Comparison;
  /** A parameter by name, or a fixed value as typed, compared as its type. */
  readonly to:
    { readonly parameter: string } | { readonly value: string; readonly type: ValueType };
}

/** One summary of a group (D4-I): an aggregate of a column, or a count of every row. */
export interface SummaryDraft {
  readonly aggregate: AggregateName;
  /** The source's column, or empty for a count of every row. */
  readonly column: string;
  readonly name: string;
  /** An average's places, as typed. */
  readonly places: string;
}

/**
 * A built query as its page holds it (the D4 plan, D4-O): one table or view, the columns it returns,
 * filters joined by all or any, whether it groups by the columns returned and summarises each group,
 * and how many rows it returns at most beside a declared order.
 */
export interface BuilderDraft {
  readonly alias: string;
  readonly table: { readonly schema: string; readonly name: string } | null;
  readonly columns: readonly PickedColumn[];
  readonly filters: readonly FilterDraft[];
  readonly match: 'all' | 'any';
  readonly grouped: boolean;
  readonly summaries: readonly SummaryDraft[];
  /** Return at most this many rows, as typed: empty for every row. */
  readonly limit: string;
}

export const NEW_BUILDER: BuilderDraft = {
  alias: 't',
  table: null,
  columns: [],
  filters: [],
  match: 'all',
  grouped: false,
  summaries: [],
  limit: '',
};

export interface DefinitionDraft {
  readonly title: string;
  readonly description: string;
  readonly connection: string;
  /**
   * Whether the query is built (D4) or written as SQL, which needs write_sql; or, on an HTTP
   * connection, a request template, and on an S3 connection a file (the D6 plan).
   */
  readonly mode: 'builder' | 'sql' | 'http' | 'file';
  readonly builder: BuilderDraft;
  readonly http: HttpDraft;
  readonly file: FileDraft;
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

export const NO_TYPE: TypeDraft = {
  base: '',
  precision: '',
  scale: '',
  fraction: '',
  encoding: '',
  description: null,
};

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
    mode: 'builder',
    builder: NEW_BUILDER,
    http: NEW_HTTP,
    file: NEW_FILE,
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

/**
 * A type as typed, from a declared one or a proposal: a proposed image (D8-A) has its encoding and no
 * description yet, which the author declares.
 */
export function typeDraftOf(type: ColumnType | ProposedType): TypeDraft {
  if (type.base === 'image') {
    return {
      ...NO_TYPE,
      base: 'image',
      encoding: type.encoding,
      description: 'description' in type ? type.description : null,
    };
  }
  return {
    ...NO_TYPE,
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

/** A parameter's type as the service takes it, or the reason it cannot be one yet. */
export function valueTypeOf(type: TypeDraft): ValueType | string {
  switch (type.base) {
    case '':
      return 'Choose a type.';
    case 'image':
      return 'A parameter is never an image.';
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

/**
 * A column's type as the service takes it, or the reason it cannot be one yet: an image needs its
 * encoding, and its description a text column of `columns` or decorative (D8-A).
 */
export function columnTypeOf(
  type: TypeDraft,
  columns: readonly ColumnDraft[],
): ColumnType | string {
  if (type.base !== 'image') return valueTypeOf(type);
  if (type.encoding === '') return 'Choose how the source holds the image.';
  const { description } = type;
  const describes =
    description === 'decorative' ||
    (description !== null &&
      columns.some((each) => each.name === description.column && each.type.base === 'text'));
  if (!describes) return 'Choose the text column that describes it, or mark it decorative.';
  return { base: 'image', encoding: type.encoding, description };
}

/** A permitted value or a bound as the service takes it: a yes or no as a boolean, anything else as typed. */
export function canonical(base: TypeDraft['base'], text: string): string | boolean {
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

const ORDERED: readonly Base[] = ['integer', 'decimal', 'date', 'time', 'localDateTime', 'instant'];

/** The words for each comparison, as a filter offers it. */
export const COMPARISON_WORDS: Readonly<Record<Comparison, string>> = {
  equal: 'is',
  notEqual: 'is not',
  less: 'is less than',
  lessOrEqual: 'is at most',
  greater: 'is greater than',
  greaterOrEqual: 'is at least',
  in: 'is one of',
  contains: 'contains',
  startsWith: 'starts with',
  isNull: 'is empty',
  isNotNull: 'is not empty',
};

/**
 * The comparisons a filter offers against a value of this type (D4-C, D4-G, D4-M): a list by in
 * alone, text by equal, not equal, contains and starts with, a number or a time by equal to at least,
 * a yes or no by equal and not equal - and is empty and is not empty whatever it compares with.
 */
export function comparisonsFor(type: ValueType | null, list: boolean): Comparison[] {
  const nulls: Comparison[] = ['isNull', 'isNotNull'];
  if (type === null) return nulls;
  if (list) return ['in', ...nulls];
  if (type.base === 'text') return ['equal', 'notEqual', 'contains', 'startsWith', ...nulls];
  if (ORDERED.includes(type.base)) {
    return ['equal', 'notEqual', 'less', 'lessOrEqual', 'greater', 'greaterOrEqual', ...nulls];
  }
  return ['equal', 'notEqual', ...nulls];
}

/** What a filter compares with: its parameter's type and whether it is a list, or its value's type. */
export function operandOf(
  filter: FilterDraft,
  parameters: readonly ParameterDraft[],
): { readonly type: ValueType | null; readonly list: boolean } {
  if ('value' in filter.to) return { type: filter.to.type, list: false };
  const name = filter.to.parameter;
  const parameter = parameters.find((each) => each.name === name);
  if (parameter === undefined) return { type: null, list: false };
  const type = valueTypeOf(parameter.type);
  return { type: typeof type === 'string' ? null : type, list: parameter.list };
}

/**
 * A filter fitted to what it compares with: one naming a parameter no longer declared compares with
 * the first that is, or with a fixed value where none is; and one whose comparison its operand no
 * longer allows takes the first it does.
 */
export function fitFilter(filter: FilterDraft, parameters: readonly ParameterDraft[]): FilterDraft {
  let fitted = filter;
  if ('parameter' in filter.to) {
    const name = filter.to.parameter;
    if (!parameters.some((each) => each.name === name)) {
      const first = parameters[0];
      fitted = {
        ...fitted,
        to: first === undefined ? { value: '', type: { base: 'text' } } : { parameter: first.name },
      };
    }
  }
  const { type, list } = operandOf(fitted, parameters);
  const allowed = comparisonsFor(type, list);
  return allowed.includes(fitted.is) ? fitted : { ...fitted, is: allowed[0]! };
}

/** A builder draft's filters fitted to the parameters declared now. */
export function fitFilters(
  builder: BuilderDraft,
  parameters: readonly ParameterDraft[],
): BuilderDraft {
  return { ...builder, filters: builder.filters.map((filter) => fitFilter(filter, parameters)) };
}

/** A filter as the tree holds it. */
function conditionOf(filter: FilterDraft, alias: string): Condition {
  const column = { source: alias, column: filter.column };
  if (filter.is === 'isNull' || filter.is === 'isNotNull') return { column, is: filter.is };
  if ('parameter' in filter.to) {
    return { column, is: filter.is, to: { parameter: filter.to.parameter } };
  }
  const { type, value } = filter.to;
  const literal: CanonicalValue = canonical(type.base, type.base === 'text' ? value : value.trim());
  return { column, is: filter.is, to: { literal, type } };
}

const PLACES = /^(0|[1-9][0-9]{0,3})$/;

/**
 * A builder draft's tree, or the first reason it cannot be one yet. A limit is the tree's only beside
 * a declared order (D4-B), so over rows in no order it is left out, whatever is typed.
 */
export function queryOf(builder: BuilderDraft, order: DefinitionDraft['order']): Query | string {
  if (builder.table === null) return 'Choose a table or view.';
  if (builder.columns.length === 0 && builder.summaries.length === 0) {
    return 'Choose a column to return.';
  }
  const { alias } = builder;
  const select: SelectItem[] = builder.columns.map((each) => ({
    name: each.name,
    of: { source: alias, column: each.column },
  }));
  if (builder.grouped) {
    for (const summary of builder.summaries) {
      if (summary.aggregate === 'average' && !PLACES.test(summary.places.trim())) {
        return `The average ${summary.name}: round it to a whole number of places, 0 to 1000.`;
      }
      select.push({
        name: summary.name,
        of: {
          aggregate: summary.aggregate,
          ...(summary.column === '' ? {} : { of: { source: alias, column: summary.column } }),
          ...(summary.aggregate === 'average' ? { places: Number(summary.places.trim()) } : {}),
        },
      });
    }
  }
  const conditions = builder.filters.map((filter) => conditionOf(filter, alias));
  const where: Condition | undefined =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : builder.match === 'all'
          ? { and: conditions }
          : { or: conditions };
  const limit = builder.limit.trim();
  if (order !== 'multiset' && limit !== '' && !WHOLE.test(limit)) {
    return 'Return at most a whole number of rows.';
  }
  return {
    sources: [{ alias, table: { schema: builder.table.schema, name: builder.table.name } }],
    joins: [],
    select,
    ...(where === undefined ? {} : { where }),
    groupBy: builder.grouped
      ? builder.columns.map((each) => ({ source: alias, column: each.column }))
      : [],
    ...(order !== 'multiset' && limit !== '' ? { limit: Number(limit) } : {}),
  };
}

/**
 * Why the page cannot show a built query in the builder, or the builder's draft of it (the D4 plan,
 * D4-D): the page offers one table or view, its columns, filters one level deep, grouping by the
 * columns returned, and the five aggregates; anything else the API wrote opens read-only. A tree is
 * offered only where the draft writes it again exactly, so nothing shown differs from what is stored.
 */
export function builderDraftOf(
  query: Query,
  order: DefinitionDraft['order'],
): BuilderDraft | { readonly reason: string } {
  if (query.sources.length !== 1 || query.joins.length > 0) {
    return { reason: 'it joins more than one source, which this page does not offer yet' };
  }
  const [source] = query.sources;
  if (source === undefined || !('table' in source)) {
    return { reason: 'it reads a nested query, which this page does not offer yet' };
  }
  const comparisonsIn = (where: Condition | undefined): Condition[] | 'nested' => {
    if (where === undefined) return [];
    if ('and' in where || 'or' in where) {
      const each = 'and' in where ? where.and : where.or;
      return each.every((one) => 'column' in one) ? each : 'nested';
    }
    return 'not' in where ? 'nested' : [where];
  };
  const found = comparisonsIn(query.where);
  if (found === 'nested') {
    return { reason: 'its filters are nested, which this page does not offer yet' };
  }
  const filters: FilterDraft[] = [];
  for (const condition of found) {
    if (!('column' in condition)) continue;
    const { to } = condition;
    if (to !== undefined && 'column' in to) {
      return { reason: 'it compares two columns, which this page does not offer yet' };
    }
    if (to !== undefined && 'literal' in to && Array.isArray(to.literal)) {
      return {
        reason: 'it compares with a list of fixed values, which this page does not offer yet',
      };
    }
    filters.push({
      column: condition.column.column,
      is: condition.is,
      to:
        to === undefined
          ? { value: '', type: { base: 'text' } }
          : 'parameter' in to
            ? { parameter: to.parameter }
            : {
                value: to.literal === null ? '' : String(to.literal as string | boolean),
                type: to.type,
              },
    });
  }
  const columns: PickedColumn[] = [];
  const summaries: SummaryDraft[] = [];
  for (const item of query.select) {
    if ('aggregate' in item.of) {
      summaries.push({
        aggregate: item.of.aggregate,
        column: item.of.of?.column ?? '',
        name: item.name,
        places: item.of.places === undefined ? '' : String(item.of.places),
      });
    } else columns.push({ column: item.of.column, name: item.name });
  }
  const draft: BuilderDraft = {
    alias: source.alias,
    table: { schema: source.table.schema, name: source.table.name },
    columns,
    filters,
    match: query.where !== undefined && 'or' in query.where ? 'any' : 'all',
    grouped: query.groupBy.length > 0 || summaries.length > 0,
    summaries,
    limit: query.limit === undefined ? '' : String(query.limit),
  };
  const again = queryOf(draft, order);
  if (typeof again === 'string' || JSON.stringify(again) !== JSON.stringify(query)) {
    return { reason: 'it was written through the API in a form this page does not offer' };
  }
  return draft;
}

/** Why a stored definition opens read-only for want of a builder that can show it, or null. */
export function unshownReason(definition: QueryDefinition): string | null {
  // Read by destructuring: the renderer's API test flags any member named for the network.
  const { fetch: statement } = definition;
  if (statement.kind === 'http') {
    const held = httpDraftOf(statement);
    return 'reason' in held ? held.reason : null;
  }
  if (statement.kind === 'file') {
    const held = fileDraftOf(statement);
    return 'reason' in held ? held.reason : null;
  }
  if (statement.kind !== 'builder') return null;
  const draft = builderDraftOf(statement.query, definition.order);
  return 'reason' in draft ? draft.reason : null;
}

/**
 * The SQL a built draft runs, as the generator writes it (D4-E), or what it still needs: the tree's
 * own checks first, so an unfinished tree says what is missing rather than generating half a query.
 */
export function generatedSql(draft: DefinitionDraft): { sql: string } | { needs: string } {
  const parameters = parametersOf(draft);
  if (typeof parameters === 'string') return { needs: parameters };
  const query = queryOf(draft.builder, draft.order);
  if (typeof query === 'string') return { needs: query };
  let problem: string | undefined;
  checkTree(query, parameters, (_path, message) => {
    problem ??= message;
  });
  if (problem !== undefined) return { needs: `${problem}.` };
  const columns = draft.columns.flatMap((column) => {
    const type = columnTypeOf(column.type, draft.columns);
    return typeof type === 'string'
      ? []
      : [{ name: column.name, from: { column: column.name }, type }];
  });
  const declared = new Set(columns.map((column) => column.name));
  const order =
    draft.order === 'multiset'
      ? ('multiset' as const)
      : draft.order.filter((each) => declared.has(each.column)).map((each) => ({ ...each }));
  try {
    return {
      sql: generatePostgres(
        {
          parameters,
          fetch: { kind: 'builder', format: 1, query },
          columns,
          order: order === 'multiset' || order.length > 0 ? order : 'multiset',
        },
        {},
        'run',
      ).text,
    };
  } catch {
    return { needs: 'Describe the query, and confirm its columns, to see the order it runs in.' };
  }
}

/** Where a column is read in its format (the D6 plan, D6-F): by a pointer, a header or a letter. */
function fromOf(column: ColumnDraft, format: FormatDraft) {
  if (format.format !== 'csv' && format.format !== 'xlsx') {
    return { pointer: column.pointer ?? pointerTo(column.name) };
  }
  if (column.letter !== undefined) return { letter: column.letter };
  return format.headerRow ? { header: column.header ?? column.name } : { letter: 'A' };
}

/**
 * A file's filters as the connector applies them (the D6 plan, D6-J), or the first reason not: each a
 * comparison of a declared column, a fixed value typed as its column is, joined by all or any.
 */
function whereOf(
  file: FileDraft,
  columns: readonly { readonly name: string; readonly type: ColumnType }[],
): FileCondition | undefined | string {
  const comparisons: FileCondition[] = [];
  for (const filter of file.filters) {
    const declared = columns.find((each) => each.name === filter.column);
    if (declared === undefined || declared.type.base === 'image') {
      return `A filter compares a declared column, and ${filter.column} is not one.`;
    }
    if (filter.is === 'isNull' || filter.is === 'isNotNull') {
      comparisons.push({ column: filter.column, is: filter.is });
    } else if ('parameter' in filter.to) {
      comparisons.push({
        column: filter.column,
        is: filter.is,
        to: { parameter: filter.to.parameter },
      });
    } else {
      const type = declared.type as ValueType;
      const { value } = filter.to;
      const literal = canonical(type.base, type.base === 'text' ? value : value.trim());
      comparisons.push({ column: filter.column, is: filter.is, to: { literal, type } });
    }
  }
  if (comparisons.length === 0) return undefined;
  if (comparisons.length === 1) return comparisons[0];
  return file.match === 'any' ? { or: comparisons } : { and: comparisons };
}

/** One draft's parameters, columns and the rest as the service takes them, or the first reason not. */
function parts(draft: DefinitionDraft) {
  const parameters = parametersOf(draft);
  if (typeof parameters === 'string') return parameters;
  const columns = [];
  for (const column of draft.columns) {
    const type = columnTypeOf(column.type, draft.columns);
    if (typeof type === 'string') return `The column ${column.name}: ${type}`;
    // An HTTP response's or a file's column is read as its format reads (the D6 plan, D6-F).
    const from =
      draft.mode === 'http'
        ? fromOf(column, draft.http)
        : draft.mode === 'file'
          ? fromOf(column, draft.file)
          : { column: column.name };
    columns.push({ name: column.name, from, type });
  }
  if (columns.length === 0) {
    return draft.mode === 'builder'
      ? 'Describe the query to propose its columns first.'
      : draft.mode === 'http'
        ? 'Sample the request to propose its columns first.'
        : draft.mode === 'file'
          ? 'Sample the file to propose its columns first.'
          : 'Describe the statement to propose its columns first.';
  }
  const query = draft.mode === 'builder' ? queryOf(draft.builder, draft.order) : null;
  if (typeof query === 'string') return query;
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
  const where = draft.mode === 'file' ? whereOf(draft.file, columns) : undefined;
  if (typeof where === 'string') return where;
  return {
    schemaVersion: 1 as const,
    connection: draft.connection,
    parameters,
    fetch:
      draft.mode === 'file'
        ? {
            kind: 'file' as const,
            key: draft.file.key.map(partOf),
            format: formatOf(draft.file),
            ...(where === undefined ? {} : { where }),
          }
        : draft.mode === 'http'
          ? {
              kind: 'http' as const,
              request: templateOf(draft.http),
              format: formatOf(draft.http),
            }
          : query === null
            ? { kind: 'sql' as const, text: draft.sql }
            : { kind: 'builder' as const, format: 1 as const, query },
    columns,
    key: [...draft.key],
    order:
      draft.order === 'multiset' ? ('multiset' as const) : draft.order.map((each) => ({ ...each })),
    empty: draft.empty,
    limits,
  };
}

/**
 * The parameters a file's key names: what a sample of the file is sent, its filter waiting for the
 * columns the sample proposes (the D6 plan, task 2).
 */
export function keyNamed<T extends { readonly name: string }>(
  draft: Pick<DefinitionDraft, 'file'>,
  parameters: readonly T[],
): T[] {
  return parameters.filter((each) =>
    draft.file.key.some((part) => part.kind === 'parameter' && part.text.trim() === each.name),
  );
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

/**
 * The SQL a definition runs, as its reader is shown it: its own, or what a built query generates from
 * its tree, read-only (DAT-099).
 */
export function sqlOf(definition: QueryDefinition): string {
  // Read by destructuring: the renderer's API test flags any member named for the network.
  const { fetch: statement } = definition;
  if (statement.kind === 'http') return requestText(statement.request);
  if (statement.kind === 'file') return fileText(statement);
  return statement.kind === 'sql' ? statement.text : generatePostgres(definition, {}, 'run').text;
}

/**
 * A stored definition as its page holds it: every column already confirmed. A built query is held as
 * the builder's draft, and its SQL is never offered as SQL to edit: turned to SQL, it starts empty.
 */
export function draftOf(definition: QueryDefinition): DefinitionDraft {
  const { fetch: statement } = definition;
  const built =
    statement.kind === 'builder' ? builderDraftOf(statement.query, definition.order) : null;
  const http = statement.kind === 'http' ? httpDraftOf(statement) : null;
  const file = statement.kind === 'file' ? fileDraftOf(statement) : null;
  return {
    title: definition.title,
    description: definition.description,
    connection: definition.connection,
    mode: statement.kind,
    builder: built === null || 'reason' in built ? NEW_BUILDER : built,
    http: http === null || 'reason' in http ? NEW_HTTP : http,
    file: file === null || 'reason' in file ? NEW_FILE : file,
    sql: statement.kind === 'sql' ? statement.text : '',
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
      ...('pointer' in column.from ? { pointer: column.from.pointer } : {}),
      ...('header' in column.from ? { header: column.from.header } : {}),
      ...('letter' in column.from ? { letter: column.from.letter } : {}),
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
  one.fraction === other.fraction &&
  one.encoding === other.encoding &&
  JSON.stringify(one.description) === JSON.stringify(other.description);

/**
 * Whether a declared type is what the source proposes: an image as its encoding, since a proposal
 * never names a description, which is the author's (D8-A).
 */
const asProposed = (proposed: TypeDraft, declared: TypeDraft) =>
  proposed.base === 'image'
    ? declared.base === 'image' && declared.encoding === proposed.encoding
    : sameType(proposed, declared);

/**
 * The columns as they are, each to be confirmed again, its declared type kept: what the SQL or a
 * parameter changed may have changed what the statement returns, so nothing is saved until the author
 * has looked again (DAT-105).
 */
export function unconfirmed(columns: readonly ColumnDraft[]): ColumnDraft[] {
  return columns.map((column) => (column.confirmed ? { ...column, confirmed: false } : column));
}

/**
 * What the columns are confirmed for: the connection, the SQL or the built query, and its parameters,
 * exactly. A built query's limit is left out: it changes how many rows, never which columns.
 */
export function statementOf(
  draft: Pick<
    DefinitionDraft,
    'connection' | 'mode' | 'builder' | 'sql' | 'http' | 'file' | 'parameters'
  >,
) {
  return JSON.stringify([
    draft.connection,
    draft.mode,
    draft.mode === 'sql'
      ? draft.sql
      : draft.mode === 'http'
        ? draft.http
        : // A file's filters change which rows, never which columns.
          draft.mode === 'file'
          ? { ...draft.file, filters: [], match: 'all' }
          : { ...draft.builder, limit: '' },
    draft.parameters,
  ]);
}

/** The parts of a draft its columns are confirmed for (DAT-105). */
export type StatementParts = Pick<
  Partial<DefinitionDraft>,
  'connection' | 'mode' | 'builder' | 'sql' | 'http' | 'file' | 'parameters'
>;

/**
 * The draft with its connection, SQL or parameters changed. A change withdraws every column's
 * confirmation and keeps its declared type; one that returns the statement to exactly what the columns
 * were last confirmed for gives back the confirmations, where the columns are still exactly those -
 * their names, their order and their declared types.
 */
export function withStatement(held: DefinitionDraft, over: StatementParts): DefinitionDraft {
  const next = { ...held, ...over };
  const before = statementOf(held);
  const after = statementOf(next);
  if (before === after) return next;
  const remembered = held.columns.some((column) => column.confirmed)
    ? { statement: before, columns: held.columns }
    : held.confirmedFor;
  const confirmedFor = remembered === undefined ? {} : { confirmedFor: remembered };
  // Given back only where the columns are still those confirmed - the same names, in the same order,
  // each declared as it was: a describe since may have changed them, and then the author looks again.
  const same =
    remembered !== undefined &&
    remembered.columns.length === next.columns.length &&
    remembered.columns.every(
      (each, at) =>
        each.name === next.columns[at]!.name && sameType(each.type, next.columns[at]!.type),
    );
  if (remembered?.statement === after && same) {
    return {
      ...next,
      ...confirmedFor,
      columns: next.columns.map((column, at) => ({
        ...column,
        confirmed: remembered.columns[at]!.confirmed,
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
    readonly proposed: ProposedType | null;
    readonly pointer?: string;
    readonly header?: string;
    readonly letter?: string;
  }[],
  held: readonly ColumnDraft[],
): ColumnDraft[] {
  return described.map((described) => {
    // An HTTP response's column keeps the pointer its sample read it by.
    const column = described;
    const at = {
      ...(described.pointer === undefined ? {} : { pointer: described.pointer }),
      ...(described.header === undefined ? {} : { header: described.header }),
      ...(described.letter === undefined ? {} : { letter: described.letter }),
    };
    const declared = held.find((each) => each.name === column.name);
    const proposed = column.proposed === null ? null : typeDraftOf(column.proposed);
    if (declared !== undefined && (proposed === null || declared.type.base !== '')) {
      if (proposed !== null && asProposed(proposed, declared.type)) {
        return { ...declared, ...at, sourceType: column.sourceType };
      }
      return {
        ...declared,
        ...at,
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
      ...at,
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
