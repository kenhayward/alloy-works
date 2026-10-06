import { z } from 'zod';

import {
  comparisons,
  literalProblem,
  treeProblem,
  typeProblem,
  type Comparison,
} from './builder.js';
import { compareCanonical, type CanonicalValue } from './canonical.js';
import { valueTypeSchema, type ColumnType, type ValueType } from './columns.js';
import type { Column, Parameter } from './definition.js';
import { MAX_LIST_ITEMS, type ParameterValues } from './parameters.js';
import { canonicalValueSchema, sourceName } from './primitives.js';

/**
 * A file's typed filters (data.md, "Binding"; DAT-081; the D6 plan, D6-J): D4's condition over the
 * definition's own declared columns, applied by the connector to the file's canonical rows, since a
 * file has no query to hold a value. Each value is typed as its column is and compared by the
 * product's comparison - a time with its fraction padded, never by its text - so no value is ever
 * spliced into anything.
 */

/** What a comparison compares a column with: a parameter, or a fixed value of a declared type. */
export type FileOperand =
  | { parameter: string }
  | { literal: CanonicalValue | CanonicalValue[]; type: ValueType };

export type FileCondition =
  | { and: FileCondition[] }
  | { or: FileCondition[] }
  | { not: FileCondition }
  | { column: string; is: Comparison; to?: FileOperand | undefined };

const operandSchema = z.union([
  z.strictObject({ parameter: z.string() }),
  z.strictObject({
    literal: z.union([canonicalValueSchema, z.array(canonicalValueSchema).max(MAX_LIST_ITEMS)]),
    type: valueTypeSchema,
  }),
]);

// Recursive, so walked first for its depth and breadth by the builder's own walk (D4-L): the schema
// never meets a condition nested past 8.
const conditionSchema: z.ZodType<FileCondition> = z.lazy(() =>
  z.union([
    z.strictObject({ and: z.array(conditionSchema) }),
    z.strictObject({ or: z.array(conditionSchema) }),
    z.strictObject({ not: conditionSchema }),
    z.strictObject({
      column: sourceName('A column'),
      is: z.enum(comparisons),
      to: operandSchema.optional(),
    }),
  ]),
);

/** A file's condition, walked first: the walk's refusal is the condition's. */
export const fileConditionSchema = z.preprocess((value, context) => {
  const problem = treeProblem(value, 'condition');
  if (problem !== undefined) context.addIssue({ code: 'custom', message: problem, input: value });
  return value;
}, conditionSchema) as unknown as z.ZodType<FileCondition>;

/**
 * A condition's rules against the declared columns and parameters (the D6 plan, D6-J): each column it
 * names declared; an image compared by is empty and is not empty alone; each operand of the column's
 * own base, a list exactly where `in` compares, its comparison one the type takes (D4-C), a fixed
 * value canonical and never empty, and a parameter declared, with no variation. Answers the
 * parameters it uses.
 */
export function checkFileCondition(
  where: FileCondition,
  columns: readonly Column[],
  parameters: readonly Parameter[],
  problem: (path: string, message: string) => void,
  at = 'fetch.where',
): Set<string> {
  const byColumn = new Map(columns.map((column) => [column.name, column]));
  const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const used = new Set<string>();
  const visit = (node: FileCondition, path: string): void => {
    if ('and' in node) return node.and.forEach((each, i) => visit(each, `${path}.and.${i}`));
    if ('or' in node) return node.or.forEach((each, i) => visit(each, `${path}.or.${i}`));
    if ('not' in node) return visit(node.not, `${path}.not`);
    // A parameter named is used, whatever else is wrong with its comparison.
    if (node.to !== undefined && 'parameter' in node.to && byName.has(node.to.parameter)) {
      used.add(node.to.parameter);
    }
    const column = byColumn.get(node.column);
    if (column === undefined) {
      problem(`${path}.column`, `The filter names ${node.column}, which is not a column`);
      return;
    }
    const { is, to } = node;
    if (is === 'isNull' || is === 'isNotNull') {
      if (to !== undefined) problem(`${path}.to`, 'Is empty and is not empty compare with nothing');
      return;
    }
    if (column.type.base === 'image') {
      problem(`${path}.is`, 'An image is filtered by is empty or is not empty alone');
      return;
    }
    if (to === undefined) {
      problem(`${path}.to`, 'A comparison compares its column with a parameter or a value');
      return;
    }
    const type = column.type;
    let base: ValueType['base'];
    let list: boolean;
    if ('parameter' in to) {
      const parameter = byName.get(to.parameter);
      if (parameter === undefined) {
        problem(
          `${path}.to.parameter`,
          `The filter names ${to.parameter}, which is not a declared parameter`,
        );
        return;
      }
      used.add(parameter.name);
      base = parameter.type.base;
      list = parameter.list;
    } else {
      base = to.type.base;
      list = Array.isArray(to.literal);
      const values = Array.isArray(to.literal) ? to.literal : [to.literal];
      if (Array.isArray(to.literal) && to.literal.length < 1) {
        problem(`${path}.to.literal`, `A list of values holds 1 to ${MAX_LIST_ITEMS}`);
      }
      if (values.some((value) => literalProblem(to.type, value))) {
        problem(`${path}.to.literal`, "A value is written in its type's canonical form, and is never empty");
      }
    }
    if (base !== type.base) {
      problem(`${path}.to`, `${column.name} is ${type.base}, so it is compared with ${type.base}`);
      return;
    }
    if (list !== (is === 'in')) {
      problem(
        `${path}.to`,
        list ? 'A list is compared by in alone' : 'In compares a column with a list',
      );
      return;
    }
    const wrong = typeProblem(is, type as ValueType);
    if (wrong !== undefined) problem(`${path}.is`, wrong);
  };
  visit(where, at);
  return used;
}

/** Kleene's three values: a comparison with an empty cell is neither true nor false, as SQL's. */
type Truth = boolean | null;

/** One comparison of a cell with a value of its column's type. */
function compared(type: ColumnType, is: Comparison, cell: CanonicalValue, value: CanonicalValue): boolean {
  const order = () => compareCanonical(type, cell, value);
  switch (is) {
    case 'equal':
      return order() === 0;
    case 'notEqual':
      return order() !== 0;
    case 'less':
      return order() < 0;
    case 'lessOrEqual':
      return order() <= 0;
    case 'greater':
      return order() > 0;
    case 'greaterOrEqual':
      return order() >= 0;
    case 'contains':
      return (cell as string).includes(value as string);
    case 'startsWith':
      return (cell as string).startsWith(value as string);
    default:
      return false;
  }
}

/**
 * A predicate over canonical rows (DAT-081): true where a row is kept. A comparison with an empty
 * cell is unknown, an optional parameter given no value is true, and a row is kept where the whole is
 * true, as a built query's `WHERE` keeps one (D4-G). The condition passed `checkFileCondition`, and
 * the values their declarations.
 */
export function fileFilter(
  where: FileCondition,
  columns: readonly Column[],
  parameters: readonly Parameter[],
  values: ParameterValues,
): (row: readonly CanonicalValue[]) => boolean {
  const index = new Map(columns.map((column, at) => [column.name, at]));
  const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const evaluate = (node: FileCondition, row: readonly CanonicalValue[]): Truth => {
    if ('and' in node) {
      let truth: Truth = true;
      for (const each of node.and) {
        const value = evaluate(each, row);
        if (value === false) return false;
        if (value === null) truth = null;
      }
      return truth;
    }
    if ('or' in node) {
      let truth: Truth = false;
      for (const each of node.or) {
        const value = evaluate(each, row);
        if (value === true) return true;
        if (value === null) truth = null;
      }
      return truth;
    }
    if ('not' in node) {
      const value = evaluate(node.not, row);
      return value === null ? null : !value;
    }
    const at = index.get(node.column)!;
    const cell = row[at] ?? null;
    if (node.is === 'isNull') return cell === null;
    if (node.is === 'isNotNull') return cell !== null;
    const to = node.to!;
    let operand: CanonicalValue | readonly CanonicalValue[];
    if ('parameter' in to) {
      const given = Object.hasOwn(values, to.parameter) ? values[to.parameter] : null;
      // An optional parameter given no value keeps every row, as the builder's does (DAT-018).
      if (given === null || given === undefined) {
        return byName.get(to.parameter)?.required ? null : true;
      }
      operand = given as CanonicalValue | readonly CanonicalValue[];
    } else operand = to.literal;
    if (cell === null) return null;
    const type = columns[at]!.type;
    if (node.is === 'in') {
      return (operand as readonly CanonicalValue[]).some((item) => compared(type, 'equal', cell, item));
    }
    return compared(type, node.is, cell, operand as CanonicalValue);
  };
  return (row) => evaluate(where, row) === true;
}

/**
 * Rows in a definition's declared order (the D6 plan, D6-J): a file has no query to order them, so
 * the connector sorts them by the product's comparison - each declared column in turn, a time by its
 * value, an empty cell after every value ascending - and `finishResult` then checks the order and the
 * key as it checks a database's. A multiset is left for `finishResult`, which sorts it.
 */
export function sortRows<Row extends readonly CanonicalValue[]>(
  rows: Row[],
  definition: {
    readonly columns: readonly { readonly name: string; readonly type: ColumnType }[];
    readonly order:
      | readonly { readonly column: string; readonly direction: 'ascending' | 'descending' }[]
      | 'multiset';
  },
): Row[] {
  if (definition.order === 'multiset') return rows;
  const index = new Map(definition.columns.map((column, at) => [column.name, at]));
  const order = definition.order.map((each) => ({
    at: index.get(each.column)!,
    type: definition.columns[index.get(each.column)!]!.type,
    sign: each.direction === 'ascending' ? 1 : -1,
  }));
  // Stable, so rows equal in every ordered column keep the file's order.
  return rows.sort((a, b) => {
    for (const { at, type, sign } of order) {
      const compared = sign * compareCanonical(type, a[at] ?? null, b[at] ?? null);
      if (compared !== 0) return compared;
    }
    return 0;
  });
}

