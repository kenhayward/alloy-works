// Development only. Prepares the compose database with two environments of an invented customer,
// reachable at acme.localhost and dev.acme.localhost. Safe to run again.
import pg from 'pg';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { tenantNames } from './names.js';
import { createTenant } from './provision.js';
import { configureOrganisationSignIn, inviteToTenant, permitGoogleSignIn } from './sign-in.js';
import { TEST_PASSWORDS } from './testing/database.js';

const server =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const database = 'alloy_dev';
// The stand-in answers somewhere else when the compose stack runs it.
const standInIssuer = process.env.STAND_IN_ISSUER ?? 'http://127.0.0.1:9090';

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
for (const environment of environments) {
  const tenant = tenantNames(environment.tenant.id);
  await configureOrganisationSignIn(
    adminUrl,
    { id: environment.tenant.id, schema: tenant.schema, role: tenant.role },
    { issuer: standInIssuer, clientId: 'alloy-dev', secretName: 'stand_in' },
  );
}
// The development environment also takes Google accounts, the stand-in playing Google: Grace is
// invited, as a demonstration's first administrator would be; Alice is not, so she is refused.
const development = tenantNames('acmedev');
const developmentTenant = { id: 'acmedev', schema: development.schema, role: development.role };
await permitGoogleSignIn(adminUrl, developmentTenant);
await inviteToTenant(adminUrl, developmentTenant, 'grace@example.com');
console.log(`Ready: database ${database}, service login aw_service / ${TEST_PASSWORDS.service}`);
