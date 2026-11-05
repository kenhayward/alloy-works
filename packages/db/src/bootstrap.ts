import pg from 'pg';
import { assertTenantRole } from './names.js';
import { retryOnRoleConflict } from './retry.js';

export interface LoginPasswords {
  readonly service: string;
  readonly worker: string;
  readonly migrator: string;
  readonly restorer: string;
  readonly steward: string;
}

const LOGIN_ROLES = [
  ['aw_service', 'service'],
  ['aw_worker', 'worker'],
  ['aw_migrator', 'migrator'],
  // The one login that may become a tenant's owner at run time, held by the restorer alone (EI S1).
  ['aw_restorer', 'restorer'],
  // What changes a tenant's state from outside it, and in time removes it (tenant-lifecycle.md, TL-I).
  ['aw_steward', 'steward'],
] as const;

/**
 * Prepares a database for Alloy Works, run as an administrator: the cluster's login roles, then this
 * database. Safe to run again: roles are created when missing and brought back to their intended
 * attributes when not.
 *
 * The login roles are NOINHERIT and hold no rights of their own on tenant data. They reach a
 * tenant only by assuming its role inside a transaction (see tenant-database.ts).
 */
export async function bootstrapCluster(adminUrl: string, passwords: LoginPasswords): Promise<void> {
  await bootstrapLoginRoles(adminUrl, passwords);
  await prepareDatabase(adminUrl);
}

/**
 * The half of `bootstrapCluster` that is the cluster's: the three login roles and the role every
 * tenant belongs to. Roles are shared by every database in the cluster, so a test run sets them once
 * and prepares each file's database with `prepareDatabase` alone, and no two files write one row.
 */
export async function bootstrapLoginRoles(
  adminUrl: string,
  passwords: LoginPasswords,
): Promise<void> {
  await retryOnRoleConflict(() =>
    inTransaction(adminUrl, async (client) => {
      for (const [role, key] of LOGIN_ROLES) {
        const existing = await client.query('select 1 from pg_roles where rolname = $1', [role]);
        if (existing.rowCount === 0) {
          await client.query(`create role ${role} login noinherit`);
        }
        await client.query(
          `alter role ${role} login noinherit nosuperuser nocreaterole nocreatedb password ${client.escapeLiteral(passwords[key])}`,
        );
      }
      // What the steward removes a tenant's roles with, and its admin option on each is what limits it
      // to them (the TL plan, S1). Nothing else can make or drop a role.
      await client.query('alter role aw_steward createrole');
      // Every tenant role is a member of this one. It holds the rights a tenant has outside its own
      // schema - today, putting its own work on the queue - so the queue grants one role, not each.
      const group = await client.query('select 1 from pg_roles where rolname = $1', ['aw_tenant']);
      if (group.rowCount === 0) await client.query('create role aw_tenant nologin');
      // A tenant the steward makes joins that role, which is all this admin option is for (TL-N).
      await client.query('grant aw_tenant to aw_steward with admin true, inherit false, set false');
    }),
  );
}

/**
 * The half of `bootstrapCluster` that is this database's, once the login roles exist: its schemas,
 * pgvector and pg_trgm, and its tenants' membership of `aw_tenant`. It creates and alters no role,
 * so databases can be prepared side by side; the one cluster-wide row it may write is an existing tenant's
 * membership of `aw_tenant`, and a fresh database has no tenant.
 */
export async function prepareDatabase(adminUrl: string): Promise<void> {
  await retryOnRoleConflict(() =>
    inTransaction(adminUrl, async (client) => {
      await client.query('create schema if not exists platform authorization aw_migrator');
      await client.query('create schema if not exists extensions');
      await client.query('create extension if not exists vector schema extensions');
      // Trigrams, which answer a search for a part of a word (UI6; tenant migration 0062).
      await client.query('create extension if not exists pg_trgm schema extensions');
      await client.query('grant usage on schema extensions to public');
      // Tenants provisioned before this role existed join it too, so bootstrapping stays a way of
      // bringing a cluster to the state the code expects rather than only a first-run step.
      const table = await client.query(`select to_regclass('platform.tenant') as found`);
      if (table.rows[0]?.found) {
        const { rows } = await client.query<{ role_name: string }>(
          // A row outlives its roles once deleted (TL-I).
          `select role_name from platform.tenant
            where exists (select from pg_roles r where r.rolname = role_name)`,
        );
        for (const row of rows) {
          const role = client.escapeIdentifier(assertTenantRole(row.role_name));
          const owner = client.escapeIdentifier(`${assertTenantRole(row.role_name)}_owner`);
          await client.query(`grant aw_tenant to ${role}`);
          // Tenants from before the restorer's login exist too (the EI plan, EIc).
          await client.query(`grant ${owner}, ${role} to aw_restorer with inherit false`);
          await client.query(
            `grant ${owner}, ${role} to aw_steward with inherit false, admin true`,
          );
        }
      }
      await client.query('revoke create on schema public from public');
      // For a new tenant's schema: `aw_steward` has no other right to make one (TL-N).
      await client.query(
        `grant create on database ${client.escapeIdentifier(
          (await client.query<{ name: string }>('select current_database() as name')).rows[0]!.name,
        )} to aw_steward`,
      );
    }),
  );
}

async function inTransaction(
  adminUrl: string,
  work: (client: pg.Client) => Promise<void>,
): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('begin');
    await work(client);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
