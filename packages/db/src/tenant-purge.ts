import { Kysely, PostgresDialect, sql } from 'kysely';
import { assertTenantRole } from './names.js';
import { createPool } from './pool.js';
import type { Tenant } from './provision.js';

/**
 * **The steward's reach** (tenant-lifecycle.md, TL-I): what removes a tenant from the database. Only the
 * steward's login can do any of it: `createrole`, and the admin option on each tenant's two roles.
 */

/** Longest lease and the tenant cache together, for whatever was in flight (TL-I). */
export const PURGE_WAIT_MS = 31 * 60_000;
export const PURGE_ATTEMPTS = 10;
/** IAM-086's day: past this a purge is an alarm, not a wait. */
const PURGE_DUE_MS = 24 * 3_600_000;

export interface PurgeReport {
  readonly schemaPresent: boolean;
  readonly roles: number;
  readonly hostnames: number;
  readonly jobs: number;
  readonly objects: number;
  readonly credentialPresent: boolean;
}

export interface TenantRecord {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly deletionBeganAt: Date | null;
  readonly deletedAt: Date | null;
  readonly report: PurgeReport | null;
}

export interface StewardDatabase {
  /** A tenant being deleted, from the row alone, since its schema may already be gone. */
  deleting(id: string): Promise<{ readonly tenant: Tenant; readonly since: Date } | undefined>;
  removeHostnames(tenant: Tenant): Promise<void>;
  /** The schema, then both roles, under the lock `migrate` takes, so neither trips on the other. */
  dropTenantDatabase(tenant: Tenant): Promise<void>;
  /** What is still there, by asking; the objects and the credential are the store's to say. */
  whatRemains(
    tenant: Tenant,
  ): Promise<Pick<PurgeReport, 'schemaPresent' | 'roles' | 'hostnames' | 'jobs'>>;
  /** The last change: the record, and every job of the tenant's with it, this one's among them. */
  recordDeleted(tenant: Tenant, report: PurgeReport): Promise<void>;
  /**
   * Fails any purge out of attempts and queues any deleting tenant without one, since a job that gave
   * up silently would break the promise. Answers those past the day, for an alarm.
   */
  requeueStuckPurges(): Promise<{ readonly requeued: number; readonly overdue: readonly string[] }>;
  record(id: string): Promise<TenantRecord | undefined>;
  close(): Promise<void>;
}

const OTHER_JOBS = "kind <> 'tenant_purge'";

export function createStewardDatabase(url: string): StewardDatabase {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: createPool({ connectionString: url }) }),
  });
  const present = async (role: string) => {
    const { rows } = await sql<{ n: number }>`
      select count(*)::int as n from pg_roles where rolname = ${role}`.execute(db);
    return rows[0]!.n > 0;
  };
  return {
    async deleting(id) {
      const { rows } = await sql<{
        id: string;
        schema_name: string;
        role_name: string;
        state_since: Date;
      }>`select id, schema_name, role_name, state_since from platform.tenant
          where id = ${id} and state = 'deleting'`.execute(db);
      const row = rows[0];
      return (
        row && {
          tenant: { id: row.id, schema: row.schema_name, role: row.role_name },
          since: row.state_since,
        }
      );
    },

    async removeHostnames(tenant) {
      await sql`delete from platform.tenant_hostname where tenant_id = ${tenant.id}`.execute(db);
    },

    async dropTenantDatabase(tenant) {
      const role = assertTenantRole(tenant.role);
      const owner = `${role}_owner`;
      const schema = assertTenantRole(tenant.schema);
      await db.transaction().execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtext('alloy-works:migrate'))`.execute(trx);
        const { rows: being } = await sql`
          select 1 from platform.tenant where id = ${tenant.id} and state = 'deleting'`.execute(
          trx,
        );
        if (being.length === 0) throw new Error(`The tenant ${tenant.id} is not being deleted`);
        // Each as itself, since the steward's membership does not inherit: run again, what has gone
        // is passed over.
        if (await present(owner)) {
          await sql`set local role ${sql.id(owner)}`.execute(trx);
          await sql`drop schema if exists ${sql.id(schema)} cascade`.execute(trx);
          await sql`drop owned by ${sql.id(owner)}`.execute(trx);
          await sql`reset role`.execute(trx);
        }
        if (await present(role)) {
          await sql`set local role ${sql.id(role)}`.execute(trx);
          await sql`drop owned by ${sql.id(role)}`.execute(trx);
          await sql`reset role`.execute(trx);
        }
        await sql`drop role if exists ${sql.id(owner)}, ${sql.id(role)}`.execute(trx);
      });
    },

    async whatRemains(tenant) {
      const { rows } = await sql<{
        schema_present: boolean;
        roles: number;
        hostnames: number;
        jobs: number;
      }>`select
          exists (select from pg_namespace where nspname = ${tenant.schema}) as schema_present,
          (select count(*)::int from pg_roles
            where rolname in (${tenant.role}, ${`${tenant.role}_owner`})) as roles,
          (select count(*)::int from platform.tenant_hostname
            where tenant_id = ${tenant.id}) as hostnames,
          (select count(*)::int from platform.job
            where tenant_id = ${tenant.id} and ${sql.raw(OTHER_JOBS)}
              and finished_at is null and failed_at is null) as jobs`.execute(db);
      const row = rows[0]!;
      return {
        schemaPresent: row.schema_present,
        roles: row.roles,
        hostnames: row.hostnames,
        jobs: row.jobs,
      };
    },

    async recordDeleted(tenant, report) {
      await db.transaction().execute(async (trx) => {
        await sql`select platform.tenant_deleted(${tenant.id}, ${JSON.stringify(report)}::jsonb)`.execute(
          trx,
        );
        await sql`delete from platform.job where tenant_id = ${tenant.id}`.execute(trx);
      });
    },

    async requeueStuckPurges() {
      await sql`update platform.job
                   set failed_at = now(), locked_until = null, last_error = 'abandoned'
                 where kind = 'tenant_purge' and finished_at is null and failed_at is null
                   and attempts >= max_attempts
                   and (locked_until is null or locked_until < now())`.execute(db);
      const { rows: requeued } = await sql<{ id: string }>`
        insert into platform.job (tenant_id, kind, max_attempts)
        select t.id, 'tenant_purge', ${PURGE_ATTEMPTS}::int from platform.tenant t
         where t.state = 'deleting'
           and not exists (select from platform.job j
                            where j.tenant_id = t.id and j.kind = 'tenant_purge'
                              and j.finished_at is null and j.failed_at is null)
        returning tenant_id as id`.execute(db);
      const { rows: overdue } = await sql<{ id: string }>`
        select id from platform.tenant
         where state = 'deleting'
           and state_since < now() - make_interval(secs => ${PURGE_DUE_MS / 1000}::double precision)
         order by id`.execute(db);
      return { requeued: requeued.length, overdue: overdue.map((row) => row.id) };
    },

    async record(id) {
      const { rows } = await sql<{
        id: string;
        name: string;
        state: string;
        deletion_began_at: Date | null;
        deleted_at: Date | null;
        purge_report: PurgeReport | null;
      }>`select id, name, state, deletion_began_at, deleted_at, purge_report
           from platform.tenant where id = ${id}`.execute(db);
      const row = rows[0];
      return (
        row && {
          id: row.id,
          name: row.name,
          state: row.state,
          deletionBeganAt: row.deletion_began_at,
          deletedAt: row.deleted_at,
          report: row.purge_report,
        }
      );
    },

    close: () => db.destroy(),
  };
}
