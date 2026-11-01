import { type ImageHeader } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAssetUpload,
  imagesPolicy,
  objectInUse,
  readAssetRights,
  recordAssetRights,
  setImagesPolicy,
  uploadForDatasetImage,
  readAssetUpload,
  readAssetVersion,
  receiveAssetBytes,
  recordAsset,
  refuseAssetUpload,
} from './assets.js';
import { bootstrapCluster } from './bootstrap.js';
import { createDefinition } from './definitions.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { archiveSpace, createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

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
  end: 3530,
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
    service = testTenantDatabase(db.serviceUrl);
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

  /** A licence permitting internal use and publication, by its key. */
  const aLicence = async (key: string) => {
    const answer = await inTenant((trx) =>
      createDefinition(trx, {
        kind: 'licence',
        definition: {
          schemaVersion: 1,
          name: key,
          key,
          base: 'en',
          names: [{ language: 'en', text: key }],
          permits: ['internal', 'publication'],
          attribution: { required: false },
        },
        author: ada,
      }),
    );
    if (answer.answer !== 'created') throw new Error(`No licence: ${answer.answer}`);
    return answer.definition.id;
  };

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
    expect(await inTenant((trx) => objectInUse(trx, key('b'), upload.id))).toBe(true);
    expect(await inTenant((trx) => objectInUse(trx, key('c'), upload.id))).toBe(false);
  });

  it('AST-044 records what the uploader declared, or that nothing was, and the name of the file (AL-C, AL-E)', async () => {
    const licence = await aLicence('stock_upload');
    const declared = {
      kind: 'declared' as const,
      source: { text: 'A stock library' },
      licence,
      expires: '2027-03-31',
      credit: 'Photograph by Ada',
    };
    const upload = await inTenant((trx) =>
      createAssetUpload(trx, {
        spaceId: general,
        uploader: ada,
        alternative: null,
        name: 'harbour.png',
        rights: declared,
      }),
    );
    await inTenant((trx) =>
      receiveAssetBytes(trx, upload.id, { key: key('1'), format: 'png', bytes: 3530 }),
    );
    const version = await inTenant((trx) => recordAsset(trx, upload.id, header));
    expect(version.content).toMatchObject({ name: 'harbour.png' });
    expect(await inTenant((trx) => readAssetRights(trx, version.artifactId))).toEqual([
      { id: expect.any(String), rights: declared, recordedBy: ada, recordedAt: expect.any(Date) },
    ]);

    const silent = await made();
    await inTenant((trx) =>
      receiveAssetBytes(trx, silent.id, { key: key('2'), format: 'png', bytes: 3530 }),
    );
    const undeclared = await inTenant((trx) => recordAsset(trx, silent.id, header));
    expect(undeclared.content).not.toHaveProperty('name');
    expect(
      (await inTenant((trx) => readAssetRights(trx, undeclared.artifactId))).map(
        (each) => each.rights,
      ),
    ).toEqual([{ kind: 'undeclared' }]);

    // A dataset's image is the environment's own data.
    const { upload: fromData } = await inTenant((trx) =>
      uploadForDatasetImage(trx, {
        spaceId: general,
        uploader: ada,
        key: key('3'),
        format: 'png',
        bytes: 3530,
      }),
    );
    const bound = await inTenant((trx) => recordAsset(trx, fromData.id, header));
    expect(
      (await inTenant((trx) => readAssetRights(trx, bound.artifactId))).map((each) => each.rights),
    ).toEqual([{ kind: 'dataset' }]);
  });

  it("AST-031 keeps each change to an image's rights as a row of its own, by whom and when, newest first", async () => {
    const licence = await aLicence('stock_history');
    const upload = await made();
    await inTenant((trx) =>
      receiveAssetBytes(trx, upload.id, { key: key('4'), format: 'png', bytes: 3530 }),
    );
    const version = await inTenant((trx) => recordAsset(trx, upload.id, header));
    const declared = {
      kind: 'declared' as const,
      source: { text: 'Ada, the photographer' },
      licence,
    };
    expect(
      await inTenant((trx) =>
        recordAssetRights(trx, { assetId: version.artifactId, rights: declared, by: ada }),
      ),
    ).toEqual({ answer: 'recorded', id: expect.any(String) });
    // The same again is no change: no row and no event (the ALb review, 7).
    expect(
      await inTenant((trx) =>
        recordAssetRights(trx, { assetId: version.artifactId, rights: declared, by: ada }),
      ),
    ).toEqual({ answer: 'unchanged' });
    const history = await inTenant((trx) => readAssetRights(trx, version.artifactId));
    expect(history.map((each) => each.rights)).toEqual([declared, { kind: 'undeclared' }]);
    // A licence that is not one, and a dataset's kind, are refused; nothing is recorded.
    expect(
      await inTenant((trx) =>
        recordAssetRights(trx, {
          assetId: version.artifactId,
          rights: { ...declared, licence: general },
          by: ada,
        }),
      ),
    ).toEqual({ answer: 'licence.missing' });
    expect(
      await inTenant((trx) =>
        recordAssetRights(trx, {
          assetId: version.artifactId,
          rights: { kind: 'dataset' },
          by: ada,
        }),
      ),
    ).toEqual({ answer: 'rights.invalid' });
    expect(await inTenant((trx) => readAssetRights(trx, version.artifactId))).toHaveLength(2);
    // And the runtime role changes none of them.
    await expect(
      inTenant((trx) => sql`update asset_rights set recorded_at = now()`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(inTenant((trx) => sql`delete from asset_rights`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("AST-053 keeps the environment's policy for undeclared images, warn until an administrator says refuse", async () => {
    const own = { png: null, jpeg: null };
    expect(await inTenant(imagesPolicy)).toEqual({ undeclared: 'warn', limits: own });
    expect(
      await inTenant((trx) => setImagesPolicy(trx, { undeclared: 'refuse', limits: own })),
    ).toEqual({ undeclared: 'refuse', limits: own });
    expect(await inTenant(imagesPolicy)).toEqual({ undeclared: 'refuse', limits: own });
    await inTenant((trx) => setImagesPolicy(trx, { undeclared: 'warn', limits: own }));
  });

  it('AST-004 keeps the limits an environment lowered each format to, and holds them to the format', async () => {
    const lowered = { png: 2_000_000, jpeg: null };
    expect(
      await inTenant((trx) => setImagesPolicy(trx, { undeclared: 'warn', limits: lowered })),
    ).toEqual({ undeclared: 'warn', limits: lowered });
    // Never above what the format declares, whatever writes it.
    await expect(
      inTenant((trx) =>
        trx
          .updateTable('images_policy')
          .set({ limits: JSON.stringify({ png: 25_000_001, jpeg: null }) })
          .execute(),
      ),
    ).rejects.toThrow(/images_policy_limits/);
    await inTenant((trx) =>
      setImagesPolicy(trx, { undeclared: 'warn', limits: { png: null, jpeg: null } }),
    );
  });

  it('records an image uploaded to an archived space, the one thing made there: adding an image is part of editing what is already in it (SP-C)', async () => {
    const archived = await inTenant(async (trx) => {
      const space = await createSpace(trx, 'Archived figures');
      await archiveSpace(trx, space.id, ada);
      return space.id;
    });
    const upload = await inTenant((trx) =>
      createAssetUpload(trx, { spaceId: archived, uploader: ada, alternative: null }),
    );
    await inTenant((trx) =>
      receiveAssetBytes(trx, upload.id, { key: key('e'), format: 'png', bytes: 3530 }),
    );
    await expect(inTenant((trx) => recordAsset(trx, upload.id, header))).resolves.toMatchObject({
      kind: 'asset',
      revision: 0,
      version: 1,
    });
  });

  it('counts an object in use by another upload of the same bytes that is still checking, but not by the one asking', async () => {
    // Two uploads of one photograph share its key. Refusing the first must not remove what the
    // second is still being checked against (final review, finding 5).
    const first = await made();
    const second = await made();
    for (const each of [first, second]) {
      await inTenant((trx) =>
        receiveAssetBytes(trx, each.id, { key: key('7'), format: 'png', bytes: 1 }),
      );
    }
    expect(await inTenant((trx) => objectInUse(trx, key('7'), first.id))).toBe(true);
    await inTenant((trx) => refuseAssetUpload(trx, second.id, 'undecodable', 'checking'));
    expect(await inTenant((trx) => objectInUse(trx, key('7'), first.id))).toBe(false);
  });

  it('refuses an upload, at the door or after its check, saying why and never making an asset', async () => {
    const atTheDoor = await made();
    expect(
      await inTenant((trx) => refuseAssetUpload(trx, atTheDoor.id, 'not_permitted', 'awaiting')),
    ).toMatchObject({ state: 'refused', reason: 'not_permitted', assetVersionId: null });
    const checked = await made();
    await inTenant((trx) =>
      receiveAssetBytes(trx, checked.id, { key: key('d'), format: 'jpeg', bytes: 10 }),
    );
    expect(
      await inTenant((trx) => refuseAssetUpload(trx, checked.id, 'undecodable', 'checking')),
    ).toMatchObject({
      state: 'refused',
      reason: 'undecodable',
    });
  });

  it('moves an upload forwards only, and never changes what it was made with', async () => {
    const upload = await made();
    // Recorded before its bytes is refused. Filled twice, or refused from a state it has left, is
    // answered as not done - undefined - so two requests racing each other are told, not failed.
    await expect(inTenant((trx) => recordAsset(trx, upload.id, header))).rejects.toThrow();
    await inTenant((trx) =>
      receiveAssetBytes(trx, upload.id, { key: key('e'), format: 'png', bytes: 1 }),
    );
    expect(
      await inTenant((trx) =>
        receiveAssetBytes(trx, upload.id, { key: key('f'), format: 'png', bytes: 1 }),
      ),
    ).toBeUndefined();
    expect(
      await inTenant((trx) => refuseAssetUpload(trx, upload.id, 'malformed', 'awaiting')),
    ).toBeUndefined();
    await inTenant((trx) => recordAsset(trx, upload.id, header));
    expect(
      await inTenant((trx) => refuseAssetUpload(trx, upload.id, 'malformed', 'checking')),
    ).toBeUndefined();
    // And beneath the functions, the database holds the same line.
    await expect(
      inTenant((trx) =>
        trx
          .updateTable('asset_upload')
          .set({ state: 'refused', reason: 'malformed', finished_at: new Date() })
          .where('id', '=', upload.id)
          .execute(),
      ),
    ).rejects.toThrow(/moves forwards/);
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

  it('AST-016 AST-049 replaces an image by cutting a version of its asset, never overwriting one, and asks for its own derivatives (AL-M)', async () => {
    const first = await made({ text: 'A red square', language: 'en-GB' });
    await inTenant((trx) =>
      receiveAssetBytes(trx, first.id, { key: key('1'), format: 'png', bytes: 3530 }),
    );
    const original = await inTenant((trx) => recordAsset(trx, first.id, header));
    const replacing = await inTenant((trx) =>
      createAssetUpload(trx, {
        spaceId: general,
        uploader: ada,
        alternative: { text: 'A blue square', language: 'en-GB' },
        replaces: original.artifactId,
      }),
    );
    expect(replacing).toMatchObject({ state: 'awaiting', replaces: original.artifactId });
    await inTenant((trx) =>
      receiveAssetBytes(trx, replacing.id, { key: key('2'), format: 'png', bytes: 4000 }),
    );
    const replaced = await inTenant((trx) =>
      recordAsset(trx, replacing.id, { ...header, width: 640 }),
    );
    expect(replaced).toMatchObject({
      artifactId: original.artifactId,
      revision: 0,
      version: 2,
      author: ada,
    });
    expect(replaced.content).toMatchObject({ object: key('2'), width: 640 });
    // The version replaced is kept as it was, and the asset has one row of rights, not two.
    expect((await inTenant((trx) => readAssetVersion(trx, original.id)))?.content).toEqual(
      original.content,
    );
    expect(
      await inTenant((trx) =>
        trx
          .selectFrom('asset_rights')
          .select('id')
          .where('asset_id', '=', original.artifactId)
          .execute(),
      ),
    ).toHaveLength(1);
    expect(await inTenant((trx) => readAssetUpload(trx, replacing.id))).toMatchObject({
      state: 'ready',
      assetId: original.artifactId,
      assetVersionId: replaced.id,
    });
    const wanted = await inTenant((trx) =>
      trx
        .selectFrom('asset_derivative_wanted')
        .select('version_id')
        .where('version_id', 'in', [original.id, replaced.id])
        .execute(),
    );
    expect(wanted.map((row) => row.version_id).sort()).toEqual([original.id, replaced.id].sort());
    // Beneath the function, a ready replacement names the asset it replaced and no other.
    await expect(
      inTenant((trx) =>
        createAssetUpload(trx, {
          spaceId: general,
          uploader: ada,
          alternative: null,
          replaces: '00000000-0000-4000-8000-000000000000',
        }),
      ),
    ).rejects.toThrow();
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
