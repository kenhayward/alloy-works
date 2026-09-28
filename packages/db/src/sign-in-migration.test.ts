import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant } from './provision.js';
import { openSecret } from './seal.js';
import { configureOrganisationSignIn } from './sign-in.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('migration 0040, over a sign-in configured before it', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every migration up to 0039 and not 0040, so a tenant can name its secret as it used to.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0040-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => !source.endsWith('0040_sealed_sign_in_secret.sql'),
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('keeps the name it was configured with, seals nothing it names, and takes a sealed secret when configured again', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const table = `${tenant.schema}.identity_provider`;
    await queryAs(
      db.adminUrl,
      `insert into ${table} (issuer, client_id, secret_name) values ('https://idp.example', 'alloy', 'stand_in')`,
    );

    expect((await migrate(db.migratorUrl)).tenants[id]).toEqual(['0040_sealed_sign_in_secret']);

    const read = async () =>
      (
        await queryAs(
          db.adminUrl,
          `select issuer, client_id, secret_name, sealed_secret, groups_claim from ${table}`,
        )
      ).rows;
    expect(await read()).toEqual([
      {
        issuer: 'https://idp.example',
        client_id: 'alloy',
        secret_name: 'stand_in',
        sealed_secret: null,
        groups_claim: 'groups',
      },
    ]);

    const key = randomBytes(32);
    await configureOrganisationSignIn(
      db.adminUrl,
      tenant,
      { issuer: 'https://idp.example', clientId: 'alloy', clientSecret: 'its-own-secret' },
      key,
    );
    const [row] = await read();
    expect(row).toMatchObject({ secret_name: null, groups_claim: 'groups' });
    expect(openSecret(key, 'sign-in', id, row.sealed_secret)).toBe('its-own-secret');
  });
});
