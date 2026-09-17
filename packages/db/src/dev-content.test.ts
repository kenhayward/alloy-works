// packages/db/src/dev-content.test.ts
import { decide } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { seedDevelopmentContent } from './dev-content.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { latestVersion } from './versions.js';

const ISSUER = 'http://127.0.0.1:9090';

describe('the development content', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('makes a component Ada and Grace may edit and Alice may not read, once however often it runs', async () => {
    const first = await service.withTenant(tenant, (trx) =>
      seedDevelopmentContent(trx, { issuer: ISSUER }),
    );
    const second = await service.withTenant(tenant, (trx) =>
      seedDevelopmentContent(trx, { issuer: ISSUER }),
    );
    expect(first.created).toBe(true);
    expect(second).toEqual({ componentId: first.componentId, created: false });

    await service.withTenant(tenant, async (trx) => {
      const version = await latestVersion(trx, first.componentId);
      expect(version).toMatchObject({ revision: 0, version: 1, kind: 'component' });
      expect((version?.content as { title: string }).title).toBe('Install the printer');

      const target = { kind: 'artifact', id: first.componentId } as const;
      for (const subject of ['ada', 'grace']) {
        const principal = await trx
          .selectFrom('principal')
          .select('id')
          .where('issuer', '=', ISSUER)
          .where('subject', '=', subject)
          .executeTakeFirstOrThrow();
        const facts = await loadFacts(trx, principal.id, target);
        expect(decide('edit', facts!).allowed, subject).toBe(true);
      }
      const alice = await trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'alice', email: null, display_name: 'Alice' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const facts = await loadFacts(trx, alice.id, target);
      expect(decide('read', facts!).allowed).toBe(false);

      const grants = await trx.selectFrom('access_grant').select('id').execute();
      expect(grants).toHaveLength(2);
    });
  });
});
