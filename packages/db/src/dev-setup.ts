// Development only. Prepares the compose database with two environments of an invented customer,
// reachable at acme.localhost and dev.acme.localhost. Safe to run again.
import pg from 'pg';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant } from './provision.js';
import { TEST_PASSWORDS } from './testing/database.js';

const server =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const database = 'alloy_dev';

function inDatabase(url: string, name: string, user?: string, password?: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  if (user && password) {
    parsed.username = user;
    parsed.password = password;
  }
  return parsed.toString();
}

const admin = new pg.Client({ connectionString: server });
await admin.connect();
const exists = await admin.query('select 1 from pg_database where datname = $1', [database]);
if (exists.rowCount === 0) await admin.query(`create database ${database}`);
await admin.end();

const adminUrl = inDatabase(server, database);
const migratorUrl = inDatabase(server, database, 'aw_migrator', TEST_PASSWORDS.migrator);
await bootstrapCluster(adminUrl, TEST_PASSWORDS);
await migrate(migratorUrl);

const organisation = { id: 'acme', name: 'Acme' };
const environments = [
  { tenant: { id: 'acme', name: 'Production' }, hostnames: ['acme.localhost'] },
  { tenant: { id: 'acmedev', name: 'Development' }, hostnames: ['dev.acme.localhost'] },
];
const check = new pg.Client({ connectionString: adminUrl });
await check.connect();
for (const environment of environments) {
  const found = await check.query('select 1 from platform.tenant where id = $1', [
    environment.tenant.id,
  ]);
  if (found.rowCount === 0) {
    await createTenant(adminUrl, migratorUrl, { organisation, ...environment });
    console.log(`Created ${environment.hostnames[0]}`);
  }
}
await check.end();
console.log(`Ready: database ${database}, service login aw_service / ${TEST_PASSWORDS.service}`);
