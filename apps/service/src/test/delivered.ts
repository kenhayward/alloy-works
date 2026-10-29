import { deliveredNames } from '@alloy-works/db';
import { queryAs } from '@alloy-works/db/testing';

/** The test server the suites are given (the throwaway one locally, CI's own there). */
const SERVER =
  process.env['ALLOY_TEST_DATABASE_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5436/postgres';

/**
 * The delivery store's database on the test server: its host, port and superuser, the database
 * `delivered_test`, owned by that superuser as the real one is.
 */
export const DELIVERED_URL = (() => {
  const url = new URL(SERVER);
  url.pathname = '/delivered_test';
  return url.toString();
})();

/** Makes the delivery store's database if the test server has none yet. */
export async function ensureDeliveredDatabase(): Promise<void> {
  const found = await queryAs(SERVER, "select 1 from pg_database where datname = 'delivered_test'");
  if (found.rowCount === 0) await queryAs(SERVER, 'create database delivered_test');
}

/** Drops what the delivery store holds for a tenant: its schema and its read role. */
export async function dropDelivered(tenantId: string): Promise<void> {
  const { schema, account } = deliveredNames(tenantId);
  await queryAs(DELIVERED_URL, `drop schema if exists "${schema}" cascade`);
  const role = await queryAs(DELIVERED_URL, 'select 1 from pg_roles where rolname = $1', [account]);
  if (role.rowCount) {
    await queryAs(DELIVERED_URL, `drop owned by "${account}"`);
    await queryAs(DELIVERED_URL, `drop role "${account}"`);
  }
}
