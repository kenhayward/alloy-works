import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant } from './provision.js';
import { openSecret } from '@alloy-works/sealing';
import { configureOrganisationSignIn } from './sign-in.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('migration 0042, over a sign-in configured before it', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0041 and none after, so a tenant can name its secret as it used
    // to, and the migrations after 0042 (0043, W14.5) stay after it.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0042-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 42;
      },
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

    expect((await migrate(db.migratorUrl)).tenants[id]).toEqual([
      '0042_sealed_sign_in_secret',
      '0043_default_theme_caption_placement',
      '0044_connections',
      '0045_connection_credential_target',
      '0046_query_definitions',
      '0047_datasets',
      '0048_bound_values',
      '0049_binding_confirm',
      '0050_publication_bindings',
      '0051_dataset_pending',
      '0052_bound_images',
      '0053_dataset_image_index',
      '0054_connection_test_privilege',
      '0055_bound_tables',
      '0056_table_note_word',
    ]);

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
