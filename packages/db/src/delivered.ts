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
export type DeliveredRefused = {
  readonly refused: 'type_changed';
  readonly table: string;
  readonly column: string;
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
 * needed changing, or cutting, takes a hash of itself so two ids cannot meet in one name.
 */
function tenantNames(tenantId: string): { schema: string; account: string } {
  const cleaned = tenantId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const exact = cleaned === tenantId && cleaned.length > 0 && cleaned.length <= 40;
  const suffix = exact ? '' : `_${createHash('sha256').update(tenantId).digest('hex').slice(0, 8)}`;
  const body = (exact ? cleaned : cleaned.slice(0, 30)) + suffix;
  const schema = `t_${body}`.slice(0, MAX_IDENTIFIER);
  return { schema, account: `${schema.slice(0, MAX_IDENTIFIER - 5)}_read` };
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
        await lock(trx, `delivered-provision:${schema}`);
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
      return db.transaction().execute(async (trx): Promise<DeliveredWritten | DeliveredRefused> => {
        await lock(trx, `delivered-write:${schema}`);

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
            const rows = plan.rows
              .slice(start, start + perBatch)
              .map(
                (row) =>
                  sql`(${sql.join(
                    plan.columns.map(
                      (column, index) => sql`${row[index] ?? null}::${TYPES[column.type].cast}`,
                    ),
                  )})`,
              );
            await sql`insert into ${table} (${columnList}) values ${sql.join(rows)}`.execute(trx);
          }
        }
        return { written: plans.map((plan) => `${schema}.${plan.name}`) };
      });
    },

    async close() {
      await db.destroy();
    },
  };
}
