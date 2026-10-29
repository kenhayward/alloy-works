import { createHash, randomBytes } from 'node:crypto';
import type { bridge } from '@alloy-works/domain';
import { Kysely, PostgresDialect, sql, type RawBuilder, type Transaction } from 'kysely';
import { createPool } from './pool.js';

/** What the delivery store gives back when a tenant is provisioned: a schema, a login and its password. */
export interface DeliveredAccess {
  readonly schema: string;
  readonly account: string;
  readonly password: string;
}

export type DeliveredWritten = { readonly written: readonly string[] };
export type DeliveredRefused =
  | { readonly refused: 'type_changed'; readonly table: string; readonly column: string }
  | {
      readonly refused: 'value_invalid';
      readonly table: string;
      readonly column: string;
      /** 1-based, as `ct_row`. */
      readonly row: number;
    };

/**
 * The delivery store (docs/design/ct-studio-sink.md, "Data tables"): a Postgres database apart from
 * the platform, one schema per tenant, written by the role the URL names and read by one read-only
 * role per tenant. The tables are an ordinary SQL source to the connector.
 */
export interface DeliveredStore {
  /** The tenant's schema and read role, made if absent. The read role always gets a new password. */
  provision(tenantId: string): Promise<DeliveredAccess>;
  /**
   * Plans written into `schema` in one transaction: the table made if absent, new columns added, the
   * rows of this source and recipe (any recipe version) replaced. A column whose type has changed
   * refuses the whole write with nothing changed. `written` is the qualified table names.
   */
  write(
    schema: string,
    plans: readonly bridge.TablePlan[],
    source: { sha256: string; recipeId: string },
  ): Promise<DeliveredWritten | DeliveredRefused>;
  close(): Promise<void>;
}

const MAX_IDENTIFIER = 63;
const SCHEMA_NAME = /^t_[a-z0-9_]{1,61}$/;
/** Bind parameters per statement are capped at 65535 by the protocol; stay well under. */
const PARAMETER_BUDGET = 30_000;

/** The Postgres type of each column type, as a cast and as `information_schema` names it. */
const TYPES: Record<bridge.ColumnType, { cast: RawBuilder<unknown>; catalog: string }> = {
  numeric: { cast: sql`numeric`, catalog: 'numeric' },
  bigint: { cast: sql`bigint`, catalog: 'bigint' },
  date: { cast: sql`date`, catalog: 'date' },
  timestamptz: { cast: sql`timestamptz`, catalog: 'timestamp with time zone' },
  boolean: { cast: sql`boolean`, catalog: 'boolean' },
  text: { cast: sql`text`, catalog: 'text' },
};

/**
 * `t_<tenant>` and the read role's name, made safe: `[a-z0-9_]` and at most 63 bytes. An id that
 * needed changing, or cutting, takes a hash of itself so two ids cannot meet in one name. The hashed
 * form always holds a double underscore, which an exact id never does (an id with one is hashed
 * too), so no exact id can equal a hashed name. The empty id is defined: it is hashed like any odd id.
 */
export function tenantNames(tenantId: string): { schema: string; account: string } {
  const cleaned = tenantId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const exact =
    cleaned === tenantId && cleaned.length > 0 && cleaned.length <= 40 && !cleaned.includes('__');
  const suffix = exact
    ? ''
    : `__${createHash('sha256').update(tenantId).digest('hex').slice(0, 8)}`;
  const body = (exact ? cleaned : cleaned.slice(0, 30)) + suffix;
  const schema = `t_${body}`.slice(0, MAX_IDENTIFIER);
  return { schema, account: `${schema.slice(0, MAX_IDENTIFIER - 5)}_read` };
}

/** An empty value is null for every column but text, whose empty string is a value. */
const cellValue = (value: string | null | undefined, type: bridge.ColumnType): string | null =>
  value === undefined || (value === '' && type !== 'text') ? null : value;

/** A value Postgres will not cast: SQLSTATE class 22 (data exception). */
const isDataError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string' &&
  error.code.startsWith('22');

/** Thrown inside the write's transaction to roll it back, then returned as the refusal. */
class ValueInvalid extends Error {
  constructor(readonly refusal: Extract<DeliveredRefused, { refused: 'value_invalid' }>) {
    super('value_invalid');
  }
}

/** The first cell of a failed batch that will not cast, found by casting each alone (no writes). */
async function firstInvalid(
  trx: Transaction<unknown>,
  plan: bridge.TablePlan,
  batch: readonly (string | null)[][],
  start: number,
): Promise<ValueInvalid | undefined> {
  for (const [offset, row] of batch.entries()) {
    for (const [index, column] of plan.columns.entries()) {
      const value = cellValue(row[index], column.type);
      if (value === null) continue;
      await sql`savepoint cell`.execute(trx);
      try {
        await sql`select ${value}::${TYPES[column.type].cast}`.execute(trx);
      } catch (error) {
        if (!isDataError(error)) throw error;
        await sql`rollback to savepoint cell`.execute(trx);
        return new ValueInvalid({
          refused: 'value_invalid',
          table: plan.name,
          column: column.name,
          row: start + offset + 1,
        });
      }
      await sql`release savepoint cell`.execute(trx);
    }
  }
  return undefined;
}

const qualified = (schema: string, table: string): RawBuilder<unknown> =>
  sql`${sql.id(schema)}.${sql.id(table)}`;

export function createDeliveredStore(url: string): DeliveredStore {
  // The URL's own sslmode decides TLS; nothing here forces it off.
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: createPool({ connectionString: url, max: 4 }) }),
  });

  /** One writer at a time per key, held to the end of the transaction. */
  const lock = (trx: Transaction<unknown>, key: string) =>
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);

  return {
    async provision(tenantId) {
      const { schema, account } = tenantNames(tenantId);
      // Hex only, so a literal in CREATE ROLE (which takes no bind parameter) cannot be broken.
      const password = randomBytes(24).toString('hex');
      await db.transaction().execute(async (trx) => {
        // One provision at a time: the database-level REVOKE below would otherwise collide
        // ("tuple concurrently updated") when two tenants are provisioned together.
        await lock(trx, 'delivered-provision');
        await sql`create schema if not exists ${sql.id(schema)}`.execute(trx);
        const existing = await sql<{ rolname: string }>`
          select rolname from pg_roles where rolname = ${account}`.execute(trx);
        if (existing.rows.length === 0) {
          await sql`create role ${sql.id(account)} login password ${sql.lit(password)}`.execute(
            trx,
          );
        } else {
          await sql`alter role ${sql.id(account)} login password ${sql.lit(password)}`.execute(trx);
        }
        const current = await sql<{ name: string }>`select current_database() as name`.execute(trx);
        const database = current.rows[0]!.name;
        await sql`revoke connect on database ${sql.id(database)} from public`.execute(trx);
        await sql`grant connect on database ${sql.id(database)} to ${sql.id(account)}`.execute(trx);
        await sql`revoke all on schema ${sql.id(schema)} from public`.execute(trx);
        await sql`grant usage on schema ${sql.id(schema)} to ${sql.id(account)}`.execute(trx);
        await sql`grant select on all tables in schema ${sql.id(schema)} to ${sql.id(account)}`.execute(
          trx,
        );
        await sql`alter default privileges in schema ${sql.id(schema)} grant select on tables to ${sql.id(account)}`.execute(
          trx,
        );
      });
      return { schema, account, password };
    },

    async write(schema, plans, source) {
      if (!SCHEMA_NAME.test(schema)) {
        throw new Error(`Not a delivery schema name: ${JSON.stringify(schema)}`);
      }
      try {
        return await db
          .transaction()
          .execute(async (trx): Promise<DeliveredWritten | DeliveredRefused> => {
            await lock(trx, `delivered-write:${schema}`);
            // Zone-less and ambiguous date text means the same wherever the server is set up.
            await sql`set local time zone 'UTC'`.execute(trx);
            await sql`set local datestyle = 'ISO, YMD'`.execute(trx);

            // Look at every table first, so a refusal leaves nothing changed.
            const existing = new Map<string, Map<string, string>>();
            for (const plan of plans) {
              const found = await sql<{ column_name: string; data_type: string }>`
            select column_name, data_type from information_schema.columns
            where table_schema = ${schema} and table_name = ${plan.name}`.execute(trx);
              if (found.rows.length === 0) continue;
              const columns = new Map(found.rows.map((row) => [row.column_name, row.data_type]));
              existing.set(plan.name, columns);
              for (const column of plan.columns) {
                const type = columns.get(column.name);
                if (type !== undefined && type !== TYPES[column.type].catalog) {
                  return { refused: 'type_changed', table: plan.name, column: column.name };
                }
              }
            }

            for (const plan of plans) {
              const table = qualified(schema, plan.name);
              const columns = existing.get(plan.name);
              if (columns === undefined) {
                const definitions = plan.columns.map(
                  (column) => sql`${sql.id(column.name)} ${TYPES[column.type].cast}`,
                );
                await sql`create table ${table} (${sql.join(definitions)})`.execute(trx);
              } else {
                for (const column of plan.columns) {
                  if (columns.has(column.name)) continue;
                  await sql`alter table ${table} add column ${sql.id(column.name)} ${TYPES[column.type].cast}`.execute(
                    trx,
                  );
                }
                await sql`delete from ${table}
              where ct_source_sha256 = ${source.sha256} and ct_recipe_id = ${source.recipeId}`.execute(
                  trx,
                );
              }

              const columnList = sql.join(plan.columns.map((column) => sql.id(column.name)));
              const perBatch = Math.max(1, Math.floor(PARAMETER_BUDGET / plan.columns.length));
              for (let start = 0; start < plan.rows.length; start += perBatch) {
                const batch = plan.rows.slice(start, start + perBatch);
                const rows = batch.map(
                  (row) =>
                    sql`(${sql.join(
                      plan.columns.map(
                        (column, index) =>
                          sql`${cellValue(row[index], column.type)}::${TYPES[column.type].cast}`,
                      ),
                    )})`,
                );
                await sql`savepoint batch`.execute(trx);
                try {
                  await sql`insert into ${table} (${columnList}) values ${sql.join(rows)}`.execute(
                    trx,
                  );
                } catch (error) {
                  if (!isDataError(error)) throw error;
                  await sql`rollback to savepoint batch`.execute(trx);
                  const bad = await firstInvalid(trx, plan, batch, start);
                  // Thrown inside the transaction, so everything done so far is rolled back.
                  throw bad ?? error;
                }
                await sql`release savepoint batch`.execute(trx);
              }
            }
            return { written: plans.map((plan) => `${schema}.${plan.name}`) };
          });
      } catch (error) {
        if (error instanceof ValueInvalid) return error.refusal;
        throw error;
      }
    },

    async close() {
      await db.destroy();
    },
  };
}
