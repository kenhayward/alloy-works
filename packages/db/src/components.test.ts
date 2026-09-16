// packages/db/src/components.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { listReadableComponents } from './components.js';
import { seedDevelopmentContent } from './dev-content.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { createArtifact, latestVersion } from './versions.js';

const ISSUER = 'https://idp.example';

describe('listing the components a principal may read', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let seeded: string;
  let others: string[];
  let hidden: string;

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
    await service.withTenant(development, (trx) => seedDevelopmentContent(trx, { issuer: ISSUER }));
    await service.withTenant(production, async (trx) => {
      seeded = (await seedDevelopmentContent(trx, { issuer: ISSUER })).componentId;
      const who = (subject: string) =>
        trx
          .selectFrom('principal')
          .select('id')
          .where('subject', '=', subject)
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await who('ada');
      grace = await who('grace');
      const first = (await latestVersion(trx, seeded))!;
      const general = await trx
        .selectFrom('artifact')
        .select('space_id')
        .where('id', '=', seeded)
        .executeTakeFirstOrThrow();
      const make = async (spaceId: string, title: string) =>
        (
          await createArtifact(trx, {
            author: ada,
            spaceId,
            substance: {
              kind: 'component',
              content: { ...(first.content as object), title } as never,
              values: {},
              notCarried: [],
              definitions: first.definitions,
            },
          })
        ).artifactId;
      others = [];
      for (const title of ['Replace the toner', 'Clear a paper jam', 'Clean the rollers']) {
        others.push(await make(general.space_id!, title));
      }
      const quality = await createSpace(trx, 'Quality');
      hidden = await make(quality.id, 'Audit the fleet');
      // Grace may not read one of General's components.
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: grace },
        level: { kind: 'artifact', id: others[0]! },
        effect: 'deny',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const all = async (principal: string, limit: number, tenant = production) => {
    const seen: { id: string; title: string }[] = [];
    let after: string | undefined;
    for (let pages = 0; pages < 10; pages += 1) {
      const page = await service.withTenant(tenant, (trx) =>
        listReadableComponents(trx, principal, { ...(after ? { after } : {}), limit }),
      );
      if (!page) throw new Error('no such principal');
      seen.push(...page.items.map(({ id, title }) => ({ id, title })));
      if (page.after === null) return seen;
      after = page.after;
    }
    throw new Error('never reached the end');
  };

  it('lists every component in the spaces a principal may read, with its title, space and number', async () => {
    const page = await service.withTenant(production, (trx) =>
      listReadableComponents(trx, ada, { limit: 50 }),
    );
    expect(page?.items.map((item) => item.id).sort()).toEqual([seeded, ...others].sort());
    expect(page?.items.find((item) => item.id === seeded)).toEqual({
      id: seeded,
      title: 'Install the printer',
      space: { id: expect.any(String), name: 'General' },
      revision: 0,
      version: 1,
    });
    expect(page?.after).toBeNull();
  });

  it('leaves out what a grant on the component itself refuses, and every space not granted', async () => {
    const seen = await all(grace, 50);
    expect(seen.map((item) => item.id)).not.toContain(others[0]);
    expect(seen.map((item) => item.id)).not.toContain(hidden);
    expect(seen).toHaveLength(3);
  });

  it('pages in a stable order, every component once, however small the page', async () => {
    const whole = await all(ada, 50);
    const paged = await all(ada, 1);
    expect(paged).toEqual(whole);
    expect(whole.map((item) => item.id)).toEqual([...whole.map((item) => item.id)].sort());
  });

  it('lists nothing of another tenant, and nothing for a principal it does not hold', async () => {
    const elsewhere = await all(
      await service.withTenant(development, (trx) =>
        trx
          .selectFrom('principal')
          .select('id')
          .where('subject', '=', 'ada')
          .executeTakeFirstOrThrow()
          .then((row) => row.id),
      ),
      50,
      development,
    );
    expect(elsewhere.map((item) => item.id)).not.toContain(seeded);
    expect(elsewhere).toHaveLength(1);
    const stranger = await service.withTenant(development, (trx) =>
      listReadableComponents(trx, ada, { limit: 50 }),
    );
    expect(stranger).toBeUndefined();
  });
});
