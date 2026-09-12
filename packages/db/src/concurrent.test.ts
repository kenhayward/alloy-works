import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant } from './provision.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/**
 * The login roles and every tenant role are cluster-wide, so suites in different databases work on
 * the same rows. Running the same preparation several times at once is what a test run does.
 */
/** Enough at once to collide reliably, on a busy machine as well as a fast one. */
const AT_ONCE = 12;

describe('preparing a cluster from several places at once', () => {
  const databases: TestDatabase[] = [];

  beforeAll(async () => {
    for (let index = 0; index < AT_ONCE; index++) databases.push(await freshDatabase());
  });

  afterAll(async () => {
    for (const db of databases) await db.drop();
  });

  it('lets many databases bootstrap the shared roles at the same time', async () => {
    await expect(
      Promise.all(databases.map((db) => bootstrapCluster(db.adminUrl, TEST_PASSWORDS))),
    ).resolves.toBeDefined();
  });

  it('lets a tenant in each be provisioned at the same time, joining the shared role', async () => {
    for (const db of databases) await migrate(db.migratorUrl);
    const tenants = await Promise.all(
      databases.map((db) =>
        createTenant(db.adminUrl, db.migratorUrl, {
          organisation: { id: 'acme', name: 'Acme' },
          tenant: { id: db.newTenantId(), name: 'Production' },
          hostnames: [`${db.name}.alloy.test`],
        }),
      ),
    );
    expect(tenants).toHaveLength(AT_ONCE);
  });
});
