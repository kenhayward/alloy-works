import {
  dataFailure,
  type ColumnRef,
  type Condition,
  type DataFailure,
  type Query,
} from '@alloy-works/domain';
import type pg from 'pg';

/**
 * A built query's columns checked against the source's catalogue before anything of it is described
 * or run (the D4 plan, "Changed while building"). The generator writes a table's column as
 * `"alias"."name"`, and where the table has no column of that name PostgreSQL reads `t.f` as `f(t)`,
 * a function found through the search path: `"s"."row_to_json"` would answer each row as JSON, and a
 * function an account plants in a schema of its own would run. The builder's checks hold a nested
 * query's columns to its select names, but a table's are the source's to know, so each is asked of
 * the catalogue here, in the session and the read-only transaction that then describes or runs it.
 */

/** A column the query names of a table or view: the alias it is named by, and what it names. */
export interface NamedColumn {
  readonly alias: string;
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}

/**
 * The relation kinds a query may read, as the source's listing offers them: tables, partitioned
 * tables, views, materialised views and foreign tables.
 */
export const READABLE_KINDS = ['r', 'p', 'v', 'm', 'f'] as const;

/**
 * Every column the query names of a table or view, at every level: in its select and its aggregates,
 * its conditions - a join's and the where's, either side of a comparison - and its grouping. A nested
 * query's own columns are its select names, which the builder's checks hold it to.
 */
export function namedColumns(query: Query): NamedColumn[] {
  const named: NamedColumn[] = [];
  const visit = (node: Query) => {
    const tables = new Map<string, { schema: string; name: string }>();
    for (const source of node.sources) {
      if ('table' in source) tables.set(source.alias, source.table);
      else visit(source.query);
    }
    const name = (ref: ColumnRef) => {
      const table = tables.get(ref.source);
      if (table === undefined) return;
      named.push({
        alias: ref.source,
        schema: table.schema,
        table: table.name,
        column: ref.column,
      });
    };
    const condition = (each: Condition): void => {
      if ('and' in each) each.and.forEach(condition);
      else if ('or' in each) each.or.forEach(condition);
      else if ('not' in each) condition(each.not);
      else {
        name(each.column);
        if (each.to !== undefined && 'column' in each.to) name(each.to.column);
      }
    };
    for (const item of node.select) {
      if (!('aggregate' in item.of)) name(item.of);
      else if (item.of.of !== undefined) name(item.of.of);
    }
    for (const join of node.joins) condition(join.on);
    if (node.where !== undefined) condition(node.where);
    node.groupBy.forEach(name);
  };
  visit(query);
  return named;
}

/**
 * Each named column against the catalogue, by `pg_catalog`'s names alone and every name a bound value,
 * compared byte for byte: whether its relation is one a query may read, and whether that relation has
 * the column, a live one of its own (`attnum > 0`, not dropped).
 */
const CATALOGUE_CHECK = `SELECT w.at::pg_catalog.int4 AS at,
  EXISTS (SELECT FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
           WHERE n.nspname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.schema_name
             AND c.relname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.table_name
             AND c.relkind::pg_catalog.text OPERATOR(pg_catalog.=) ANY ($4::pg_catalog.text[])) AS readable,
  EXISTS (SELECT FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON c.oid OPERATOR(pg_catalog.=) a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
           WHERE n.nspname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.schema_name
             AND c.relname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.table_name
             AND c.relkind::pg_catalog.text OPERATOR(pg_catalog.=) ANY ($4::pg_catalog.text[])
             AND a.attname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.column_name
             AND a.attnum OPERATOR(pg_catalog.>) 0
             AND NOT a.attisdropped) AS present
FROM ROWS FROM (pg_catalog.unnest($1::pg_catalog.text[]),
                pg_catalog.unnest($2::pg_catalog.text[]),
                pg_catalog.unnest($3::pg_catalog.text[]))
     WITH ORDINALITY AS w(schema_name, table_name, column_name, at)
ORDER BY w.at`;

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * The first column the query names that its table or view does not have, as the source would refuse
 * it - `42703` with the product's words for it (D4-K), naming the source and the column - or a
 * relation no query may read, `42P01`; undefined where every one is there. Nothing of the query is
 * sent: only the catalogue is read.
 */
export async function absentColumn(
  client: pg.Client,
  query: Query,
): Promise<DataFailure | undefined> {
  const named = namedColumns(query);
  if (named.length === 0) return undefined;
  const checked = await client.query<{ at: number; readable: boolean; present: boolean }>(
    CATALOGUE_CHECK,
    [
      named.map((each) => each.schema),
      named.map((each) => each.table),
      named.map((each) => each.column),
      [...READABLE_KINDS],
    ],
  );
  for (const row of checked.rows) {
    if (row.present) continue;
    const each = named[row.at - 1]!;
    const relation = `${quoted(each.schema)}.${quoted(each.table)}`;
    if (!row.readable) {
      return dataFailure('source_refused', {
        source: {
          sqlstate: '42P01',
          message: `The source has no table or view ${relation}, the query's source ${each.alias}`,
        },
      });
    }
    return dataFailure('source_refused', {
      source: {
        sqlstate: '42703',
        message: `The table or view ${relation}, the query's source ${each.alias}, has no column ${quoted(each.column)}`,
      },
      column: each.column,
    });
  }
  return undefined;
}
