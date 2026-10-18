import type { Aggregate, ColumnRef, Condition, Query } from './builder.js';
import { compareCanonical, type CanonicalValue } from './canonical.js';
import type { ColumnType } from './columns.js';
import type { Parameter } from './definition.js';
import { compared } from './file-filter.js';
import type { ParameterValues } from './parameters.js';

/**
 * **A stored result queried as a source of its own** (DAT-094; data.md, "A dataset as a source"; the
 * R21 plan, R21-A): the builder's own tree over one dataset version's rows, evaluated here rather than
 * by a source - its columns, condition, grouping and aggregates, as `generatePostgres` would have the
 * database evaluate them. Never the source the dataset came from.
 */

/** A dataset version's result as a source: each column's name and declared type, and its rows. */
export interface DatasetSource {
  readonly columns: readonly (readonly [name: string, type: ColumnType])[];
  readonly rows: readonly (readonly CanonicalValue[])[];
}

type Problem = (path: string, message: string) => void;

const NUMBERS = new Set(['integer', 'decimal']);

/**
 * A dataset query's rules beyond the builder's tree (R21-A): one source, a table standing for the
 * result, joined to nothing and nesting nothing; every column it names one the result has; a sum or an
 * average only of a number. `checkBuilder` holds it to the rest, as it does any built query.
 */
export function checkDatasetQuery(
  query: Query,
  columns: DatasetSource['columns'],
  parameters: readonly Parameter[],
  problem: Problem,
): void {
  const [source] = query.sources;
  if (
    query.sources.length !== 1 ||
    query.joins.length > 0 ||
    source === undefined ||
    !('table' in source)
  ) {
    problem('fetch.query.sources', 'A stored result is queried as one source, joined to nothing');
    return;
  }
  const types = new Map(columns.map(([name, type]) => [name, type]));
  const named = (ref: ColumnRef, path: string) => {
    if (ref.source !== source.alias || !types.has(ref.column)) {
      problem(path, `The stored result has no column ${ref.column}`);
      return undefined;
    }
    return types.get(ref.column)!;
  };
  for (const [at, item] of query.select.entries()) {
    const path = `fetch.query.select.${at}.of`;
    if (!('aggregate' in item.of)) {
      named(item.of, path);
      continue;
    }
    const { aggregate, of } = item.of;
    if (of === undefined) continue;
    const type = named(of, path);
    if (type && (aggregate === 'sum' || aggregate === 'average') && !NUMBERS.has(type.base)) {
      problem(path, `Only a number is summed or averaged: ${of.column} is ${type.base}`);
    }
  }
  for (const [at, ref] of query.groupBy.entries()) named(ref, `fetch.query.groupBy.${at}`);
  const walk = (condition: Condition, path: string) => {
    if ('and' in condition) condition.and.forEach((each, at) => walk(each, `${path}.and.${at}`));
    else if ('or' in condition) condition.or.forEach((each, at) => walk(each, `${path}.or.${at}`));
    else if ('not' in condition) walk(condition.not, `${path}.not`);
    else {
      const type = named(condition.column, `${path}.column`);
      const { to } = condition;
      const against =
        to === undefined
          ? undefined
          : 'column' in to
            ? named(to.column, `${path}.to.column`)
            : 'parameter' in to
              ? parameters.find((each) => each.name === to.parameter)?.type
              : to.type;
      if (type === undefined) return;
      if ((condition.is === 'contains' || condition.is === 'startsWith') && type.base !== 'text') {
        problem(
          `${path}.is`,
          `Only text is searched for contained text: ${condition.column.column} is ${type.base}`,
        );
        return;
      }
      // Held to the column's own type, as a source's cast would hold it: a whole number may stand
      // for a decimal, and nothing else for anything but its own (the R21 final review).
      if (
        against !== undefined &&
        against.base !== type.base &&
        !(type.base === 'decimal' && against.base === 'integer')
      ) {
        problem(
          `${path}.to`,
          `${condition.column.column} is ${type.base}, compared only with ${type.base}`,
        );
      }
    }
  };
  if (query.where !== undefined) walk(query.where, 'fetch.query.where');
}

/** A decimal or an integer as a scaled big integer, and back. */
const scaledOf = (value: string, scale: number): bigint => {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const magnitude =
    BigInt(whole!) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
  return negative ? -magnitude : magnitude;
};
const canonicalOf = (scaled: bigint, scale: number): string => {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  const text = fraction === '' ? whole : `${whole}.${fraction}`;
  return negative && text !== '0' ? `-${text}` : text;
};
const scaleOf = (value: string) => value.split('.')[1]?.length ?? 0;

/** A quotient rounded half away from zero, as the database's `round` rounds a numeric. */
const roundedDivide = (numerator: bigint, denominator: bigint): bigint => {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n * 2n + d) / (d * 2n);
  return negative ? -quotient : quotient;
};

function aggregated(
  aggregate: Aggregate,
  rows: readonly (readonly CanonicalValue[])[],
  at: number | undefined,
  type: ColumnType | undefined,
): CanonicalValue {
  const values =
    at === undefined
      ? rows.map(() => true as CanonicalValue)
      : rows.map((row) => row[at] ?? null).filter((value) => value !== null);
  switch (aggregate.aggregate) {
    case 'count':
      return String(values.length);
    case 'minimum':
    case 'maximum': {
      if (values.length === 0) return null;
      const sign = aggregate.aggregate === 'minimum' ? 1 : -1;
      return [...values].sort((a, b) => sign * compareCanonical(type!, a, b))[0]!;
    }
    case 'sum':
    case 'average': {
      if (values.length === 0) return null;
      const texts = values as string[];
      const scale = Math.max(0, ...texts.map(scaleOf));
      const total = texts.reduce((sum, each) => sum + scaledOf(each, scale), 0n);
      if (aggregate.aggregate === 'sum') return canonicalOf(total, scale);
      const places = aggregate.places ?? 0;
      // total / 10^scale / count, to `places`: total * 10^places / (count * 10^scale), rounded.
      const quotient = roundedDivide(
        total * 10n ** BigInt(places),
        BigInt(texts.length) * 10n ** BigInt(scale),
      );
      return canonicalOf(quotient, places);
    }
  }
}

/**
 * The rows a dataset query answers, in its select's order of columns: the result's rows where the
 * condition is true - a comparison with an empty cell unknown, an optional parameter given no value
 * true - then grouped, each aggregate over its group, or every row in one group where the query
 * aggregates and groups by nothing. Ordering, the limit and the declared types are the run's to apply
 * after, as a source's answer is held to them. The query passed `checkDatasetQuery`.
 */
export function evaluateDatasetQuery(
  query: Query,
  source: DatasetSource,
  parameters: readonly Parameter[],
  values: ParameterValues,
): { readonly columns: readonly string[]; readonly rows: CanonicalValue[][] } {
  const index = new Map(source.columns.map(([name], at) => [name, at]));
  const typeOf = (ref: ColumnRef) => source.columns[index.get(ref.column)!]![1];
  const cellOf = (row: readonly CanonicalValue[], ref: ColumnRef) =>
    row[index.get(ref.column)!] ?? null;
  const declared = new Map(parameters.map((parameter) => [parameter.name, parameter]));

  type Truth = boolean | null;
  const truth = (condition: Condition, row: readonly CanonicalValue[]): Truth => {
    if ('and' in condition) {
      let found: Truth = true;
      for (const each of condition.and) {
        const value = truth(each, row);
        if (value === false) return false;
        if (value === null) found = null;
      }
      return found;
    }
    if ('or' in condition) {
      let found: Truth = false;
      for (const each of condition.or) {
        const value = truth(each, row);
        if (value === true) return true;
        if (value === null) found = null;
      }
      return found;
    }
    if ('not' in condition) {
      const value = truth(condition.not, row);
      return value === null ? null : !value;
    }
    const cell = cellOf(row, condition.column);
    if (condition.is === 'isNull') return cell === null;
    if (condition.is === 'isNotNull') return cell !== null;
    const to = condition.to!;
    let operand: CanonicalValue | readonly CanonicalValue[];
    if ('parameter' in to) {
      const given = Object.hasOwn(values, to.parameter) ? values[to.parameter] : null;
      if (given === null || given === undefined) {
        return declared.get(to.parameter)?.required ? null : true;
      }
      operand = given as CanonicalValue | readonly CanonicalValue[];
    } else if ('column' in to) {
      operand = cellOf(row, to.column);
      if (operand === null) return null;
    } else operand = to.literal;
    if (cell === null) return null;
    const type = typeOf(condition.column);
    if (condition.is === 'in') {
      return (operand as readonly CanonicalValue[]).some((item) =>
        compared(type, 'equal', cell, item),
      );
    }
    return compared(
      type,
      condition.is,
      cell,
      operand as CanonicalValue,
      condition.ignoreCase === true,
    );
  };

  const kept =
    query.where === undefined
      ? [...source.rows]
      : source.rows.filter((row) => truth(query.where!, row) === true);
  const columns = query.select.map((item) => item.name);
  const aggregates = query.select.some((item) => 'aggregate' in item.of);
  if (!aggregates && query.groupBy.length === 0) {
    return {
      columns,
      rows: kept.map((row) => query.select.map((item) => cellOf(row, item.of as ColumnRef))),
    };
  }
  // Groups in the order each first appears; one group of every row where nothing groups them.
  const groups = new Map<string, (readonly CanonicalValue[])[]>();
  if (query.groupBy.length === 0) groups.set('', kept);
  for (const row of query.groupBy.length === 0 ? [] : kept) {
    const key = JSON.stringify(query.groupBy.map((ref) => cellOf(row, ref)));
    const held = groups.get(key);
    if (held) held.push(row);
    else groups.set(key, [row]);
  }
  const rows = [...groups.values()].map((group) =>
    query.select.map((item) => {
      if (!('aggregate' in item.of)) return group[0] ? cellOf(group[0], item.of) : null;
      const of = item.of.of;
      return aggregated(
        item.of,
        group,
        of === undefined ? undefined : index.get(of.column),
        of === undefined ? undefined : typeOf(of),
      );
    }),
  );
  return { columns, rows };
}
