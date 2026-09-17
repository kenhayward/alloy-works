// Development only. Prepares the compose database with two environments of an invented customer,
// reachable at acme.localhost and dev.acme.localhost. Safe to run again.
import pg from 'pg';
import { bootstrapCluster } from './bootstrap.js';
import { seedDevelopmentContent } from './dev-content.js';
import { inviteFirstAdministrator } from './first-administrator.js';
import { migrate } from './migrate.js';
import { tenantNames } from './names.js';
import { addHostnames, createTenant } from './provision.js';
import { configureOrganisationSignIn, permitGoogleSignIn } from './sign-in.js';
import { createTenantDatabase } from './tenant-database.js';
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
// A hostname anything can reach, whatever it makes of `*.localhost`: the end-to-end suite
// uses it.
const extra = process.env.DEV_EXTRA_HOSTNAME;
const environments = [
  { tenant: { id: 'acme', name: 'Production' }, hostnames: ['acme.localhost'] },
  {
    tenant: { id: 'acmedev', name: 'Development' },
    hostnames: extra ? ['dev.acme.localhost', extra] : ['dev.acme.localhost'],
  },
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
  } else {
    // An environment that is already here still takes any address it has not got yet, so running
    // this again is how a development installation catches up rather than starting over.
    await addHostnames(adminUrl, environment.tenant.id, environment.hostnames);
  }
}
await check.end();
for (const environment of environments) {
  const tenant = tenantNames(environment.tenant.id);
  const named = { id: environment.tenant.id, schema: tenant.schema, role: tenant.role };
  // Ada is invited to administer each environment before any route lets anybody sign in, as a real
  // environment's first administrator is. Running this again renews a waiting invitation, or is
  // refused harmlessly once Ada administers.
  const answer = await inviteFirstAdministrator(adminUrl, named, {
    email: 'ada@example.com',
    namedBy: 'pnpm dev:setup',
  });
  if ('invited' in answer && !answer.renewed) {
    console.log(`Ada is invited to administer ${environment.hostnames[0]}`);
  }
  await configureOrganisationSignIn(adminUrl, named, {
    issuer: standInIssuer,
    clientId: 'alloy-dev',
    secretName: 'stand_in',
  });
}
// Something to edit, and Ada and Grace allowed to edit it: nothing in the product grants a content
// role or creates a component yet. As the service's own login, so it is written the way the service
// writes.
const serviceDb = createTenantDatabase(
  inDatabase(server, database, 'aw_service', TEST_PASSWORDS.service),
);
for (const environment of environments) {
  const tenant = tenantNames(environment.tenant.id);
  const seeded = await serviceDb.withTenant(
    { id: environment.tenant.id, schema: tenant.schema, role: tenant.role },
    (trx) => seedDevelopmentContent(trx, { issuer: standInIssuer }),
  );
  if (seeded.created) {
    console.log(`Made "Install the printer" at ${environment.hostnames[0]}, for Ada and Grace`);
  }
}
await serviceDb.close();
// The development environment also takes Google accounts, the stand-in playing Google. Nobody is
// invited only for it: Ada's invitation, Grace as a principal already, and anybody Ada invites from
// Manage access come in by it; Alice, whom nobody invited, is refused.
const development = tenantNames('acmedev');
const developmentTenant = { id: 'acmedev', schema: development.schema, role: development.role };
await permitGoogleSignIn(adminUrl, developmentTenant);
console.log(`Ready: database ${database}, service login aw_service / ${TEST_PASSWORDS.service}`);
