import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactKinds, contentKinds } from './artifact-kind.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('spaces and artifacts', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('creates a space with a name unique within the tenant, and not across tenants', async () => {
    const space = await service.withTenant(production, (trx) => createSpace(trx, 'Regulatory'));
    expect(space).toMatchObject({ name: 'Regulatory' });
    expect(space.id).toMatch(/^[0-9a-f-]{36}$/);

    await expect(
      service.withTenant(production, (trx) => createSpace(trx, 'Regulatory')),
    ).rejects.toThrow(/space_name_key/);
    await expect(
      service.withTenant(development, (trx) => createSpace(trx, 'Regulatory')),
    ).resolves.toMatchObject({ name: 'Regulatory' });
  });

  it('refuses a space name that is empty or carries surrounding spaces', async () => {
    for (const name of ['', ' Quality', 'Quality ']) {
      await expect(service.withTenant(production, (trx) => createSpace(trx, name))).rejects.toThrow(
        /space_name_check/,
      );
    }
  });

  it('puts a content artifact in exactly one space, and a definition in none', async () => {
    const space = await service.withTenant(production, (trx) => createSpace(trx, 'Clinical'));
    const insert = (kind: (typeof artifactKinds)[number], spaceId: string | null) =>
      service.withTenant(production, (trx) =>
        trx
          .insertInto('artifact')
          .values({ kind, space_id: spaceId })
          .returning('kind')
          .executeTakeFirstOrThrow(),
      );

    for (const kind of artifactKinds) {
      const content = (contentKinds as readonly string[]).includes(kind);
      await expect(insert(kind, content ? space.id : null)).resolves.toEqual({ kind });
      await expect(insert(kind, content ? null : space.id)).rejects.toThrow(
        /artifact_space_by_kind/,
      );
    }
  });

  it('refuses a kind the version chain does not hold', async () => {
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into artifact (kind) values ('document')`.execute(trx),
      ),
    ).rejects.toThrow(/artifact_kind_check/);
  });

  it('never changes an artifact once it exists: the runtime role holds no update', async () => {
    const artifact = await service.withTenant(production, (trx) =>
      trx
        .insertInto('artifact')
        .values({ kind: 'field', space_id: null })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await expect(
      service.withTenant(production, (trx) =>
        sql`update artifact set kind = 'metadataSchema' where id = ${artifact.id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("cannot see another tenant's space, or put an artifact in one", async () => {
    const theirs = await service.withTenant(development, (trx) => createSpace(trx, 'Theirs'));
    const seen = await service.withTenant(production, (trx) =>
      trx.selectFrom('space').selectAll().where('id', '=', theirs.id).execute(),
    );
    expect(seen).toEqual([]);
    await expect(
      service.withTenant(production, (trx) =>
        trx.insertInto('artifact').values({ kind: 'component', space_id: theirs.id }).execute(),
      ),
    ).rejects.toThrow(/artifact_space_id_fkey/);
  });
});
