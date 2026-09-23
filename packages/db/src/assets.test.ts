import { type ImageHeader } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAssetUpload,
  objectNamedByAsset,
  readAssetUpload,
  readAssetVersion,
  receiveAssetBytes,
  recordAsset,
  refuseAssetUpload,
} from './assets.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const ISSUER = 'https://idp.example';
const header: ImageHeader = {
  format: 'png',
  width: 800,
  height: 500,
  orientation: 1,
  colour: 'rgb',
  alpha: false,
  depth: 8,
  resolution: null,
};

describe('an asset upload, and the asset it makes (figures 1)', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;
  const key = (fill: string) => `${production.role}/sha256/${fill.repeat(64)}`;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      general = (await createSpace(trx, 'Figures')).id;
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const inTenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);

  const made = (alternative: { text: string; language: string } | null = null) =>
    inTenant((trx) => createAssetUpload(trx, { spaceId: general, uploader: ada, alternative }));

  it('makes an upload awaiting its bytes, then checking once they arrive, and queues its job', async () => {
    const upload = await made({ text: 'A red square', language: 'en-GB' });
    expect(upload).toMatchObject({ state: 'awaiting', spaceId: general, uploader: ada });
    const checking = await inTenant((trx) =>
      receiveAssetBytes(trx, upload.id, { key: key('a'), format: 'png', bytes: 3530 }),
    );
    expect(checking).toMatchObject({ state: 'checking', format: 'png', bytes: 3530 });
    const jobs = await queryAs(
      db.adminUrl,
      'select kind, subject_id from platform.job where subject_id = $1::uuid',
      [upload.id],
    );
    expect(jobs.rows).toEqual([{ kind: 'ingest', subject_id: upload.id }]);
  });

  it("AST-005 AST-041 records the asset in the upload's space, at 0.1, by its uploader, with what the check read", async () => {
    const upload = await made({ text: 'A red square', language: 'en-GB' });
    await inTenant((trx) =>
      receiveAssetBytes(trx, upload.id, { key: key('b'), format: 'png', bytes: 3530 }),
    );
    const version = await inTenant((trx) => recordAsset(trx, upload.id, header));
    expect(version).toMatchObject({ kind: 'asset', revision: 0, version: 1, author: ada });
    expect(version.content).toEqual({
      schemaVersion: 1,
      object: key('b'),
      format: 'png',
      bytes: 3530,
      width: 800,
      height: 500,
      orientation: 1,
      colour: 'rgb',
      alpha: false,
      depth: 8,
      resolution: null,
      alternative: { text: 'A red square', language: 'en-GB' },
    });
    const [artifact] = await inTenant((trx) =>
      trx.selectFrom('artifact').selectAll().where('id', '=', version.artifactId).execute(),
    );
    expect(artifact).toMatchObject({ kind: 'asset', space_id: general });
    expect(await inTenant((trx) => readAssetUpload(trx, upload.id))).toMatchObject({
      state: 'ready',
      assetId: version.artifactId,
      assetVersionId: version.id,
    });
    expect(await inTenant((trx) => readAssetVersion(trx, version.id))).toMatchObject({
      id: version.id,
      assetId: version.artifactId,
      spaceId: general,
      content: version.content,
    });
    expect(await inTenant((trx) => objectNamedByAsset(trx, key('b')))).toBe(true);
    expect(await inTenant((trx) => objectNamedByAsset(trx, key('c')))).toBe(false);
  });

  it('refuses an upload, at the door or after its check, saying why and never making an asset', async () => {
    const atTheDoor = await made();
    expect(
      await inTenant((trx) => refuseAssetUpload(trx, atTheDoor.id, 'not_permitted')),
    ).toMatchObject({ state: 'refused', reason: 'not_permitted', assetVersionId: null });
    const checked = await made();
    await inTenant((trx) =>
      receiveAssetBytes(trx, checked.id, { key: key('d'), format: 'jpeg', bytes: 10 }),
    );
    expect(
      await inTenant((trx) => refuseAssetUpload(trx, checked.id, 'undecodable')),
    ).toMatchObject({
      state: 'refused',
      reason: 'undecodable',
    });
  });

  it('moves an upload forwards only, and never changes what it was made with', async () => {
    const upload = await made();
    // Recorded before its bytes, or twice, or refused once ready: each is refused by the database.
    await expect(inTenant((trx) => recordAsset(trx, upload.id, header))).rejects.toThrow();
    await inTenant((trx) =>
      receiveAssetBytes(trx, upload.id, { key: key('e'), format: 'png', bytes: 1 }),
    );
    await expect(
      inTenant((trx) =>
        receiveAssetBytes(trx, upload.id, { key: key('f'), format: 'png', bytes: 1 }),
      ),
    ).rejects.toThrow();
    await inTenant((trx) => recordAsset(trx, upload.id, header));
    await expect(inTenant((trx) => refuseAssetUpload(trx, upload.id, 'malformed'))).rejects.toThrow(
      /moves forwards/,
    );
    await expect(
      inTenant((trx) =>
        trx
          .updateTable('asset_upload')
          .set({ state: 'checking' })
          .where('id', '=', upload.id)
          .execute(),
      ),
    ).rejects.toThrow(/moves forwards/);
    // And the runtime role cannot delete one: a refusal is the record that it happened.
    await expect(
      inTenant((trx) => sql`delete from asset_upload where id = ${upload.id}::uuid`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses to record an asset whose recorded properties would not parse as an asset version', async () => {
    const upload = await made();
    await inTenant((trx) =>
      receiveAssetBytes(trx, upload.id, { key: key('9'), format: 'png', bytes: 1 }),
    );
    await expect(
      inTenant((trx) => recordAsset(trx, upload.id, { ...header, width: 0 })),
    ).rejects.toThrow();
  });

  it('reads no upload and no asset version this tenant does not hold, or by an id that is not one', async () => {
    const nobody = '00000000-0000-4000-8000-000000000000';
    expect(await inTenant((trx) => readAssetUpload(trx, nobody))).toBeUndefined();
    expect(await inTenant((trx) => readAssetUpload(trx, 'not-an-id'))).toBeUndefined();
    expect(await inTenant((trx) => readAssetVersion(trx, nobody))).toBeUndefined();
    expect(await inTenant((trx) => readAssetVersion(trx, 'not-an-id'))).toBeUndefined();
  });
});
