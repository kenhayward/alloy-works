// An installation's own setup, where dev-setup.ts is development's: every value from the environment,
// none published in this repository, no seed, no stand-in. Runs on every deploy.
import pg from 'pg';
import { sealingKey } from '@alloy-works/sealing';
import { asAdministrator } from './admin.js';
import { bootstrapCluster, type LoginPasswords } from './bootstrap.js';
import { inviteFirstAdministrator } from './first-administrator.js';
import { migrate } from './migrate.js';
import { tenantNames } from './names.js';
import { addHostnames, createTenant } from './provision.js';
import { configureOrganisationSignIn } from './sign-in.js';

/** The sealing key compose.yaml publishes. */
const PUBLISHED_KEY = 'ZGV2ZWxvcG1lbnQtb25seS1vYmplY3Qta2V5LTAwMDE=';
const PUBLISHED_CLIENT_SECRET = 'stand-in-dev-secret';
/** Longer than any password this repository publishes, each of which this refuses by that alone. */
const SHORTEST_PASSWORD = 16;

export interface EnvironmentSettings {
  /** A superuser's address on the server. */
  readonly serverUrl: string;
  readonly database: string;
  readonly passwords: LoginPasswords;
  readonly organisation: { readonly id: string; readonly name: string };
  readonly tenant: { readonly id: string; readonly name: string };
  readonly hostname: string;
  readonly firstAdministrator: string;
  readonly signIn: {
    readonly issuer: string;
    readonly clientId: string;
    readonly clientSecret: string;
  };
  readonly sealingKey: Buffer;
}

/** What is wrong with the settings. Names each setting and never says its value. */
export class EnvironmentSettingsRefused extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Environment setup refused:\n${problems.map((each) => `  ${each}`).join('\n')}`);
    this.name = 'EnvironmentSettingsRefused';
  }
}

function isLocalName(name: string): boolean {
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name) ||
    /^[0-9]+$/.test(name.slice(name.lastIndexOf('.') + 1))
  );
}

export function readEnvironmentSettings(
  env: Record<string, string | undefined>,
): EnvironmentSettings {
  const problems: string[] = [];
  const read = (name: string, problem?: (value: string) => string | undefined): string => {
    const value = env[name];
    if (!value) {
      problems.push(`${name} is missing`);
      return '';
    }
    const found = problem?.(value);
    if (found) problems.push(`${name} ${found}`);
    return value;
  };
  const password = (value: string) =>
    value.length < SHORTEST_PASSWORD
      ? `must be at least ${SHORTEST_PASSWORD} characters`
      : undefined;
  const id = (value: string) =>
    /^[0-9a-z]{1,40}$/.test(value) ? undefined : 'must be lower case letters and digits';

  const serverUrl = read('DATABASE_ADMIN_URL', (value) => {
    try {
      const { protocol, password: held } = new URL(value);
      if (protocol !== 'postgres:' && protocol !== 'postgresql:') return 'must be a postgres URL';
      return password(decodeURIComponent(held)) && 'must hold a password of its own';
    } catch {
      return 'must be a postgres URL';
    }
  });
  const database = read('DATABASE_NAME', (value) =>
    /^[a-z][a-z0-9_]{0,62}$/.test(value) ? undefined : 'must be a plain database name',
  );
  const passwords: LoginPasswords = {
    service: read('DATABASE_PASSWORD_SERVICE', password),
    worker: read('DATABASE_PASSWORD_WORKER', password),
    migrator: read('DATABASE_PASSWORD_MIGRATOR', password),
    restorer: read('DATABASE_PASSWORD_RESTORER', password),
    steward: read('DATABASE_PASSWORD_STEWARD', password),
  };
  const organisation = { id: read('ORGANISATION_ID', id), name: read('ORGANISATION_NAME') };
  const tenant = { id: read('ENVIRONMENT_ID', id), name: read('ENVIRONMENT_NAME') };
  const hostname = read('ENVIRONMENT_HOSTNAME', (value) =>
    isLocalName(value) ? 'must be a public name, with no scheme' : undefined,
  );
  const firstAdministrator = read('FIRST_ADMINISTRATOR_EMAIL', (value) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : 'must be an address',
  );
  const issuer = read('SIGN_IN_ISSUER', (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !isLocalName(url.hostname)
        ? undefined
        : 'must be https at a public name';
    } catch {
      return 'must be https at a public name';
    }
  });
  const clientId = read('SIGN_IN_CLIENT_ID');
  const clientSecret = read('SECRET_SIGN_IN_CLIENT', (value) =>
    value === PUBLISHED_CLIENT_SECRET ? 'is the one this repository publishes' : undefined,
  );
  let key: Buffer = Buffer.alloc(0);
  read('SECRET_OBJECT_STORE_KEY', (value) => {
    if (value === PUBLISHED_KEY) return 'is the one this repository publishes';
    try {
      key = sealingKey(value);
      return undefined;
    } catch {
      return 'must be 32 bytes of base64';
    }
  });

  if (problems.length > 0) throw new EnvironmentSettingsRefused(problems);
  return {
    serverUrl,
    database,
    passwords,
    organisation,
    tenant,
    hostname,
    firstAdministrator,
    signIn: { issuer, clientId, clientSecret },
    sealingKey: key,
  };
}

/** The address of the database itself on this server, as its superuser or as `user`. */
export function environmentDatabaseUrl(
  settings: Pick<EnvironmentSettings, 'serverUrl' | 'database'>,
  login?: { readonly user: string; readonly password: string },
): string {
  const url = new URL(settings.serverUrl);
  url.pathname = `/${settings.database}`;
  if (login) {
    url.username = login.user;
    url.password = login.password;
  }
  return url.toString();
}

export interface EnvironmentSetUp {
  /** Whether this run made the environment, rather than finding it. */
  readonly created: boolean;
  /** Whether this run gave it its first administrator and provider. */
  readonly signInConfigured: boolean;
}

/**
 * Brings the database to this release: its logins' passwords, its migrations, and the one environment.
 * Sign-in is configured once, and after that is Administration's: a deploy changes nothing an
 * administrator decided, and does not keep the first administrator's invitation from lapsing.
 */
export async function setUpEnvironment(settings: EnvironmentSettings): Promise<EnvironmentSetUp> {
  const server = new pg.Client({ connectionString: settings.serverUrl });
  await server.connect();
  try {
    const exists = await server.query('select 1 from pg_database where datname = $1', [
      settings.database,
    ]);
    if (exists.rowCount === 0) await server.query(`create database ${settings.database}`);
  } finally {
    await server.end();
  }

  const adminUrl = environmentDatabaseUrl(settings);
  const migratorUrl = environmentDatabaseUrl(settings, {
    user: 'aw_migrator',
    password: settings.passwords.migrator,
  });
  await bootstrapCluster(adminUrl, settings.passwords);
  await migrate(migratorUrl);

  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  let found: { state: string } | undefined;
  try {
    const held = await client.query<{ state: string }>(
      'select state from platform.tenant where id = $1',
      [settings.tenant.id],
    );
    found = held.rows[0];
  } finally {
    await client.end();
  }
  // An id is never used again. Saying so stops a deploy bringing the stack up with nothing to serve.
  if (found?.state === 'deleting' || found?.state === 'deleted') {
    throw new Error(`Environment ${settings.tenant.id} has been deleted`);
  }
  if (found) {
    await addHostnames(adminUrl, settings.tenant.id, [settings.hostname]);
  } else {
    await createTenant(adminUrl, migratorUrl, {
      organisation: settings.organisation,
      tenant: settings.tenant,
      hostnames: [settings.hostname],
    });
  }

  const names = tenantNames(settings.tenant.id);
  const tenant = { id: settings.tenant.id, schema: names.schema, role: names.role };
  const hasProvider = await asAdministrator(adminUrl, tenant, async (admin, schema) => {
    const { rowCount } = await admin.query(`select 1 from ${schema}.identity_provider limit 1`);
    return (rowCount ?? 0) > 0;
  });
  if (hasProvider) return { created: !found, signInConfigured: false };

  // Before any route opens, so nobody can have signed in with the address first (IAM-059). A run that
  // stopped between these two steps renews the invitation and goes on.
  await inviteFirstAdministrator(adminUrl, tenant, {
    email: settings.firstAdministrator,
    namedBy: 'environment setup',
  });
  await configureOrganisationSignIn(adminUrl, tenant, settings.signIn, settings.sealingKey);
  return { created: !found, signInConfigured: true };
}
