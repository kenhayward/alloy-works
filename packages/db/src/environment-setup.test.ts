import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EnvironmentSettingsRefused,
  readEnvironmentSettings,
  setUpEnvironment,
  type EnvironmentSettings,
} from './environment-setup.js';
import { createTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const KEY = Buffer.alloc(32, 7);

/** Every setting, each an invented value of the right shape. */
const GOOD = {
  DATABASE_ADMIN_URL: 'postgres://postgres:an-invented-superuser-password@postgres:5432/postgres',
  DATABASE_NAME: 'alloy',
  DATABASE_PASSWORD_SERVICE: 'invented-service-password-1',
  DATABASE_PASSWORD_WORKER: 'invented-worker-password-22',
  DATABASE_PASSWORD_MIGRATOR: 'invented-migrator-password-3',
  DATABASE_PASSWORD_RESTORER: 'invented-restorer-password-4',
  DATABASE_PASSWORD_STEWARD: 'invented-steward-password-55',
  ORGANISATION_ID: 'inventedorg',
  ORGANISATION_NAME: 'An invented organisation',
  ENVIRONMENT_ID: 'staging',
  ENVIRONMENT_NAME: 'Staging',
  ENVIRONMENT_HOSTNAME: 'aw.example.com',
  FIRST_ADMINISTRATOR_EMAIL: 'ada@example.com',
  SIGN_IN_ISSUER: 'https://aw-id.example.com/realms/alloy',
  SIGN_IN_CLIENT_ID: 'alloy-staging',
  SECRET_SIGN_IN_CLIENT: 'an-invented-client-secret',
  SECRET_OBJECT_STORE_KEY: KEY.toString('base64'),
};

function refusal(env: Record<string, string | undefined>): EnvironmentSettingsRefused {
  try {
    readEnvironmentSettings(env);
  } catch (error) {
    if (error instanceof EnvironmentSettingsRefused) return error;
    throw error;
  }
  throw new Error('It was not refused');
}

describe('readEnvironmentSettings', () => {
  it('reads every setting', () => {
    const settings = readEnvironmentSettings(GOOD);
    expect(settings.tenant).toEqual({ id: 'staging', name: 'Staging' });
    expect(settings.hostname).toBe('aw.example.com');
    expect(settings.passwords.service).toBe('invented-service-password-1');
    expect(settings.signIn.issuer).toBe('https://aw-id.example.com/realms/alloy');
    expect(settings.sealingKey.equals(KEY)).toBe(true);
  });

  it('names every setting that is missing, and has no default for any', () => {
    const { problems } = refusal({});
    for (const name of Object.keys(GOOD)) {
      expect(problems.some((problem) => problem.startsWith(`${name} `))).toBe(true);
    }
  });

  it.each([
    ['DATABASE_PASSWORD_SERVICE', 'aw_service_dev'],
    ['DATABASE_PASSWORD_WORKER', 'aw_worker_dev'],
    ['DATABASE_PASSWORD_MIGRATOR', 'aw_migrator_dev'],
    ['DATABASE_PASSWORD_RESTORER', 'aw_restorer_dev'],
    ['DATABASE_PASSWORD_STEWARD', 'aw_steward_dev'],
    ['SECRET_SIGN_IN_CLIENT', 'stand-in-dev-secret'],
    ['SECRET_OBJECT_STORE_KEY', 'ZGV2ZWxvcG1lbnQtb25seS1vYmplY3Qta2V5LTAwMDE='],
    ['DATABASE_ADMIN_URL', 'postgres://postgres:postgres@postgres:5432/postgres'],
  ])('refuses %s holding the value the repository publishes', (name, value) => {
    const { problems } = refusal({ ...GOOD, [name]: value });
    expect(problems.some((problem) => problem.startsWith(`${name} `))).toBe(true);
  });

  it('never says a value, only a name', () => {
    const secret = 'short';
    const { message } = refusal({ ...GOOD, DATABASE_PASSWORD_SERVICE: secret });
    expect(message).toContain('DATABASE_PASSWORD_SERVICE');
    expect(message).not.toContain(secret);
  });

  it.each([
    ['DATABASE_PASSWORD_SERVICE', 'too-short'],
    ['SECRET_OBJECT_STORE_KEY', 'not 32 bytes'],
    ['SIGN_IN_ISSUER', 'http://aw-id.example.com/realms/alloy'],
    ['SIGN_IN_ISSUER', 'https://idp.localhost/realms/alloy'],
    ['ENVIRONMENT_HOSTNAME', 'dev.acme.localhost'],
    ['ENVIRONMENT_HOSTNAME', 'localhost'],
    ['ENVIRONMENT_HOSTNAME', '192.168.1.20'],
    ['ENVIRONMENT_HOSTNAME', 'https://aw.example.com'],
    ['ENVIRONMENT_ID', 'Not-Valid'],
    ['ORGANISATION_ID', 'Not-Valid'],
    ['DATABASE_NAME', 'alloy; drop database alloy'],
    ['FIRST_ADMINISTRATOR_EMAIL', 'nobody'],
  ])('refuses %s of %s', (name, value) => {
    const { problems } = refusal({ ...GOOD, [name]: value });
    expect(problems.some((problem) => problem.startsWith(`${name} `))).toBe(true);
  });
});

describe('setUpEnvironment', () => {
  let db: TestDatabase;
  let id: string;
  let settings: EnvironmentSettings;
  let schema: string;

  const provider = {
    issuer: 'https://aw-id.example.com/realms/alloy',
    clientId: 'alloy-staging',
    clientSecret: 'an-invented-client-secret',
  };

  beforeAll(async () => {
    db = await freshDatabase();
    id = db.newTenantId();
    schema = `t_${id}`;
    settings = {
      serverUrl: db.adminUrl,
      database: new URL(db.adminUrl).pathname.slice(1),
      // The cluster's login roles are shared with every other test file, so they keep their passwords.
      passwords: TEST_PASSWORDS,
      organisation: { id: 'inventedorg', name: 'An invented organisation' },
      tenant: { id, name: 'Staging' },
      hostname: `${id}.example.com`,
      firstAdministrator: 'ada@example.com',
      signIn: provider,
      sealingKey: KEY,
    };
    await setUpEnvironment(settings);
  });

  afterAll(() => db.drop());

  it('makes the one environment, at the one address', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select t.id, t.kind, h.hostname from platform.tenant t
       join platform.tenant_hostname h on h.tenant_id = t.id
       where t.id = $1`,
      [id],
    );
    expect(rows).toEqual([{ id, kind: 'content', hostname: `${id}.example.com` }]);
  });

  it('seeds nothing a development setup would: no content and no development person', async () => {
    // Only what provisioning gives any tenant, as a tenant made directly shows.
    const plain = db.newTenantId();
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: settings.organisation,
      tenant: { id: plain, name: 'Plain' },
      hostnames: [`${plain}.example.com`],
    });
    const artifacts = (name: string) =>
      queryAs(db.adminUrl, `select id from ${name}.artifact order by id`);
    expect((await artifacts(schema)).rows).toEqual((await artifacts(`t_${plain}`)).rows);
    const people = await queryAs(db.adminUrl, `select email from ${schema}.principal`);
    expect(people.rows).toEqual([{ email: 'ada@example.com' }]);
  });

  it('IAM-059 invites the first administrator by address, naming who provisioned it', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select i.email, i.named_by, r.name as role
       from ${schema}.invitation i
       join ${schema}.access_grant g on g.principal_id = i.principal_id
       join ${schema}.role r on r.id = g.role_id
       where g.level = 'tenant' and g.effect = 'allow'`,
    );
    expect(rows).toEqual([
      { email: 'ada@example.com', named_by: 'environment setup', role: 'Administrator' },
    ]);
  });

  it('opens the organisation route alone, at the issuer it was given, with its secret sealed', async () => {
    const routes = await queryAs(db.adminUrl, `select route from ${schema}.sign_in_route`);
    expect(routes.rows).toEqual([{ route: 'organisation' }]);
    const providers = await queryAs(
      db.adminUrl,
      `select issuer, client_id, sealed_secret from ${schema}.identity_provider`,
    );
    expect(providers.rows).toHaveLength(1);
    const held = providers.rows[0] as { issuer: string; client_id: string; sealed_secret: string };
    expect(held.issuer).toBe(provider.issuer);
    expect(held.client_id).toBe(provider.clientId);
    expect(held.sealed_secret).not.toContain(provider.clientSecret);
  });

  it('runs again on every deploy without undoing what an administrator changed', async () => {
    // An administrator renames the provider and closes it, in Administration.
    await queryAs(
      db.adminUrl,
      `update ${schema}.identity_provider set name = 'Renamed', closed_at = now()`,
    );
    const before = await queryAs(db.adminUrl, `select count(*)::int as n from ${schema}.principal`);

    const again = await setUpEnvironment(settings);

    expect(again.created).toBe(false);
    expect(again.signInConfigured).toBe(false);
    const providers = await queryAs(
      db.adminUrl,
      `select name, closed_at is not null as closed from ${schema}.identity_provider`,
    );
    expect(providers.rows).toEqual([{ name: 'Renamed', closed: true }]);
    const after = await queryAs(db.adminUrl, `select count(*)::int as n from ${schema}.principal`);
    expect(after.rows).toEqual(before.rows);
  });

  it('takes a new address when the setting changes', async () => {
    const moved = `moved${id}.example.com`;
    await setUpEnvironment({ ...settings, hostname: moved });
    const { rows } = await queryAs(
      db.adminUrl,
      `select hostname from platform.tenant_hostname where hostname = $1 and tenant_id = $2`,
      [moved, id],
    );
    expect(rows).toHaveLength(1);
  });

  it('refuses to bring back an environment that has been deleted', async () => {
    const other = db.newTenantId();
    const gone = {
      ...settings,
      tenant: { id: other, name: 'Gone' },
      hostname: `${other}.example.com`,
    };
    await setUpEnvironment(gone);
    await queryAs(db.adminUrl, `update platform.tenant set state = 'deleted' where id = $1`, [
      other,
    ]);
    await expect(setUpEnvironment(gone)).rejects.toThrow(/deleted/);
  });
});
