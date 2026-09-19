import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import pg from 'pg';
import type { Tenant } from '../provision.js';
import type { TenantTransaction } from '../tables.js';
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

/**
 * What the transaction `trx` has done so far, asked from inside it: whether this backend holds a lock
 * on the tenant's access epoch - which a decision takes FOR SHARE and keeps to the transaction's end -
 * and how many publication requests this transaction wrote, by their `xmin`. For a test showing that a
 * route decided and wrote in one transaction; call it after the work and before the commit.
 */
export async function insideTransaction(
  trx: TenantTransaction,
): Promise<{ readonly holdsAccessEpoch: boolean; readonly requestsWritten: number }> {
  const { rows } = await sql<{ holds: boolean; written: string }>`
    select
      exists (
        select 1 from pg_locks l join pg_class c on c.oid = l.relation
        where c.relname = 'access_epoch' and l.pid = pg_backend_pid() and l.granted
      ) as holds,
      (
        select count(*) from publication_request
        where xmin = xid(pg_current_xact_id_if_assigned())
      ) as written
  `.execute(trx);
  return { holdsAccessEpoch: rows[0]!.holds, requestsWritten: Number(rows[0]!.written) };
}

/**
 * Waits until at least `count` connections to the test database are waiting on a lock, so a test can
 * release what they wait behind knowing each has reached its wait rather than guessing with a sleep.
 * Reads `pg_stat_activity` as an administrator of the database, since the runtime role cannot see
 * another session's wait; fails after five seconds rather than hanging the suite.
 */
export async function untilWaitingOnLocks(adminUrl: string, count: number): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const { rows } = await client.query<{ waiting: number }>(
        `select count(*)::int as waiting from pg_stat_activity
         where datname = current_database()
           and backend_type = 'client backend'
           and pid <> pg_backend_pid()
           and wait_event_type = 'Lock'`,
      );
      if ((rows[0]?.waiting ?? 0) >= count) return;
      if (Date.now() > deadline) {
        throw new Error(
          `Fewer than ${count} connections were waiting on a lock after five seconds`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await client.end();
  }
}

/**
 * Waits until at least `count` other connections are blocked specifically behind `blockerPid`, found
 * through `pg_blocking_pids` rather than `wait_event` alone: the access epoch is FOR SHARE/FOR UPDATE
 * over a row too, so a wait on it shows the identical `wait_event_type = 'Lock', wait_event =
 * 'transactionid'` as a wait on an ordinary row - a poll on the wait event alone cannot tell a wait on
 * the epoch from a wait on a specific row `blockerPid` still holds, and would let a test proceed
 * before the interleaving it names is actually reached. `pg_blocking_pids(pid)` names exactly who a
 * backend is waiting behind, so asking for a wait behind this specific pid does.
 */
export async function untilBlockedBy(
  adminUrl: string,
  blockerPid: number,
  count: number,
): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const { rows } = await client.query<{ waiting: number }>(
        `select count(*)::int as waiting from pg_stat_activity
         where datname = current_database()
           and backend_type = 'client backend'
           and pid <> pg_backend_pid()
           and $1 = any (pg_blocking_pids(pid))`,
        [blockerPid],
      );
      if ((rows[0]?.waiting ?? 0) >= count) return;
      if (Date.now() > deadline) {
        throw new Error(
          `Fewer than ${count} connections were blocked behind backend ${blockerPid} after five seconds`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await client.end();
  }
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
