import { z } from 'zod';

import { valueProblem, type CanonicalValue } from './canonical.js';
import { MAX_COLUMNS, valueTypeSchema, type ValueType } from './columns.js';
import type { DraftDefinition, Parameter } from './definition.js';
import { limitCeilings } from './limits.js';
import { MAX_LIST_ITEMS } from './parameters.js';
import { canonicalValueSchema, PARAMETER_NAME, sourceName } from './primitives.js';

/**
 * The builder's stored tree, format 1 (data.md, "The fetch"; the D4 plan, D4-B, D4-C, D4-L, D4-M): a
 * query's sources, joined, the columns it selects, a condition, a grouping and, at the top alone, a
 * limit. A definition holds the tree and never its SQL, which is generated from it at every describe
 * and every run (DAT-099). Each member is widened later by adding a member, never by changing one, so
 * no stored tree migrates (DAT-100).
 */
export const BUILDER_FORMAT = 1;

/** A column of a source in scope: a table's column, or a nested query's select name. */
export type ColumnRef = { source: string; column: string };

/** What a comparison compares its column with: a parameter, a fixed value, or another column. */
export type Operand =
  | { parameter: string }
  | { literal: CanonicalValue | CanonicalValue[]; type: ValueType }
  | { column: ColumnRef };

export const comparisons = [
  'equal',
  'notEqual',
  'less',
  'lessOrEqual',
  'greater',
  'greaterOrEqual',
  'in',
  'contains',
  'startsWith',
  'isNull',
  'isNotNull',
] as const;
export type Comparison = (typeof comparisons)[number];

export type Condition =
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition }
  | { column: ColumnRef; is: Comparison; to?: Operand | undefined };

export const aggregates = ['count', 'sum', 'average', 'minimum', 'maximum'] as const;
export type AggregateName = (typeof aggregates)[number];
export type Aggregate = {
  aggregate: AggregateName;
  of?: ColumnRef | undefined;
  places?: number | undefined;
};

export type Source =
  { alias: string; table: { schema: string; name: string } } | { alias: string; query: Query };

export type Join = { kind: 'inner' | 'left'; source: string; on: Condition };
export type SelectItem = { name: string; of: ColumnRef | Aggregate };

export type Query = {
  sources: Source[];
  joins: Join[];
  select: SelectItem[];
  where?: Condition | undefined;
  groupBy: ColumnRef[];
  limit?: number | undefined;
};

export type BuilderFetch = { kind: 'builder'; format: 1; query: Query };

/** The bounds the walk holds a tree to before the schema recurses into it (D4-L). */
export const BUILDER_BOUNDS = {
  /** A query nests at most this deep: the top and three nested. */
  queryDepth: 4,
  /** A condition nests at most this deep, its comparisons counted as a level. */
  conditionDepth: 8,
  sources: 16,
  /** An `and` and an `or` hold at least two conditions and at most this many. */
  conditions: 32,
  comparisons: 256,
  groupings: 32,
} as const;

const columnRefSchema = z.strictObject({
  source: z.string(),
  column: sourceName('A column'),
});

const operandSchema = z.union([
  z.strictObject({ parameter: z.string() }),
  z.strictObject({
    literal: z.union([canonicalValueSchema, z.array(canonicalValueSchema).max(MAX_LIST_ITEMS)]),
    type: valueTypeSchema,
  }),
  z.strictObject({ column: columnRefSchema }),
]);

// The tree is recursive. Its depth and breadth are the walk's to bound, before this runs: the schema
// alone throws a RangeError some way under a thousand levels (Q3), so `and` and `or` take any length
// here and the walk refuses fewer than two or more than 32.
const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ and: z.array(conditionSchema) }),
    z.strictObject({ or: z.array(conditionSchema) }),
    z.strictObject({ not: conditionSchema }),
    z.strictObject({
      column: columnRefSchema,
      is: z.enum(comparisons),
      to: operandSchema.optional(),
    }),
  ]),
);

const aggregateSchema = z.strictObject({
  aggregate: z.enum(aggregates),
  of: columnRefSchema.optional(),
  places: z.number().int().min(0).max(1000).optional(),
});

const alias = z.string().regex(PARAMETER_NAME, {
  message:
    'An alias is a lower-case letter, then up to 62 lower-case letters, digits or underscores',
});

const querySchema: z.ZodType<Query> = z.lazy(() =>
  z.strictObject({
    sources: z
      .array(
        z.union([
          z.strictObject({
            alias,
            table: z.strictObject({ schema: sourceName('A schema'), name: sourceName('A name') }),
          }),
          z.strictObject({ alias, query: querySchema }),
        ]),
      )
      .min(1),
    joins: z.array(
      z.strictObject({ kind: z.enum(['inner', 'left']), source: z.string(), on: conditionSchema }),
    ),
    select: z
      .array(
        z.strictObject({
          name: sourceName('A select name'),
          of: z.union([columnRefSchema, aggregateSchema]),
        }),
      )
      .min(1)
      .max(MAX_COLUMNS),
    where: conditionSchema.optional(),
    groupBy: z.array(columnRefSchema),
    limit: z.number().int().min(1).max(limitCeilings.rows).optional(),
  }),
);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The tree's depth and breadth, counted by an iterative walk before the schema recurses into it (D4-L,
 * Q3): a query nests at most 4 deep, a condition at most 8; a query has at most 16 sources and 32
 * groupings, an `and` or an `or` 2 to 32 conditions, and a definition at most 256 comparisons. It
 * follows only the members that recurse, takes whatever it is given, and stops at the first bound
 * passed, so a hostile body nested 100,000 deep is refused by name rather than throwing.
 */
export function treeProblem(value: unknown): string | undefined {
  type Visit = { kind: 'query' | 'condition'; value: unknown; depth: number };
  const stack: Visit[] = [{ kind: 'query', value, depth: 1 }];
  let compared = 0;
  for (let visit = stack.pop(); visit !== undefined; visit = stack.pop()) {
    const { kind, depth } = visit;
    if (!isObject(visit.value)) continue;
    const node = visit.value;
    if (kind === 'query') {
      if (depth > BUILDER_BOUNDS.queryDepth) {
        return `A query nests at most ${BUILDER_BOUNDS.queryDepth} deep: the top and three nested`;
      }
      const { sources, joins, where, groupBy } = node;
      if (Array.isArray(sources)) {
        if (sources.length > BUILDER_BOUNDS.sources) {
          return `A query has at most ${BUILDER_BOUNDS.sources} sources`;
        }
        for (const source of sources) {
          if (isObject(source) && 'query' in source) {
            stack.push({ kind: 'query', value: source.query, depth: depth + 1 });
          }
        }
      }
      if (Array.isArray(joins)) {
        if (joins.length > BUILDER_BOUNDS.sources) {
          return `A query has at most ${BUILDER_BOUNDS.sources} sources`;
        }
        for (const join of joins) {
          if (isObject(join)) stack.push({ kind: 'condition', value: join.on, depth: 1 });
        }
      }
      if (Array.isArray(groupBy) && groupBy.length > BUILDER_BOUNDS.groupings) {
        return `A query groups by at most ${BUILDER_BOUNDS.groupings} columns`;
      }
      stack.push({ kind: 'condition', value: where, depth: 1 });
      continue;
    }
    if (depth > BUILDER_BOUNDS.conditionDepth) {
      return `A condition nests at most ${BUILDER_BOUNDS.conditionDepth} deep`;
    }
    for (const member of ['and', 'or'] as const) {
      const conditions = node[member];
      if (conditions === undefined) continue;
      if (!Array.isArray(conditions)) continue;
      if (conditions.length < 2 || conditions.length > BUILDER_BOUNDS.conditions) {
        return `An and or an or holds 2 to ${BUILDER_BOUNDS.conditions} conditions`;
      }
      for (const condition of conditions) {
        stack.push({ kind: 'condition', value: condition, depth: depth + 1 });
      }
    }
    if ('not' in node) stack.push({ kind: 'condition', value: node.not, depth: depth + 1 });
    if ('is' in node) {
      compared += 1;
      if (compared > BUILDER_BOUNDS.comparisons) {
        return `A definition has at most ${BUILDER_BOUNDS.comparisons} comparisons`;
      }
    }
  }
  return undefined;
}

/** The builder's fetch (D4-A): format 1's tree, its depth and breadth walked before it is parsed. */
export const builderFetchSchema = z.strictObject({
  kind: z.literal('builder'),
  format: z.literal(BUILDER_FORMAT),
  query: builderQuerySchema(),
});

/** A query, walked first: the walk's refusal is the query's, and the schema never meets the tree. */
export function builderQuerySchema(): z.ZodType<Query> {
  return z.preprocess((value, context) => {
    const problem = treeProblem(value);
    if (problem !== undefined) context.addIssue({ code: 'custom', message: problem, input: value });
    return value;
  }, querySchema) as unknown as z.ZodType<Query>;
}

export type Problem = (path: string, message: string) => void;

/** The bases a less, a greater and their kin compare: numbers and the four times (D4-C, D4-G). */
const ORDERED = new Set<ValueType['base']>([
  'integer',
  'decimal',
  'date',
  'time',
  'localDateTime',
  'instant',
]);
const RANGES: readonly Comparison[] = ['less', 'lessOrEqual', 'greater', 'greaterOrEqual'];
/** The comparisons a text value takes (D4-M). */
const TEXTUAL: readonly Comparison[] = ['equal', 'notEqual', 'in', 'contains', 'startsWith'];

const INT8_MIN = -(2n ** 63n);
const INT8_MAX = 2n ** 63n - 1n;

/** What a source in scope offers: a table, whose columns the source knows, or a nested query's names. */
type InScope = { readonly table: true } | { readonly names: ReadonlySet<string> };

/** Why a value of this type cannot be compared this way, or undefined where it can (D4-C, D4-G). */
function typeProblem(is: Comparison, type: ValueType): string | undefined {
  if (RANGES.includes(is) && !ORDERED.has(type.base)) {
    return 'Less and greater compare a number, a date or a time; text is compared by equal, contains or starts with';
  }
  if ((is === 'contains' || is === 'startsWith') && type.base !== 'text') {
    return 'Contains and starts with compare text';
  }
  if (type.base === 'text' && !TEXTUAL.includes(is)) {
    return 'Text is compared by equal, not equal, in, contains or starts with';
  }
  return undefined;
}

/** A fixed value's problem against its type: canonical, never null, an integer within 64 bits. */
function literalProblem(type: ValueType, value: CanonicalValue): boolean {
  if (value === null || valueProblem(type, value) !== null) return true;
  if (type.base === 'integer') {
    const number = BigInt(value as string);
    return number < INT8_MIN || number > INT8_MAX;
  }
  return false;
}

/**
 * The tree's rules beyond the shape (the D4 plan's stored-shape check, rows 3 to 9): aliases once each
 * in their query; each source after the first joined once, in order, its condition naming only sources
 * at or before it; select names once each, an aggregate's column and places as it takes them; every
 * column reference in scope; every comparison's operand of a kind and type it takes; grouping distinct
 * and covering every column selected beside an aggregate; a limit at the top alone; and the parameters
 * declaring no variation, each used, and only as its kind allows. A describe holds a query to these.
 */
export function checkTree(query: Query, parameters: readonly Parameter[], problem: Problem): void {
  const declared = new Map<string, Parameter>();
  for (const parameter of parameters) {
    if (!declared.has(parameter.name)) declared.set(parameter.name, parameter);
  }
  const used = new Set<string>();

  for (const [at, parameter] of parameters.entries()) {
    if (parameter.variation !== undefined) {
      problem(
        `parameters.${at}.variation`,
        "A built query's parameter declares no variation: a variation places SQL, which a built query has none of",
      );
    }
  }

  const operand = (
    comparison: Extract<Condition, { column: ColumnRef }>,
    scope: ReadonlyMap<string, InScope>,
    path: string,
  ) => {
    const { is, to } = comparison;
    if (is === 'isNull' || is === 'isNotNull') {
      if (to !== undefined) problem(`${path}.to`, 'Is empty and is not empty compare with nothing');
      return;
    }
    if (to === undefined) {
      problem(
        `${path}.to`,
        'A comparison compares its column with a parameter, a value or a column',
      );
      return;
    }
    if ('column' in to) {
      if (!RANGES.includes(is) && is !== 'equal' && is !== 'notEqual') {
        problem(`${path}.to`, 'Two columns are compared by equal, not equal, less or greater');
      }
      reference(to.column, scope, `${path}.to.column`);
      return;
    }
    if ('parameter' in to) {
      const parameter = declared.get(to.parameter);
      if (parameter === undefined) {
        problem(
          `${path}.to.parameter`,
          `The comparison names ${to.parameter}, which is not a declared parameter`,
        );
        return;
      }
      used.add(parameter.name);
      if (parameter.list !== (is === 'in')) {
        problem(
          `${path}.to.parameter`,
          parameter.list
            ? `The parameter ${parameter.name} is a list, which is compared by in alone`
            : `In compares a column with a list, and ${parameter.name} is not one`,
        );
        return;
      }
      const wrong = typeProblem(is, parameter.type);
      if (wrong !== undefined) problem(`${path}.is`, wrong);
      return;
    }
    const { literal, type } = to;
    if (Array.isArray(literal) !== (is === 'in')) {
      problem(
        `${path}.to.literal`,
        Array.isArray(literal)
          ? 'A list of values is compared by in alone'
          : 'In compares a column with a list of values',
      );
      return;
    }
    const values = Array.isArray(literal) ? literal : [literal];
    if (Array.isArray(literal) && (literal.length < 1 || literal.length > MAX_LIST_ITEMS)) {
      problem(`${path}.to.literal`, `A list of values holds 1 to ${MAX_LIST_ITEMS}`);
    }
    for (const value of values) {
      if (literalProblem(type, value)) {
        problem(
          `${path}.to.literal`,
          "A value is written in its type's canonical form, and is never empty",
        );
        break;
      }
    }
    const wrong = typeProblem(is, type);
    if (wrong !== undefined) problem(`${path}.is`, wrong);
  };

  const condition = (node: Condition, scope: ReadonlyMap<string, InScope>, path: string): void => {
    if ('and' in node) {
      node.and.forEach((each, at) => condition(each, scope, `${path}.and.${at}`));
    } else if ('or' in node) {
      node.or.forEach((each, at) => condition(each, scope, `${path}.or.${at}`));
    } else if ('not' in node) {
      condition(node.not, scope, `${path}.not`);
    } else {
      reference(node.column, scope, `${path}.column`);
      operand(node, scope, path);
    }
  };

  const reference = (ref: ColumnRef, scope: ReadonlyMap<string, InScope>, path: string) => {
    const source = scope.get(ref.source);
    if (source === undefined) {
      problem(
        `${path}.source`,
        `The column names the source ${ref.source}, which is not in scope here`,
      );
      return;
    }
    if ('names' in source && !source.names.has(ref.column)) {
      problem(`${path}.column`, `The query ${ref.source} selects no column ${ref.column}`);
    }
  };

  const check = (node: Query, path: string, top: boolean): void => {
    const scope = new Map<string, InScope>();
    const inOrder: string[] = [];
    for (const [at, source] of node.sources.entries()) {
      if (scope.has(source.alias)) {
        problem(`${path}.sources.${at}.alias`, 'A source is named once in its query');
      }
      if ('query' in source) {
        check(source.query, `${path}.sources.${at}.query`, false);
        scope.set(source.alias, { names: new Set(source.query.select.map((item) => item.name)) });
      } else scope.set(source.alias, { table: true });
      inOrder.push(source.alias);
    }

    if (node.joins.length !== node.sources.length - 1) {
      problem(`${path}.joins`, 'Each source after the first is joined once, in the order listed');
    }
    for (const [at, join] of node.joins.entries()) {
      if (join.source !== inOrder[at + 1]) {
        problem(
          `${path}.joins.${at}.source`,
          'Each source after the first is joined once, in the order listed',
        );
      }
      // A join's condition names the sources at or before it.
      const before = new Map([...scope].filter(([name]) => inOrder.indexOf(name) <= at + 1));
      condition(join.on, before, `${path}.joins.${at}.on`);
    }

    const names = new Set<string>();
    let aggregated = false;
    for (const [at, item] of node.select.entries()) {
      const here = `${path}.select.${at}`;
      if (names.has(item.name)) problem(`${here}.name`, 'A select name is used once in its query');
      names.add(item.name);
      if ('aggregate' in item.of) {
        aggregated = true;
        const { aggregate, of, places } = item.of;
        if (of === undefined) {
          if (aggregate !== 'count')
            problem(`${here}.of.of`, `A ${aggregate} is taken of a column`);
        } else reference(of, scope, `${here}.of.of`);
        if (aggregate === 'average' && places === undefined) {
          problem(`${here}.of.places`, 'An average is rounded to the places it declares');
        }
        if (aggregate !== 'average' && places !== undefined) {
          problem(`${here}.of.places`, 'Only an average is rounded to places');
        }
      } else reference(item.of, scope, `${here}.of`);
    }

    if (node.where !== undefined) condition(node.where, scope, `${path}.where`);

    const grouped = new Set<string>();
    for (const [at, ref] of node.groupBy.entries()) {
      const key = JSON.stringify([ref.source, ref.column]);
      if (grouped.has(key)) problem(`${path}.groupBy.${at}`, 'A column is grouped by once');
      grouped.add(key);
      reference(ref, scope, `${path}.groupBy.${at}`);
    }
    if (aggregated || node.groupBy.length > 0) {
      for (const [at, item] of node.select.entries()) {
        if ('aggregate' in item.of) continue;
        if (!grouped.has(JSON.stringify([item.of.source, item.of.column]))) {
          problem(
            `${path}.select.${at}.of`,
            `A query that groups or summarises groups by every column it selects; ${item.name} is not grouped`,
          );
        }
      }
    }

    if (!top && node.limit !== undefined) {
      problem(`${path}.limit`, 'A limit is set on the whole query alone, never a nested one');
    }
  };

  check(query, 'fetch.query', true);

  for (const [at, parameter] of parameters.entries()) {
    if (!used.has(parameter.name) && declared.get(parameter.name) === parameter) {
      problem(`parameters.${at}`, `No comparison uses the parameter ${parameter.name}`);
    }
  }
}

/**
 * The builder's rules (rows 3 to 11): the tree's, then a limit only beside a declared order, and every
 * select item declared as exactly one column, no column reading anything else, an average's column a
 * decimal of scale at least its places or an integer at none (D4-I, D4-N).
 */
export function checkBuilder(
  definition: Pick<DraftDefinition, 'parameters' | 'columns' | 'order'> & {
    readonly fetch: BuilderFetch;
  },
  problem: Problem,
): void {
  const { query } = definition.fetch;
  checkTree(query, definition.parameters, problem);

  if (query.limit !== undefined && definition.order === 'multiset') {
    problem(
      'fetch.query.limit',
      'A limit is set only beside a declared order: over rows in no order it would choose them arbitrarily',
    );
  }

  // Every select item is declared as exactly one column, and no column reads anything else (D4-N).
  const items = new Map(query.select.map((item) => [item.name, item]));
  const declaredBy = new Map<string, number>();
  for (const [at, column] of definition.columns.entries()) {
    const item = items.get(column.from.column);
    if (item === undefined) {
      problem(
        `columns.${at}.from.column`,
        `The column reads ${column.from.column}, which the query does not select`,
      );
      continue;
    }
    if (declaredBy.has(column.from.column)) {
      problem(`columns.${at}.from.column`, `${column.from.column} is declared as one column alone`);
      continue;
    }
    declaredBy.set(column.from.column, at);
    if ('aggregate' in item.of && item.of.aggregate === 'average' && item.of.places !== undefined) {
      const { places } = item.of;
      const { type } = column;
      const fits =
        (type.base === 'decimal' && type.scale >= places) ||
        (type.base === 'integer' && places === 0);
      if (!fits) {
        problem(
          `columns.${at}.type`,
          `An average to ${places} places is declared a decimal of at least ${places} places${places === 0 ? ', or an integer' : ''}`,
        );
      }
    }
  }
  for (const [at, item] of query.select.entries()) {
    if (!declaredBy.has(item.name)) {
      problem(`fetch.query.select.${at}`, `${item.name} is selected and declared as no column`);
    }
  }
}
