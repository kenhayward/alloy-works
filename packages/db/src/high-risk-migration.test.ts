import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const SIX = [
  'export_environment',
  'export_audit',
  'hold',
  'rotate_secrets',
  'configure_services',
  'configure_webhooks',
];

describe('migration 0190, over roles and tokens made before it', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0190-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      // What comes after 0190 names what 0190 closes: those run after it, as they will have.
      filter: (source) =>
        Number(/\/(\d{4})_[^/]*\.sql$/.exec(source.replaceAll('\\', '/'))?.[1] ?? 0) < 190,
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('gives every role and token holding administer all six, and nobody else any', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const { schema } = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Demonstration' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    await queryAs(
      db.adminUrl,
      `insert into ${schema}.role (name, permissions) values
         ('Own administrator', '{read,administer}'), ('Own reader', '{read}')`,
    );
    const { rows: ada } = await queryAs(
      db.adminUrl,
      `insert into ${schema}.principal (issuer, subject, email)
         values ('https://idp.example', 'ada-1', 'ada@example.com') returning id`,
    );
    await queryAs(
      db.adminUrl,
      `insert into ${schema}.api_token (principal_id, name, token_hash, scopes, expires_at) values
         ('${ada[0]!.id}', 'wide', '${'a'.repeat(64)}', '{administer}', now() + interval '1 day'),
         ('${ada[0]!.id}', 'narrow', '${'b'.repeat(64)}', '{edit}', now() + interval '1 day')`,
    );

    await migrate(db.migratorUrl);

    const { rows: roles } = await queryAs(
      db.adminUrl,
      `select name, permissions from ${schema}.role`,
    );
    const role = (name: string) => roles.find((each) => each.name === name)!.permissions;
    expect(role('Own administrator')).toEqual(expect.arrayContaining(SIX));
    expect(role('Administrator')).toEqual(expect.arrayContaining(SIX));
    expect(role('Own reader')).toEqual(['read']);
    const { rows: tokens } = await queryAs(
      db.adminUrl,
      `select name, scopes from ${schema}.api_token`,
    );
    const token = (name: string) => tokens.find((each) => each.name === name)!.scopes;
    expect(token('wide')).toEqual(expect.arrayContaining(SIX));
    expect(token('narrow')).toEqual(['edit']);
  });
});
