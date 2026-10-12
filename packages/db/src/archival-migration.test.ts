import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

/**
 * Migration 0083: Administrator gains `retire`, found by its name, whatever an environment has made
 * of its permissions since.
 */
describe('migration 0083, which gives Administrator the retire permission', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0082 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0083-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 83;
      },
    });
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  it('gives an edited Administrator retire and keeps its edit, and no other role gains it', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Edited' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant: Tenant = { ...provisioned, id };
    const roles = () =>
      service.withTenant(tenant, (trx) =>
        trx.selectFrom('role').select(['name', 'permissions']).orderBy('name').execute(),
      );
    // The environment's Administrator may publish too, by its own edit.
    await service.withTenant(tenant, (trx) =>
      sql`update role set permissions = permissions || array['publish']
        where name = 'Administrator'`.execute(trx),
    );
    const edited = await roles();

    await migrate(db.migratorUrl);

    expect(await roles()).toEqual(
      edited.map((role) =>
        role.name === 'Administrator'
          ? { ...role, permissions: [...role.permissions, 'retire'] }
          : role,
      ),
    );
    expect(edited.find((role) => role.name === 'Administrator')!.permissions).toContain('publish');
  });
});
