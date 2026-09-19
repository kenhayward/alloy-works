// packages/db/src/dev-content.test.ts
import { decide } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { STARTER_COMPONENT_TYPE_ID } from './creation.js';
import { seedDevelopmentContent } from './dev-content.js';
import { inviteFirstAdministrator } from './first-administrator.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
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
        // Decision N: somebody in a development environment may publish what they author.
        expect(decide('publish', facts!).allowed, subject).toBe(true);
      }
      const alice = await trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'alice', email: null, display_name: 'Alice' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const facts = await loadFacts(trx, alice.id, target);
      expect(decide('read', facts!).allowed).toBe(false);

      const grants = await trx.selectFrom('access_grant').select('id').execute();
      // Author and Publisher on General, for each of Ada and Grace.
      expect(grants).toHaveLength(4);
    });
  });

  it('finds Ada by her waiting invitation, and cuts the component as Grace', async () => {
    const invited = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Invited' },
      hostnames: ['invited.acme.alloy.test'],
    });
    await expect(
      inviteFirstAdministrator(db.adminUrl, invited, {
        email: 'ada@example.com',
        namedBy: 'provisioning',
      }),
    ).resolves.toEqual({ invited: true, renewed: false });
    const waiting = await service.withTenant(invited, (trx) =>
      trx
        .selectFrom('invitation')
        .select('principal_id')
        .where('email', '=', 'ada@example.com')
        .executeTakeFirstOrThrow(),
    );

    const seeded = await service.withTenant(invited, (trx) =>
      seedDevelopmentContent(trx, { issuer: ISSUER }),
    );
    expect(seeded.created).toBe(true);

    await service.withTenant(invited, async (trx) => {
      const author = await findRole(trx, 'Author');
      const grant = await trx
        .selectFrom('access_grant')
        .select('id')
        .where('role_id', '=', author!.id)
        .where('principal_id', '=', waiting.principal_id)
        .executeTakeFirst();
      expect(grant, "Ada's Author grant should name the invitation's principal").toBeDefined();

      const grace = await trx
        .selectFrom('principal')
        .select('id')
        .where('issuer', '=', ISSUER)
        .where('subject', '=', 'grace')
        .executeTakeFirstOrThrow();
      const type = await latestVersion(trx, STARTER_COMPONENT_TYPE_ID);
      const component = await latestVersion(trx, seeded.componentId);
      // 0015 (task 1) now gives every tenant this component type unauthored, at migration time -
      // nobody made it, the same as the roles and General. Only the component is still cut by Grace.
      expect(type?.author).toBeNull();
      expect(component?.author).toBe(grace.id);
    });
  });

  it('never resolves Grace to a waiting invitation, even one that happens to name her address', async () => {
    const impostor = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Impostor' },
      hostnames: ['impostor.acme.alloy.test'],
    });
    // A waiting invitation to Grace's address, made the way any invitation route would - never through
    // `inviteFirstAdministrator`, which is Ada's alone in `person()` below. Only Ada's own lookup may
    // ever resolve to a waiting invitation; Grace must always be found or made by her identity, since
    // she authors content (the docstring above), which a principal still waiting on an invitation
    // cannot.
    const stray = await service.withTenant(impostor, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ email: 'grace@example.com', display_name: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('invitation')
        .values({ email: 'grace@example.com', principal_id: principal.id })
        .execute();
      return principal.id;
    });

    const seeded = await service.withTenant(impostor, (trx) =>
      seedDevelopmentContent(trx, { issuer: ISSUER }),
    );
    expect(seeded.created).toBe(true);

    const grace = await service.withTenant(impostor, (trx) =>
      trx
        .selectFrom('principal')
        .select(['id', 'issuer'])
        .where('issuer', '=', ISSUER)
        .where('subject', '=', 'grace')
        .executeTakeFirstOrThrow(),
    );
    expect(grace.id).not.toBe(stray);
    expect(grace.issuer).toBe(ISSUER);
  });
});
