import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ContentDocument } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archiveEntry, createEntry, entryUses } from './bibliography.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';

/** A component's next version, its paragraph citing `entry`. */
async function citing(trx: TenantTransaction, from: StoredVersion, entry: string, by: string) {
  const substance = substanceOf(from);
  if (substance.kind !== 'component') throw new Error('not a component');
  const content = {
    ...substance.content,
    content: [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [{ type: 'citation', entry }],
      },
    ],
  } as ContentDocument;
  const next = await recordVersion(trx, {
    artifactId: from.artifactId,
    openedFrom: from.id,
    author: by,
    substance: { ...substance, content },
  });
  if (next.answer !== 'recorded') throw new Error(next.answer);
  return next.version;
}

/**
 * Migration 0145: bibliography entries as an artifact kind, each one's key unique in its space and its
 * identities indexed. A tenant whose components cite the fixtures' entries by name, before any entry
 * existed, is migrated with nothing to index.
 */
describe('migration 0145, which makes a bibliography entry an artifact kind', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0145-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 145;
      },
    });
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  it('keeps an earlier citation by name, and indexes one of an entry made after it', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Earlier' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant: Tenant = { ...provisioned, id };

    // Written by today's code on the schema before 0145.
    const seeded = await service.withTenant(tenant, async (trx) => {
      const ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Weir',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return { ada, general, weir: await citing(trx, made.version, 'bib-1', ada) };
    });

    await migrate(db.migratorUrl);

    const after = await service.withTenant(tenant, async (trx) => {
      const created = await createEntry(trx, {
        author: seeded.ada,
        spaceId: seeded.general,
        entry: { csl: { type: 'book', title: 'Weirs and Locks', issued: { raw: '1998' } } },
      });
      if (created.answer !== 'created') throw new Error(created.answer);
      const weir = await citing(trx, seeded.weir, created.entry.id, seeded.ada);
      return {
        entry: created.entry,
        weir,
        uses: await entryUses(trx, seeded.ada, created.entry.id),
        archived: await archiveEntry(trx, created.entry.id, seeded.ada, 'archived'),
      };
    });
    expect(after.entry.entry.key).toBe('weirs1998');
    expect(after.uses.components.named).toEqual([{ id: after.weir.artifactId, title: 'Weir' }]);
    expect(after.archived).toBe('cited');
  });
});
