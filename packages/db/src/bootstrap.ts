import pg from 'pg';

export interface LoginPasswords {
  readonly service: string;
  readonly worker: string;
  readonly migrator: string;
}

const LOGIN_ROLES = [
  ['aw_service', 'service'],
  ['aw_worker', 'worker'],
  ['aw_migrator', 'migrator'],
] as const;

/**
 * Prepares a database for Alloy Works, run as an administrator. Safe to run again: roles are
 * created when missing and brought back to their intended attributes when not.
 *
 * The login roles are NOINHERIT and hold no rights of their own on tenant data. They reach a
 * tenant only by assuming its role inside a transaction (see tenant-database.ts).
 */
export async function bootstrapCluster(adminUrl: string, passwords: LoginPasswords): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('begin');
    for (const [role, key] of LOGIN_ROLES) {
      const existing = await client.query('select 1 from pg_roles where rolname = $1', [role]);
      if (existing.rowCount === 0) {
        await client.query(`create role ${role} login noinherit`);
      }
      await client.query(
        `alter role ${role} login noinherit nosuperuser nocreaterole nocreatedb password ${client.escapeLiteral(passwords[key])}`,
      );
    }
    await client.query('create schema if not exists platform authorization aw_migrator');
    await client.query('create schema if not exists extensions');
    await client.query('create extension if not exists vector schema extensions');
    await client.query('grant usage on schema extensions to public');
    await client.query('revoke create on schema public from public');
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
