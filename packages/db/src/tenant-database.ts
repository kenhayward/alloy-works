import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { assertTenantRole } from './names.js';
import type { Tenant } from './provision.js';
import type { PlatformTables, TenantTables } from './tables.js';

export interface TenantDatabase {
  /**
   * The only way to reach tenant data. Opens a transaction that assumes the tenant's role and
   * search path with SET LOCAL, which Postgres reverts at commit and at rollback, so the pooled
   * connection goes back as the login role whatever the work did.
   */
  withTenant<T>(tenant: Tenant, work: (db: Transaction<TenantTables>) => Promise<T>): Promise<T>;
  /** The tenant a hostname belongs to, from the platform table; undefined when none does. */
  resolveHostname(hostname: string): Promise<Tenant | undefined>;
  /** Who the connection is outside any tenant transaction. For tests and diagnostics. */
  whoAmI(): Promise<{ readonly user: string; readonly searchPath: string }>;
  close(): Promise<void>;
}

export function createTenantDatabase(
  url: string,
  options: { readonly max?: number } = {},
): TenantDatabase {
  // Never exported: holding the pool would be a way round withTenant.
  const db = new Kysely<PlatformTables & TenantTables>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: url, max: options.max ?? 10 }),
    }),
  });

  return {
    // Async so that a refused name rejects like every other failure rather than throwing
    // before a promise exists.
    async withTenant(tenant, work) {
      // Checked before any SQL is built: these are identifiers, which cannot be parameters.
      const role = assertTenantRole(tenant.role);
      const schema = assertTenantRole(tenant.schema);
      return db.transaction().execute(async (trx) => {
        await sql`set local role ${sql.id(role)}`.execute(trx);
        await sql`select set_config('search_path', ${`${schema}, extensions`}, true)`.execute(trx);
        return work(trx as unknown as Transaction<TenantTables>);
      });
    },

    async resolveHostname(hostname) {
      const row = await db
        .selectFrom('platform.tenant_hostname as h')
        .innerJoin('platform.tenant as t', 't.id', 'h.tenant_id')
        .select(['t.id', 't.schema_name', 't.role_name'])
        .where('h.hostname', '=', hostname.toLowerCase())
        .executeTakeFirst();
      return row && { id: row.id, schema: row.schema_name, role: row.role_name };
    },

    async whoAmI() {
      const { rows } = await sql<{ who: string; search_path: string }>`
        select current_user as who, current_setting('search_path') as search_path
      `.execute(db);
      const row = rows[0]!;
      return { user: row.who, searchPath: row.search_path };
    },

    close: () => db.destroy(),
  };
}
