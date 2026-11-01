import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import type { TenantTransaction } from './tenant-database.js';
import { createArtifact } from './versions.js';

/**
 * Migration 0180: every image made before it gains its first rights, `dataset` for a dataset's and
 * `undeclared` for any other, recorded by its first version's author when that version was made (the
 * ALb review, 3), so no image reaches a publish with none.
 */
describe('migration 0180, which gives every image made before it its first rights', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0179 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0180-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 180;
      },
    });
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  /** An image as 0179 made one, by Ada in General. */
  const image = async (trx: TenantTransaction, ada: string, general: string, fill: string) =>
    createArtifact(trx, {
      spaceId: general,
      author: ada,
      substance: {
        kind: 'asset',
        content: {
          schemaVersion: 1,
          object: `${(await sql<{ r: string }>`select current_user as r`.execute(trx)).rows[0]!.r}/sha256/${fill.repeat(64)}`,
          format: 'png',
          bytes: 3530,
          width: 800,
          height: 600,
          orientation: 1,
          colour: 'rgb',
          alpha: false,
          depth: 8,
          resolution: null,
          alternative: null,
        },
      } as never,
    });

  it("records an image made before it as undeclared and a dataset's as its dataset's, by its author", async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant: Tenant = { ...provisioned, id };

    const made = await service.withTenant(tenant, async (trx) => {
      const ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.test', subject: 'ada', email: null, display_name: 'Ada' })
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
      const uploaded = await image(trx, ada, general, 'a');
      const fromDataset = await image(trx, ada, general, 'b');
      return { ada, general, uploaded, fromDataset };
    });
    // The dataset's upload that made it, ready and naming it, as the job leaves one.
    await queryAs(
      db.adminUrl,
      `insert into ${tenant.schema}.asset_upload (space_id, uploader, origin, state, object_key, format,
         bytes, asset_id, asset_version_id, finished_at)
       values ($1, $2, 'dataset', 'ready', $3, 'png', 3530, $4, $5, now())`,
      [
        made.general,
        made.ada,
        `x/sha256/${'b'.repeat(64)}`,
        made.fromDataset.artifactId,
        made.fromDataset.id,
      ],
    );

    await migrate(db.migratorUrl);

    const rows = await service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('asset_rights')
        .select(['asset_id', 'rights', 'recorded_by', 'recorded_at'])
        .execute(),
    );
    expect(
      rows
        .map((row) => ({ asset: row.asset_id, rights: row.rights, by: row.recorded_by }))
        .sort((a, b) => a.asset.localeCompare(b.asset)),
    ).toEqual(
      [
        { asset: made.uploaded.artifactId, rights: { kind: 'undeclared' }, by: made.ada },
        { asset: made.fromDataset.artifactId, rights: { kind: 'dataset' }, by: made.ada },
      ].sort((a, b) => a.asset.localeCompare(b.asset)),
    );
    // When the image was made, not when the migration ran.
    const recorded = rows.find((row) => row.asset_id === made.uploaded.artifactId)!;
    expect(new Date(recorded.recorded_at).getTime()).toBe(made.uploaded.createdAt.getTime());
  });
});
