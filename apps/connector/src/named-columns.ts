import {
  dataFailure,
  quoteIdentifier,
  type ColumnRef,
  type Condition,
  type DataFailure,
  type Query,
} from '@alloy-works/domain';
import type pg from 'pg';

import { describeStatement, sqlstateOf } from './describe.js';

/**
 * A built query's columns checked against the source's catalogue before anything of it is described
 * or run (the D4 plan, "Changed while building"). The generator writes a table's column as
 * `"alias"."name"`, and where the table has no column of that name PostgreSQL reads `t.f` as `f(t)`,
 * a function found through the search path: `"s"."row_to_json"` would answer each row as JSON, and a
 * function an account plants in a schema of its own would run. The builder's checks hold a nested
 * query's columns to its select names, but a table's are the source's to know, so each is asked of
 * the catalogue here, in the session and the read-only transaction that then describes or runs it.
 *
 * Every relation the query names is held first, so what the catalogue answers is still so when the
 * query is described and run: a column renamed between the check and the run would otherwise be read
 * as a function after all (the D4 plan, "Changed while building", the second review).
 */

/** A column the query names of a table or view: the alias it is named by, and what it names. */
export interface NamedColumn {
  readonly alias: string;
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}

/** A table or view the query names: the first alias it is named by, and what it names. */
export interface NamedRelation {
  readonly alias: string;
  readonly schema: string;
  readonly name: string;
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
 * Every table or view the query names, at every level, each once - by the first alias that names it -
 * ordered by schema and then name, compared by code unit, so every act holds them in the same order.
 */
export function namedRelations(query: Query): NamedRelation[] {
  const named = new Map<string, NamedRelation>();
  const visit = (node: Query) => {
    for (const source of node.sources) {
      if ('query' in source) {
        visit(source.query);
        continue;
      }
      const key = JSON.stringify([source.table.schema, source.table.name]);
      if (!named.has(key)) {
        named.set(key, {
          alias: source.alias,
          schema: source.table.schema,
          name: source.table.name,
        });
      }
    }
  };
  visit(query);
  const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...named.values()].sort(
    (a, b) => byCodeUnit(a.schema, b.schema) || byCodeUnit(a.name, b.name),
  );
}

/**
 * Each named relation against the catalogue, by `pg_catalog`'s names alone and every name a bound
 * value, compared byte for byte: whether it is of a kind a query may read. Asked of every relation,
 * so one the query names no column of - a count of its rows - is held to the kinds too.
 */
const RELATION_CHECK = `SELECT w.at::pg_catalog.int4 AS at,
  EXISTS (SELECT FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
           WHERE n.nspname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.schema_name
             AND c.relname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.table_name
             AND c.relkind::pg_catalog.text OPERATOR(pg_catalog.=) ANY ($3::pg_catalog.text[])) AS readable
FROM ROWS FROM (pg_catalog.unnest($1::pg_catalog.text[]),
                pg_catalog.unnest($2::pg_catalog.text[]))
     WITH ORDINALITY AS w(schema_name, table_name, at)
ORDER BY w.at`;

/**
 * Each named column against the catalogue, by `pg_catalog`'s names alone and every name a bound value,
 * compared byte for byte: whether its relation has the column, a live one of its own (`attnum > 0`,
 * not dropped), or has it as a system column (`attnum < 0`: `ctid`, `xmin` and the rest), which the
 * describe never lists.
 */
const CATALOGUE_CHECK = `SELECT w.at::pg_catalog.int4 AS at,
  EXISTS (SELECT FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON c.oid OPERATOR(pg_catalog.=) a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
           WHERE n.nspname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.schema_name
             AND c.relname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.table_name
             AND c.relkind::pg_catalog.text OPERATOR(pg_catalog.=) ANY ($4::pg_catalog.text[])
             AND a.attname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.column_name
             AND a.attnum OPERATOR(pg_catalog.>) 0
             AND NOT a.attisdropped) AS present,
  EXISTS (SELECT FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON c.oid OPERATOR(pg_catalog.=) a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
           WHERE n.nspname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.schema_name
             AND c.relname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.table_name
             AND a.attname::pg_catalog.text COLLATE pg_catalog."C" OPERATOR(pg_catalog.=) w.column_name
             AND a.attnum OPERATOR(pg_catalog.<) 0) AS system
FROM ROWS FROM (pg_catalog.unnest($1::pg_catalog.text[]),
                pg_catalog.unnest($2::pg_catalog.text[]),
                pg_catalog.unnest($3::pg_catalog.text[]))
     WITH ORDINALITY AS w(schema_name, table_name, column_name, at)
ORDER BY w.at`;

/** A name quoted as the generator quotes it. */
const quoted = quoteIdentifier;

/**
 * A relation's refusals when it is held that mean nothing could read it: one the source does not
 * have, in a schema it does not have, or of a kind no statement reads (a composite type, an index).
 */
const NOT_READABLE = new Set(['42P01', '3F000', '42809']);

/** A relation no query may read, in the product's words (D4-K), naming it and its source. */
const notReadable = (each: NamedRelation) =>
  dataFailure('source_refused', {
    source: {
      sqlstate: '42P01',
      message: `The source has no table or view ${quoted(each.schema)}.${quoted(each.name)}, the query's source ${each.alias}`,
    },
  });

/**
 * Every relation the query names held to the end of the transaction, in `namedRelations`' order:
 * `SELECT FROM ONLY "schema"."name"` parsed and described, one at a time, and never planned or run.
 * Parsing takes the relation's `ACCESS SHARE` lock, which a transaction keeps to its end whatever
 * becomes of the statement, so a rename, a drop or any other change of its columns waits until the
 * query has run; the wait is bounded by the request's deadline. Not `LOCK TABLE`, which refuses a
 * materialised view and a foreign table, both of which the builder offers, and wants a privilege on
 * the table a describe does not. `ONLY`, because what is checked is the named relation's own columns:
 * a partition's or a child's are its parent's, cannot be renamed apart from it, and are held by the
 * run's own planning. A relation the source does not have, or of a kind nothing reads, is refused in
 * the product's words; one in a schema the account may not use is the source's own `42501`, thrown,
 * whether or not the schema holds it, before the catalogue is read. Anything else is thrown too.
 */
async function holdRelations(
  client: pg.Client,
  relations: readonly NamedRelation[],
): Promise<DataFailure | undefined> {
  for (const each of relations) {
    try {
      await describeStatement(
        client,
        `SELECT FROM ONLY ${quoted(each.schema)}.${quoted(each.name)}`,
      );
    } catch (error) {
      const sqlstate = sqlstateOf(error);
      if (sqlstate !== undefined && NOT_READABLE.has(sqlstate)) return notReadable(each);
      throw error;
    }
  }
  return undefined;
}

/**
 * The first relation the query names that no query may read, `42P01`, or the first column it names
 * that its table or view does not have, as the source would refuse it - `42703` with the product's
 * words for it (D4-K), naming the source and the column; undefined where every one is there. Every
 * relation is held first (`holdRelations`), so the answer still holds when the query is described
 * and run, and is read from the catalogue as it stands once they are. The caller's transaction is
 * read committed for that: a snapshot taken before a wait would read the catalogue as it was. None
 * of the query is sent: only its relations' names, and the catalogue's reads.
 */
export async function absentColumn(
  client: pg.Client,
  query: Query,
): Promise<DataFailure | undefined> {
  const relations = namedRelations(query);
  const held = await holdRelations(client, relations);
  if (held !== undefined) return held;
  if (relations.length === 0) return undefined;
  const kinds = await client.query<{ at: number; readable: boolean }>(RELATION_CHECK, [
    relations.map((each) => each.schema),
    relations.map((each) => each.name),
    [...READABLE_KINDS],
  ]);
  for (const row of kinds.rows) {
    if (!row.readable) return notReadable(relations[row.at - 1]!);
  }
  const named = namedColumns(query);
  if (named.length === 0) return undefined;
  const checked = await client.query<{ at: number; present: boolean; system: boolean }>(
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
    // A system column is the table's own, but the describe never lists it and a built query does not
    // read it: refused as a column the query may not name, in words that say what it is.
    const message = row.system
      ? `The column ${quoted(each.column)} of the table or view ${relation}, the query's source ${each.alias}, is a system column, which a built query does not read`
      : `The table or view ${relation}, the query's source ${each.alias}, has no column ${quoted(each.column)}`;
    return dataFailure('source_refused', {
      source: { sqlstate: '42703', message },
      column: each.column,
    });
  }
  return undefined;
}
