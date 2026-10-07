import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  defaultLayout as productDefaultLayout,
  EIGHTH_DEFAULT_LAYOUT,
  type Layout,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { DEFAULT_LAYOUT_ID, defaultLayout } from './layouts.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { recordVersion } from './versions.js';

/**
 * Migration 0056 (the TB3 plan, TB3-F): the default layout's 0.9, the word a table's note follows,
 * only over the product's own 0.8, so an environment that recorded a layout of its own keeps it.
 */
describe("migration 0056, which gives the default layout the word a table's note follows", () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration before 0056 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0056-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 56;
      },
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  /** A tenant standing before 0056, with Ada in it. */
  const beforeNote = async (name: string) => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant: Tenant = { ...provisioned, id };
    const ada = await service.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    return { tenant, ada };
  };

  const layoutChain = (tenant: Tenant) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['id', 'version_no', 'author_id', 'schema_version', 'content'])
        .where('artifact_id', '=', DEFAULT_LAYOUT_ID)
        .orderBy('revision_no')
        .orderBy('version_no')
        .execute(),
    );

  it("gives an environment still at the product's 0.8 the layout's 0.9, unauthored, at schema 7", async () => {
    const { tenant } = await beforeNote('Still 0.8');
    expect((await service.withTenant(tenant, (trx) => defaultLayout(trx))).layout).toEqual(
      EIGHTH_DEFAULT_LAYOUT,
    );
    expect((await migrate(db.migratorUrl)).tenants[tenant.id]).toEqual([
      '0056_table_note_word',
      '0057_document_parameters',
    ]);
    expect((await layoutChain(tenant)).at(-1)).toMatchObject({
      version_no: 9,
      author_id: null,
      schema_version: 7,
      content: productDefaultLayout,
    });
    const declared = await service.withTenant(tenant, (trx) => defaultLayout(trx));
    expect(declared).toMatchObject({ number: '0.9', layout: productDefaultLayout });
    expect(declared.layout.words.note).toBe('Note:');
  });

  it('leaves a layout an environment recorded after the product its own, giving it no version on top', async () => {
    const { tenant, ada } = await beforeNote('Own layout');
    const own = await service.withTenant(tenant, async (trx) => {
      const recorded = await recordVersion(trx, {
        artifactId: DEFAULT_LAYOUT_ID,
        openedFrom: (await defaultLayout(trx)).versionId,
        author: ada,
        substance: {
          kind: 'layout',
          content: {
            ...EIGHTH_DEFAULT_LAYOUT,
            words: { ...EIGHTH_DEFAULT_LAYOUT.words, contents: 'Table of contents' },
          } satisfies Layout,
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version.id;
    });
    await migrate(db.migratorUrl);
    expect((await layoutChain(tenant)).at(-1)!.id).toBe(own);
  });
});
