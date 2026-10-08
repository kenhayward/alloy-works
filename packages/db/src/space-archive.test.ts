import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import {
  archiveSpace,
  createSpace,
  listSpacesFor,
  readSpace,
  renameSpace,
  restoreSpace,
  SpaceArchived,
} from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { latestVersion, recordVersion, substanceOf } from './versions.js';

/** A promise and the means to settle it from outside, for holding one transaction open. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

/** Whether `work` is still waiting after a moment: a lock it needs is held elsewhere. */
async function stillWaiting(work: Promise<unknown>): Promise<boolean> {
  const late = Symbol('late');
  const first = await Promise.race([
    work.then(
      () => 'settled',
      () => 'settled',
    ),
    new Promise((done) => setTimeout(() => done(late), 400)),
  ]);
  return first === late;
}

describe('making, renaming, archiving and restoring a space (the SP1 plan)', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let tenants = 0;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  /** A fresh environment, holding General alone, and Ada in it. */
  async function environment(): Promise<{ tenant: Tenant; ada: string; general: string }> {
    tenants += 1;
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: `Environment ${tenants}` },
      hostnames: [`e${tenants}.acme.alloy.test`],
    });
    return service.withTenant(tenant, async (trx) => {
      const ada = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return { tenant, ada: ada.id, general: general.id };
    });
  }

  const component = (trx: TenantTransaction, spaceId: string, author: string) =>
    createComponent(trx, {
      spaceId,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      author,
    });

  it('takes a name of 1 to 200 characters, without a control character, in NFC, compared exactly', async () => {
    const { tenant } = await environment();
    const make = (name: string) => service.withTenant(tenant, (trx) => createSpace(trx, name));
    await expect(make('x'.repeat(201))).rejects.toThrow(/space\.name_invalid/);
    await expect(make('Line\u0007bell')).rejects.toThrow(/space\.name_invalid/);
    await expect(make('Café')).rejects.toThrow(/space\.name_invalid/);
    await expect(make('x'.repeat(200))).resolves.toMatchObject({ name: 'x'.repeat(200) });
    await expect(make('Café')).resolves.toMatchObject({ name: 'Café' });
    // Case matters, as the table's `unique` compares.
    await expect(make('general')).resolves.toMatchObject({ name: 'general' });
    await expect(make('General')).rejects.toThrow(/space\.name_taken/);
  });

  it('renames a space, refusing a name another holds, archived or not, and judging only the new name', async () => {
    const { tenant, ada } = await environment();
    const quality = await service.withTenant(tenant, (trx) => createSpace(trx, 'Quality'));
    const old = await service.withTenant(tenant, (trx) => createSpace(trx, 'Old'));
    await service.withTenant(tenant, (trx) => archiveSpace(trx, old.id, ada));
    const rename = (id: string, name: string) =>
      service.withTenant(tenant, (trx) => renameSpace(trx, id, name));

    await expect(rename(quality.id, 'General')).rejects.toThrow(/space\.name_taken/);
    await expect(rename(quality.id, 'Old')).rejects.toThrow(/space\.name_taken/);
    await expect(rename(quality.id, ' Padded')).rejects.toThrow(/space\.name_invalid/);
    await expect(rename(quality.id, 'Assurance')).resolves.toMatchObject({
      id: quality.id,
      name: 'Assurance',
      archivedAt: null,
    });
    // An archived space may be renamed too, and stays archived.
    await expect(rename(old.id, 'Older')).resolves.toMatchObject({
      name: 'Older',
      archivedBy: ada,
    });
    await expect(rename('00000000-0000-4000-8000-000000000000', 'Nowhere')).resolves.toBe(
      undefined,
    );

    // A refused rename inside a transaction leaves it usable: the savepoint took the failure.
    await service.withTenant(tenant, async (trx) => {
      await expect(renameSpace(trx, quality.id, 'General')).rejects.toThrow(/space\.name_taken/);
      expect((await readSpace(trx, quality.id))?.name).toBe('Assurance');
    });
  });

  it('archives a space, recording who, and restores it, clearing both; the last live space is refused', async () => {
    const { tenant, ada, general } = await environment();
    await expect(
      service.withTenant(tenant, (trx) => archiveSpace(trx, general, ada)),
    ).rejects.toThrow(/space\.last/);

    const quality = await service.withTenant(tenant, (trx) => createSpace(trx, 'Quality'));
    const archived = await service.withTenant(tenant, (trx) => archiveSpace(trx, quality.id, ada));
    expect(archived).toMatchObject({ id: quality.id, archivedBy: ada });
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    // Archiving it again changes nothing.
    await expect(
      service.withTenant(tenant, (trx) => archiveSpace(trx, quality.id, ada)),
    ).resolves.toEqual(archived);
    // General is now the last live space.
    await expect(
      service.withTenant(tenant, (trx) => archiveSpace(trx, general, ada)),
    ).rejects.toThrow(/space\.last/);

    await expect(
      service.withTenant(tenant, (trx) => restoreSpace(trx, quality.id)),
    ).resolves.toMatchObject({ archivedAt: null, archivedBy: null });
    await expect(
      service.withTenant(tenant, (trx) => archiveSpace(trx, general, ada)),
    ).resolves.toMatchObject({ id: general, archivedBy: ada });
  });

  it('lets only one of two archives at once pass, when either would leave one live space', async () => {
    const { tenant, ada, general } = await environment();
    const quality = await service.withTenant(tenant, (trx) => createSpace(trx, 'Quality'));
    const hold = deferred();
    const archived = deferred();
    const first = service.withTenant(tenant, async (trx) => {
      await archiveSpace(trx, quality.id, ada);
      archived.resolve();
      await hold.promise;
    });
    await archived.promise;
    const second = service.withTenant(tenant, (trx) => archiveSpace(trx, general, ada));
    expect(await stillWaiting(second)).toBe(true);
    hold.resolve();
    await first;
    await expect(second).rejects.toThrow(/space\.last/);
  });

  it('refuses a component made in an archived space, and lets what is already there be versioned', async () => {
    const { tenant, ada, general } = await environment();
    const quality = await service.withTenant(tenant, (trx) => createSpace(trx, 'Quality'));
    const made = await service.withTenant(tenant, (trx) => component(trx, quality.id, ada));
    if (made.answer !== 'created') throw new Error(made.answer);
    await service.withTenant(tenant, (trx) => archiveSpace(trx, quality.id, ada));

    const refused = service.withTenant(tenant, (trx) => component(trx, quality.id, ada));
    await expect(refused).rejects.toBeInstanceOf(SpaceArchived);
    await expect(
      service.withTenant(tenant, (trx) => component(trx, general, ada)),
    ).resolves.toMatchObject({ answer: 'created' });

    const next = await service.withTenant(tenant, async (trx) => {
      const latest = await latestVersion(trx, made.version.artifactId);
      const substance = latest && substanceOf(latest);
      if (!latest || substance?.kind !== 'component') throw new Error('no component');
      return recordVersion(trx, {
        artifactId: made.version.artifactId,
        author: ada,
        openedFrom: latest.id,
        substance: {
          ...substance,
          content: { ...substance.content, title: 'Install the scanner' },
        },
      });
    });
    expect(next).toMatchObject({ answer: 'recorded' });
  });

  it('holds a creation and an archive apart: neither commits across the other', async () => {
    const { tenant, ada } = await environment();
    const quality = await service.withTenant(tenant, (trx) => createSpace(trx, 'Quality'));

    // A creation holding the space: the archive waits for it, then passes.
    const creating = deferred();
    const created = deferred();
    const creation = service.withTenant(tenant, async (trx) => {
      const answer = await component(trx, quality.id, ada);
      created.resolve();
      await creating.promise;
      return answer;
    });
    await created.promise;
    const archive = service.withTenant(tenant, (trx) => archiveSpace(trx, quality.id, ada));
    expect(await stillWaiting(archive)).toBe(true);
    creating.resolve();
    await expect(creation).resolves.toMatchObject({ answer: 'created' });
    await expect(archive).resolves.toMatchObject({ archivedBy: ada });

    // An archive holding the space: the creation waits for it, then is refused.
    await service.withTenant(tenant, (trx) => restoreSpace(trx, quality.id));
    const archiving = deferred();
    const done = deferred();
    const second = service.withTenant(tenant, async (trx) => {
      await archiveSpace(trx, quality.id, ada);
      done.resolve();
      await archiving.promise;
    });
    await done.promise;
    const late = service.withTenant(tenant, (trx) => component(trx, quality.id, ada));
    expect(await stillWaiting(late)).toBe(true);
    archiving.resolve();
    await second;
    await expect(late).rejects.toBeInstanceOf(SpaceArchived);
  });

  it('lists an archived space to its readers, marked, never to create in, and leaves it out when asked', async () => {
    const { tenant, ada, general } = await environment();
    const quality = await service.withTenant(tenant, (trx) => createSpace(trx, 'Quality'));
    await service.withTenant(tenant, async (trx) => {
      const author = await findRole(trx, 'Author');
      const answer = await grant(trx, {
        roleId: author!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
      await archiveSpace(trx, quality.id, ada);
    });
    const listed = (options?: { archived?: false }) =>
      service.withTenant(tenant, (trx) =>
        listSpacesFor(trx, ada, undefined, { limit: 100 }, options),
      );
    expect((await listed()).items).toEqual([
      { id: general, name: 'General', archived: false, mayCreate: true },
      { id: quality.id, name: 'Quality', archived: true, mayCreate: false },
    ]);
    expect((await listed({ archived: false })).items).toEqual([
      { id: general, name: 'General', archived: false, mayCreate: true },
    ]);
  });
});
