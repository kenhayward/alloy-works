import type { ColumnRef, Comparison, Condition, Query, SelectItem } from './builder.js';
import type { ValueType } from './columns.js';
import type { DraftDefinition, Parameter } from './definition.js';
import type { ParameterValues } from './parameters.js';
import { BindingRefused, placeholdersIn, type BoundStatement, type BoundValue } from './sql.js';

/**
 * PostgreSQL's SQL generated from the builder's tree (the D4 plan, D4-E to D4-I; DAT-099): pure, and
 * never stored. The connector calls it at every describe and run, the definition's checks on every
 * write, and the page to show the SQL.
 *
 * What it writes (D4-F; DAT-081, DAT-018): every identifier double-quoted, a quote inside doubled, and
 * every relation `"schema"."name"`, read through a derived table of the bare names of exactly the
 * columns the query names of it, `(SELECT "c1", "c2" FROM "schema"."name") AS "alias"`, so no
 * `"alias"."name"` is ever read as a function of the row (`f(alias)`, found through the search path,
 * where the relation has no such column): a bare name in a one-table select list is a column or
 * `42703`; every function, operator and type `pg_catalog`'s by name, so
 * nothing an account makes in a schema of its own can stand in for one; every value, a literal's
 * included, a placeholder `($n::pg_catalog.type)` the driver binds, a parameter used twice bound once;
 * and the limit, a whole number the schema holds, as text. The text is read back as the source will
 * read it, and nothing is answered unless its placeholders are exactly those written.
 *
 * Text compares by code point wherever the builder compares it (D4-G): a text filter compares
 * `(x)::pg_catalog.text COLLATE pg_catalog."C"`, and a text-declared column is ordered by that key,
 * grouped by itself and it, and its minimum and maximum taken over it - in a nested query too, where
 * a text-declared column reads one of its columns. The collation is named by its schema as a function
 * is: an unqualified one is found through the search path, where an account can plant a nondeterministic
 * "C" of its own before `pg_catalog`.
 *
 * Two statements come of one tree (D4-H): the **shape** - sources, joins, select, where and group by,
 * with no key in its select, its grouping or an order, and no order or limit - which a describe
 * proposes columns from and a run admits each column by; and the **run**, with the keys, the declared
 * order and the limit.
 */

/** PostgreSQL's type for a value of each base, as `pg_catalog` names it. */
const TYPES = {
  text: 'text',
  integer: 'int8',
  decimal: 'numeric',
  date: 'date',
  time: 'time',
  localDateTime: 'timestamp',
  instant: 'timestamptz',
  boolean: 'bool',
} as const satisfies Record<ValueType['base'], string>;

const OPERATORS: Partial<Record<Comparison, string>> = {
  equal: '=',
  notEqual: '<>',
  less: '<',
  lessOrEqual: '<=',
  greater: '>',
  greaterOrEqual: '>=',
};

/** An identifier, double-quoted, a quote inside it doubled. */
export const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** The code-point key of an expression: its text, compared byte by byte (D4-G). */
const codePointKey = (expression: string) =>
  `(${expression})::pg_catalog.text COLLATE pg_catalog."C"`;

const columnText = (ref: ColumnRef) =>
  `${quoteIdentifier(ref.source)}.${quoteIdentifier(ref.column)}`;

const asText = (value: string | boolean) => (typeof value === 'boolean' ? String(value) : value);

/** What a generation needs of a definition: its parameters, the tree, and its declared columns. */
export type Generable = Pick<DraftDefinition, 'parameters' | 'fetch' | 'columns' | 'order'>;

/**
 * The statement a builder definition runs as, or its shape, with its values in their places. Throws
 * `BindingRefused` where the text, read back, does not hold exactly the placeholders written. The
 * values have passed `checkParameterValues`, and the definition its checks.
 */
export function generatePostgres(
  definition: Generable,
  values: ParameterValues,
  statement: 'shape' | 'run',
): BoundStatement {
  const { fetch } = definition;
  if (fetch.kind !== 'builder') throw new Error('Only a built query is generated; SQL is bound');
  const keyed = statement === 'run';
  const declared = new Map<string, Parameter>(
    definition.parameters.map((parameter) => [parameter.name, parameter]),
  );
  const bound: BoundValue[] = [];
  const numbers = new Map<string, number>();
  const written: number[] = [];

  /** A new value's number: a parameter's once, however often it is compared, a literal's each time. */
  const bind = (value: BoundValue, parameter?: string): number => {
    const known = parameter === undefined ? undefined : numbers.get(parameter);
    if (known !== undefined) return known;
    bound.push(value);
    if (parameter !== undefined) numbers.set(parameter, bound.length);
    return bound.length;
  };
  /** The placeholder of a value's number, each place it is written counted for the read-back. */
  const placeholder = (number: number, type: ValueType, list: boolean) => {
    written.push(number);
    return `($${number}::pg_catalog.${TYPES[type.base]}${list ? '[]' : ''})`;
  };
  const toBound = (value: unknown): BoundValue =>
    value === null || value === undefined
      ? null
      : Array.isArray(value)
        ? value.map((item) => asText(item as string | boolean))
        : asText(value as string | boolean);

  const comparison = (
    is: Comparison,
    column: string,
    value: () => string,
    type: ValueType,
  ): string => {
    // A text value is compared with the column's code-point key, which also lets a text parameter
    // compare with an enum or a uuid at all (Q2).
    const left = type.base === 'text' ? codePointKey(column) : column;
    switch (is) {
      case 'in':
        return `${left} OPERATOR(pg_catalog.=) ANY (${value()})`;
      case 'contains':
        return `pg_catalog.strpos(${left}, ${value()}) OPERATOR(pg_catalog.>) 0`;
      case 'startsWith':
        return `pg_catalog.starts_with(${left}, ${value()})`;
      default:
        return `${left} OPERATOR(pg_catalog.${OPERATORS[is]!}) ${value()}`;
    }
  };

  const condition = (node: Condition): string => {
    if ('and' in node) return `(${node.and.map(condition).join(' AND ')})`;
    if ('or' in node) return `(${node.or.map(condition).join(' OR ')})`;
    if ('not' in node) return `(NOT ${condition(node.not)})`;
    const column = columnText(node.column);
    const { is, to } = node;
    if (is === 'isNull') return `${column} IS NULL`;
    if (is === 'isNotNull') return `${column} IS NOT NULL`;
    if (to === undefined) throw new Error(`The comparison ${is} compares with nothing`);
    if ('column' in to) {
      // Two columns compare by PostgreSQL's built-in operator for their types, `pg_catalog`'s, not a
      // type's own: two `citext` columns compare as text, by their collation, not case-blind.
      return `${column} OPERATOR(pg_catalog.${OPERATORS[is]!}) ${columnText(to.column)}`;
    }
    if ('parameter' in to) {
      const parameter = declared.get(to.parameter);
      if (parameter === undefined) throw new Error(`${to.parameter} is not a declared parameter`);
      const value = Object.hasOwn(values, parameter.name) ? values[parameter.name] : null;
      const number = bind(toBound(value), parameter.name);
      const write = () => placeholder(number, parameter.type, parameter.list);
      // An optional parameter given no value is true, in the same text whatever it is given (DAT-018).
      // Each placeholder is written in the order it is read.
      if (parameter.required) return comparison(is, column, write, parameter.type);
      const absent = `${write()} IS NULL`;
      return `(${absent} OR ${comparison(is, column, write, parameter.type)})`;
    }
    const number = bind(toBound(to.literal));
    return comparison(
      is,
      column,
      () => placeholder(number, to.type, Array.isArray(to.literal)),
      to.type,
    );
  };

  /** The select item's expression, its minimum or maximum over the code-point key where textual. */
  const itemExpression = (item: SelectItem, textual: boolean): string => {
    if (!('aggregate' in item.of)) return columnText(item.of);
    const { aggregate, of, places } = item.of;
    const column = of === undefined ? '*' : columnText(of);
    switch (aggregate) {
      case 'count':
        return `pg_catalog.count(${column})`;
      case 'sum':
        return `pg_catalog.sum(${column})`;
      case 'average':
        return `pg_catalog.round(pg_catalog.avg(${column}), ${places ?? 0})`;
      case 'minimum':
        return `pg_catalog.min(${textual ? codePointKey(column) : column})`;
      case 'maximum':
        return `pg_catalog.max(${textual ? codePointKey(column) : column})`;
    }
  };

  /**
   * Each table source's columns the query names of it - in its select, its aggregates, its joins'
   * conditions, its where and its grouping, in that order - each once, by alias. A nested query's own
   * columns are its select names, which the builder's checks hold it to.
   */
  const namedColumns = (node: Query): Map<string, string[]> => {
    const named = new Map<string, string[]>();
    for (const source of node.sources) if ('table' in source) named.set(source.alias, []);
    const name = (ref: ColumnRef) => {
      const columns = named.get(ref.source);
      if (columns !== undefined && !columns.includes(ref.column)) columns.push(ref.column);
    };
    const visit = (each: Condition): void => {
      if ('and' in each) each.and.forEach(visit);
      else if ('or' in each) each.or.forEach(visit);
      else if ('not' in each) visit(each.not);
      else {
        name(each.column);
        if (each.to !== undefined && 'column' in each.to) name(each.to.column);
      }
    };
    for (const item of node.select) {
      if (!('aggregate' in item.of)) name(item.of);
      else if (item.of.of !== undefined) name(item.of.of);
    }
    for (const join of node.joins) visit(join.on);
    if (node.where !== undefined) visit(node.where);
    node.groupBy.forEach(name);
    return named;
  };

  /** A query's clauses, in the order its text is read, so its values are numbered in that order. */
  const query = (node: Query, textual: ReadonlySet<string>, top: boolean): string[] => {
    const tableColumns = namedColumns(node);
    // A nested query's column is textual where a textual column of this one reads it.
    const nested = new Map<string, Set<string>>();
    for (const item of node.select) {
      if (!textual.has(item.name)) continue;
      const read = 'aggregate' in item.of ? item.of.of : item.of;
      if (read === undefined) continue;
      if (!nested.has(read.source)) nested.set(read.source, new Set());
      nested.get(read.source)!.add(read.column);
    }
    const source = (at: number) => {
      const each = node.sources[at]!;
      const alias = quoteIdentifier(each.alias);
      if ('table' in each) {
        // A table is read through a derived table of the bare names of exactly the columns the query
        // names of it (D4-F): a bare name in a one-table select list is a column or `42703`, never a
        // function of the row, and every `"alias"."name"` outside then names a column the derived
        // table has. Not LATERAL, so nothing in it can read another source.
        const relation = `${quoteIdentifier(each.table.schema)}.${quoteIdentifier(each.table.name)}`;
        const columns = (tableColumns.get(each.alias) ?? []).map(quoteIdentifier).join(', ');
        return `(SELECT ${columns === '' ? '' : `${columns} `}FROM ${relation}) AS ${alias}`;
      }
      const inner = query(each.query, nested.get(each.alias) ?? new Set(), false);
      return `(${inner.join(' ')}) AS ${alias}`;
    };

    const items = node.select.map(
      (item) =>
        `${itemExpression(item, keyed && textual.has(item.name))} AS ${quoteIdentifier(item.name)}`,
    );
    const lines = [`SELECT ${items.join(', ')}`, `FROM ${source(0)}`];
    for (const [at, join] of node.joins.entries()) {
      const kind = join.kind === 'inner' ? 'INNER' : 'LEFT';
      // The source's text, then its condition's: the order they are read in.
      const joined = source(at + 1);
      lines.push(`${kind} JOIN ${joined} ON ${condition(join.on)}`);
    }
    if (node.where !== undefined) lines.push(`WHERE ${condition(node.where)}`);

    if (node.groupBy.length > 0) {
      // A textual column selected is grouped by itself and its key, so values the source's collation
      // calls equal stay apart, each showing its own spelling (Q2).
      const keyedGroups = new Set(
        node.select.flatMap((item) =>
          keyed && textual.has(item.name) && !('aggregate' in item.of)
            ? [JSON.stringify([item.of.source, item.of.column])]
            : [],
        ),
      );
      const groups = node.groupBy.flatMap((ref) => {
        const column = columnText(ref);
        return keyedGroups.has(JSON.stringify([ref.source, ref.column]))
          ? [column, codePointKey(column)]
          : [column];
      });
      lines.push(`GROUP BY ${groups.join(', ')}`);
    }

    if (top && keyed) {
      const order = definition.order;
      if (order !== 'multiset') {
        const byName = new Map(definition.columns.map((column) => [column.name, column]));
        const byItem = new Map(node.select.map((item) => [item.name, item]));
        const keys = order.map(({ column, direction }) => {
          const declaredColumn = byName.get(column);
          const item =
            declaredColumn && 'column' in declaredColumn.from
              ? byItem.get(declaredColumn.from.column)
              : undefined;
          if (declaredColumn === undefined || item === undefined) {
            throw new Error(`The order names ${column}, which the query does not select`);
          }
          const text = declaredColumn.type.base === 'text';
          const expression = itemExpression(item, text);
          const sorted = text ? codePointKey(expression) : expression;
          // Nulls as D2-M orders them: last ascending, first descending.
          return `${sorted} ${direction === 'ascending' ? 'ASC NULLS LAST' : 'DESC NULLS FIRST'}`;
        });
        lines.push(`ORDER BY ${keys.join(', ')}`);
      }
      if (node.limit !== undefined) lines.push(`LIMIT ${String(Math.trunc(node.limit))}`);
    }
    return lines;
  };

  const textual = new Set(
    definition.columns.flatMap((column) =>
      column.type.base === 'text' && 'column' in column.from ? [column.from.column] : [],
    ),
  );
  const text = query(fetch.query, textual, true).join('\n');

  // Read back as the source will read it: nothing is answered unless the placeholders outside every
  // literal and comment are exactly those written.
  const found = placeholdersIn(text);
  if (found === undefined || found.join(',') !== written.join(',')) {
    throw new BindingRefused('The generated SQL does not hold exactly the placeholders written');
  }
  return { text, values: bound };
}

/**
 * The length of each statement a builder definition generates, as `RAN_MAX_CHARACTERS` counts it: a
 * tree has no variation, so its text is one whatever its values.
 */
export function generatedLength(definition: Generable): { shape: number; run: number } {
  return {
    shape: generatePostgres(definition, {}, 'shape').text.length,
    run: generatePostgres(definition, {}, 'run').text.length,
  };
}
