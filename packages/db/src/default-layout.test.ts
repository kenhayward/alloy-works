import {
  defaultLayout as productDefaultLayout,
  FIRST_DEFAULT_LAYOUT,
  SECOND_DEFAULT_LAYOUT,
  type Layout,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { DEFAULT_LAYOUT_ID, defaultLayout } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { versionDigests } from './version-digest.js';
import { recordVersion } from './versions.js';

describe('the layout every environment starts with', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let acme: Tenant;
  let other: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    acme = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  /** One version of the declared layout, as the chain holds it. */
  const versionOf = (tenant: Tenant, version: number) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .selectAll()
        .where('artifact_id', '=', DEFAULT_LAYOUT_ID)
        .where('revision_no', '=', 0)
        .where('version_no', '=', version)
        .executeTakeFirstOrThrow(),
    );
  const firstVersion = (tenant: Tenant) => versionOf(tenant, 1);

  it('is declared in every environment, at 0.3, authored by nobody and in no space', async () => {
    for (const tenant of [acme, other]) {
      const { declared, artifact } = await service.withTenant(tenant, async (trx) => ({
        declared: await defaultLayout(trx),
        artifact: await trx
          .selectFrom('artifact')
          .selectAll()
          .where('id', '=', DEFAULT_LAYOUT_ID)
          .executeTakeFirstOrThrow(),
      }));
      const first = await firstVersion(tenant);
      const second = await versionOf(tenant, 2);
      const third = await versionOf(tenant, 3);
      expect(declared).toEqual({
        artifactId: DEFAULT_LAYOUT_ID,
        versionId: third.id,
        number: '0.3',
        layout: productDefaultLayout,
      });
      expect(artifact).toMatchObject({ kind: 'layout', space_id: null });
      const unauthored = {
        kind: 'layout',
        author_id: null,
        note: null,
        component_type_version_id: null,
      };
      expect(first).toMatchObject({ ...unauthored, schema_version: 1 });
      expect(second).toMatchObject({ ...unauthored, schema_version: 2 });
      expect(third).toMatchObject({ ...unauthored, schema_version: 2 });
    }
  });

  it("holds each of the domain's default layouts exactly, with the digests the domain computes", async () => {
    // 0.1 as 0018 stored it, at layout schema 1, 0.2 as 0019 stored it, with a list of tables, and
    // 0.3 as 0021 stored it, with a list of figures before it.
    const cases = [
      [1, FIRST_DEFAULT_LAYOUT as unknown as Layout],
      [2, SECOND_DEFAULT_LAYOUT],
      [3, productDefaultLayout],
    ] as const;
    for (const [number, layout] of cases) {
      const version = await versionOf(acme, number);
      expect(version.content, `0.${number}`).toEqual(layout);
      const digests = versionDigests({ kind: 'layout', content: layout });
      expect(version.content_hash, `0.${number}`).toBe(digests.contentHash);
      expect(version.version_digest, `0.${number}`).toBe(digests.versionDigest);
    }
  });

  it('gives the runtime role no update, delete or truncate on the declaration', async () => {
    for (const statement of [
      sql`update layout_default set layout_id = ${DEFAULT_LAYOUT_ID}`,
      sql`delete from layout_default`,
      sql`truncate layout_default`,
    ]) {
      await expect(service.withTenant(acme, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('records a layout version only through its schema', async () => {
    const answer = await service.withTenant(acme, async (trx) => {
      const ada = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const opened = await defaultLayout(trx);
      const versions = () =>
        trx
          .selectFrom('artifact_version')
          .select('id')
          .where('artifact_id', '=', DEFAULT_LAYOUT_ID)
          .execute()
          .then((rows) => rows.length);

      // A member the layout does not declare is refused before anything is written: the count is read
      // in the same transaction, which a refused insert would have aborted.
      await expect(
        recordVersion(trx, {
          artifactId: DEFAULT_LAYOUT_ID,
          openedFrom: opened.versionId,
          author: ada.id,
          substance: {
            kind: 'layout',
            content: { ...productDefaultLayout, lists: [] } as unknown as Layout,
          },
        }),
      ).rejects.toThrow(/lists/);
      expect(await versions()).toBe(3);

      const next: Layout = {
        ...productDefaultLayout,
        words: { ...productDefaultLayout.words, contents: 'Table of contents' },
      };
      const recorded = await recordVersion(trx, {
        artifactId: DEFAULT_LAYOUT_ID,
        openedFrom: opened.versionId,
        author: ada.id,
        substance: { kind: 'layout', content: next },
      });
      return { recorded, declared: await defaultLayout(trx), next };
    });
    if (answer.recorded.answer !== 'recorded') throw new Error(answer.recorded.answer);
    expect(answer.recorded.version).toMatchObject({ kind: 'layout', revision: 0, version: 4 });
    expect(answer.declared).toEqual({
      artifactId: DEFAULT_LAYOUT_ID,
      versionId: answer.recorded.version.id,
      number: '0.4',
      layout: answer.next,
    });
  });
});
