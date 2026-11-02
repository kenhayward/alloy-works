import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant } from './provision.js';
import { configureOrganisationSignIn, inviteToTenant } from './sign-in.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const KEY = Buffer.alloc(32, 7);

/**
 * Migration 0187: the one provider an environment had becomes the first of any number, and what
 * pointed at it by being the only one - sessions, attempts, provider groups, open invitations - names it.
 */
describe('migration 0187, which makes the one identity provider the first of many', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0186 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0187-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 187;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  const environment = async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    return tenant;
  };

  it('IAM-011 names the existing provider, and what pointed at it names it too', async () => {
    const tenant = await environment();
    const at = (table: string) => `${tenant.schema}.${table}`;
    await queryAs(
      db.adminUrl,
      `insert into ${at('identity_provider')} (issuer, client_id, secret_name)
       values ('https://idp.example', 'alloy', 'stand_in')`,
    );
    const ada = (
      await queryAs(
        db.adminUrl,
        `insert into ${at('principal')} (issuer, subject, email)
         values ('https://idp.example', 'ada', 'ada@example.com') returning id`,
      )
    ).rows[0] as { id: string };
    await queryAs(
      db.adminUrl,
      `insert into ${at('session')} (token_hash, principal_id, route, idle_expires_at, expires_at)
       values ('hash', $1, 'organisation', now() + interval '1 hour', now() + interval '1 hour')`,
      [ada.id],
    );
    await queryAs(
      db.adminUrl,
      `insert into ${at('access_group')} (name, source, provider_value)
       values ('Authors', 'provider', 'authors'), ('Everyone', 'tenant', null)`,
    );
    await inviteToTenant(db.adminUrl, tenant, 'grace@example.com');

    await migrate(db.migratorUrl);

    const provider = (
      await queryAs(db.adminUrl, `select id, name, closed_at from ${at('identity_provider')}`)
    ).rows;
    expect(provider).toEqual([
      { id: expect.any(String), name: 'Your organisation', closed_at: null },
    ]);
    const id = (provider[0] as { id: string }).id;
    expect((await queryAs(db.adminUrl, `select provider_id from ${at('session')}`)).rows).toEqual([
      { provider_id: id },
    ]);
    expect(
      (
        await queryAs(
          db.adminUrl,
          `select name, provider_id from ${at('access_group')}
           where name in ('Authors', 'Everyone') order by name`,
        )
      ).rows,
    ).toEqual([
      { name: 'Authors', provider_id: id },
      { name: 'Everyone', provider_id: null },
    ]);
    expect(
      (await queryAs(db.adminUrl, `select provider_id from ${at('invitation_provider')}`)).rows,
    ).toEqual([{ provider_id: id }]);
  });

  it('IAM-011 an environment with none takes its first provider for the invitations already waiting, and a later one for none', async () => {
    const tenant = await environment();
    const at = (table: string) => `${tenant.schema}.${table}`;
    await migrate(db.migratorUrl);
    await inviteToTenant(db.adminUrl, tenant, 'grace@example.com');
    const ways = async () =>
      (await queryAs(db.adminUrl, `select provider_id from ${at('invitation_provider')}`)).rows;
    expect(await ways()).toEqual([]);

    const first = await configureOrganisationSignIn(
      db.adminUrl,
      tenant,
      { issuer: 'https://idp.example', clientId: 'alloy', clientSecret: 'secret' },
      KEY,
    );
    expect(await ways()).toEqual([{ provider_id: first }]);

    await configureOrganisationSignIn(
      db.adminUrl,
      tenant,
      {
        issuer: 'https://contractors.example',
        clientId: 'alloy',
        clientSecret: 'secret',
        name: 'Contractors',
      },
      KEY,
    );
    expect(await ways()).toEqual([{ provider_id: first }]);
  });
});
