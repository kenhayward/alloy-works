import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('migrate: the platform schema', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
  });

  afterAll(() => db.drop());

  it('applies the platform migrations once and records them', async () => {
    const first = await migrate(db.migratorUrl);
    expect(first.platform).toEqual(['0001_tenancy']);

    const second = await migrate(db.migratorUrl);
    expect(second.platform).toEqual([]);

    const { rows } = await queryAs(db.adminUrl, 'select version from platform.schema_migration');
    expect(rows).toEqual([{ version: '0001_tenancy' }]);
  });

  it('lets the service and worker read tenants and hostnames but change nothing', async () => {
    for (const url of [db.serviceUrl, db.workerUrl]) {
      await expect(queryAs(url, 'select * from platform.tenant')).resolves.toBeDefined();
      await expect(queryAs(url, 'select * from platform.tenant_hostname')).resolves.toBeDefined();
      await expect(
        queryAs(url, `insert into platform.organisation (id, name) values ('acme', 'Acme')`),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('keeps hostnames in lower case', async () => {
    await queryAs(
      db.adminUrl,
      `insert into platform.organisation (id, name) values ('acme', 'Acme')`,
    );
    await queryAs(
      db.adminUrl,
      `insert into platform.tenant (id, organisation_id, name, schema_name, role_name)
       values ('acme', 'acme', 'Production', 't_acme', 't_acme')`,
    );
    await expect(
      queryAs(
        db.adminUrl,
        `insert into platform.tenant_hostname (hostname, tenant_id) values ('Acme.alloy.test', 'acme')`,
      ),
    ).rejects.toThrow(/tenant_hostname_hostname_check/);
  });
});
