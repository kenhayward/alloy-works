import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { artifactKinds, spacedKinds } from './artifact-kind.js';
import { bootstrapCluster } from './bootstrap.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace, listSpacesFor } from './spaces.js';
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

  it('puts a content artifact and a publication in exactly one space, and a definition in none', async () => {
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
      // A publication lives in its document's space, as content does (0017, finding 9).
      const spaced = (spacedKinds as readonly string[]).includes(kind);
      await expect(insert(kind, spaced ? space.id : null)).resolves.toEqual({ kind });
      await expect(insert(kind, spaced ? null : space.id)).rejects.toThrow(
        /artifact_space_by_kind/,
      );
    }
  });

  it('refuses a kind the version chain does not hold', async () => {
    await expect(
      service.withTenant(production, (trx) =>
        // Not 'document' any more: 0016 made it a kind the chain holds, so it now fails
        // artifact_space_by_kind instead. A template is the next kind to arrive, by a migration
        // widening this check (TPL's plan).
        sql`insert into artifact (kind) values ('template')`.execute(trx),
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

  it('lists a principal the spaces they may read, and where they may create', async () => {
    // Not 'General': every tenant already holds one (0009_access.sql), which would collide.
    const general = await service.withTenant(production, (trx) => createSpace(trx, 'Editorial'));
    const quality = await service.withTenant(production, (trx) => createSpace(trx, 'Review'));
    const ada = await service.withTenant(production, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: null })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    await service.withTenant(production, async (trx) => {
      const author = await findRole(trx, 'Author');
      const reader = await findRole(trx, 'Reader');
      const authored = await grant(trx, {
        roleId: author!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general.id },
        effect: 'allow',
        grantedBy: ada,
      });
      if (!('granted' in authored)) throw new Error(`refused: ${authored.refused}`);
      const read = await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: quality.id },
        effect: 'allow',
        grantedBy: ada,
      });
      if (!('granted' in read)) throw new Error(`refused: ${read.refused}`);
    });

    expect(await service.withTenant(production, (trx) => listSpacesFor(trx, ada))).toEqual([
      { id: general.id, name: 'Editorial', mayCreate: true },
      { id: quality.id, name: 'Review', mayCreate: false },
    ]);

    // A real principal in `development`, holding a real grant there - not `ada`'s id reused under
    // `development`, which is never a principal there at all: `principalOf` would return undefined
    // for any id nobody created in that tenant, so an empty listing from that would prove nothing
    // about tenant isolation, only that the id was never inserted.
    const elsewhere = await service.withTenant(development, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ivy', email: null, display_name: null })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    await service.withTenant(development, async (trx) => {
      const reader = await findRole(trx, 'Reader');
      const generalInDevelopment = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const granted = await grant(trx, {
        roleId: reader!.id,
        subject: { principal: elsewhere },
        level: { kind: 'space', id: generalInDevelopment.id },
        effect: 'allow',
        grantedBy: elsewhere,
      });
      if (!('granted' in granted)) throw new Error(`refused: ${granted.refused}`);
    });
    const seenFromProduction = await service.withTenant(production, (trx) =>
      listSpacesFor(trx, elsewhere),
    );
    expect(seenFromProduction.map((space) => space.name)).not.toContain('Editorial');
    expect(seenFromProduction.map((space) => space.name)).not.toContain('Review');
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
