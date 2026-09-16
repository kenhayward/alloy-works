import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import pg from 'pg';
import type { Tenant } from '../provision.js';
import type { TenantDatabase } from '../tenant-database.js';

/**
 * Runs `work` while another transaction holds the tenant's access epoch FOR SHARE, as every decision in
 * flight does. A write that took the epoch FOR UPDATE would wait for this transaction, which waits for
 * `work` - so a test racing `work` against a timeout shows the write never needs it exclusively.
 */
export async function whileAccessIsDecided<T>(
  db: TenantDatabase,
  tenant: Tenant,
  work: () => Promise<T>,
): Promise<T> {
  return db.withTenant(tenant, async (trx) => {
    await sql`select singleton from access_epoch for share`.execute(trx);
    return work();
  });
}

const DEFAULT_SERVER_URL = 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

export const TEST_PASSWORDS = {
  service: 'aw_service_dev',
  worker: 'aw_worker_dev',
  migrator: 'aw_migrator_dev',
} as const;

export interface TestDatabase {
  readonly name: string;
  readonly adminUrl: string;
  readonly serviceUrl: string;
  readonly workerUrl: string;
  readonly migratorUrl: string;
  /** A tenant id this database will clean up after: `test` and eight hex digits. */
  newTenantId(): string;
  drop(): Promise<void>;
}

function serverUrl(): string {
  return process.env.ALLOY_TEST_DATABASE_URL ?? DEFAULT_SERVER_URL;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function asLogin(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

export async function queryAs(
  url: string,
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

export async function freshDatabase(): Promise<TestDatabase> {
  const server = serverUrl();
  const name = `aw_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: server });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `No Postgres at ${new URL(server).host}. Start it with \`docker compose -f deploy/compose.yaml up -d --wait postgres\`, ` +
        `or point ALLOY_TEST_DATABASE_URL at one. (${(error as Error).message})`,
      { cause: error },
    );
  }
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const adminUrl = withDatabase(server, name);
  const tenantIds: string[] = [];
  return {
    name,
    adminUrl,
    serviceUrl: asLogin(adminUrl, 'aw_service', TEST_PASSWORDS.service),
    workerUrl: asLogin(adminUrl, 'aw_worker', TEST_PASSWORDS.worker),
    migratorUrl: asLogin(adminUrl, 'aw_migrator', TEST_PASSWORDS.migrator),
    newTenantId() {
      const id = `test${randomBytes(4).toString('hex')}`;
      tenantIds.push(id);
      return id;
    },
    async drop() {
      await queryAs(server, `drop database if exists ${name} with (force)`);
      // Roles are cluster-wide and outlive the database; remove the ones this database created.
      for (const id of tenantIds) {
        await queryAs(server, `drop role if exists t_${id}`);
        await queryAs(server, `drop role if exists t_${id}_owner`);
      }
    },
  };
}
