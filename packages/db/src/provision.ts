import pg from 'pg';
import { migrate } from './migrate.js';
import { tenantNames } from './names.js';

export interface Tenant {
  readonly id: string;
  readonly schema: string;
  readonly role: string;
}

export interface NewTenant {
  readonly organisation: { readonly id: string; readonly name: string };
  readonly tenant: { readonly id: string; readonly name: string };
  readonly hostnames: readonly string[];
}

/**
 * Creates a tenant's roles, schema and platform rows in one transaction, run as an administrator.
 * It does not create the tenant's tables: `migrate` does, as the tenant's owner role.
 */
export async function provisionTenant(adminUrl: string, input: NewTenant): Promise<Tenant> {
  const names = tenantNames(input.tenant.id);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const id = (name: string) => client.escapeIdentifier(name);
  try {
    await client.query('begin');
    await client.query(`create role ${id(names.owner)} nologin`);
    await client.query(`create role ${id(names.role)} nologin`);
    // Inherited, unlike the login roles' membership: inside withTenant the tenant's role carries the
    // rights every tenant has, which is how it puts its own work on the queue.
    await client.query(`grant aw_tenant to ${id(names.role)}`);
    await client.query(`create schema ${id(names.schema)} authorization ${id(names.owner)}`);
    await client.query(`grant usage on schema ${id(names.schema)} to ${id(names.role)}`);
    await client.query(
      `alter default privileges for role ${id(names.owner)} in schema ${id(names.schema)}
         grant select, insert, update, delete on tables to ${id(names.role)}`,
    );
    await client.query(
      `alter default privileges for role ${id(names.owner)} in schema ${id(names.schema)}
         grant usage, select on sequences to ${id(names.role)}`,
    );
    // Assumable, never inherited: code that skips withTenant runs as the login role, and is refused.
    await client.query(`grant ${id(names.role)} to aw_service, aw_worker with inherit false`);
    await client.query(`grant ${id(names.owner)} to aw_migrator with inherit false`);
    await client.query(
      'insert into platform.organisation (id, name) values ($1, $2) on conflict (id) do nothing',
      [input.organisation.id, input.organisation.name],
    );
    await client.query(
      `insert into platform.tenant (id, organisation_id, name, schema_name, role_name)
       values ($1, $2, $3, $4, $5)`,
      [input.tenant.id, input.organisation.id, input.tenant.name, names.schema, names.role],
    );
    for (const hostname of input.hostnames) {
      await client.query(
        'insert into platform.tenant_hostname (hostname, tenant_id) values ($1, $2)',
        [hostname.toLowerCase(), input.tenant.id],
      );
    }
    await client.query('commit');
    return { id: input.tenant.id, schema: names.schema, role: names.role };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

/** Provisions a tenant and migrates it to the current version: the way a new tenant is made. */
export async function createTenant(
  adminUrl: string,
  migratorUrl: string,
  input: NewTenant,
): Promise<Tenant> {
  const tenant = await provisionTenant(adminUrl, input);
  await migrate(migratorUrl);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(
      `insert into ${client.escapeIdentifier(tenant.schema)}.profile (display_name) values ($1)`,
      [input.tenant.name],
    );
  } finally {
    await client.end();
  }
  return tenant;
}
