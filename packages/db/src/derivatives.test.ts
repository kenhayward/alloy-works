import { type ImageHeader } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAssetUpload, objectInUse, receiveAssetBytes, recordAsset } from './assets.js';
import { bootstrapCluster } from './bootstrap.js';
import {
  derivativesMade,
  discardDerivatives,
  readDerivative,
  recordDerivative,
  wantDerivatives,
} from './derivatives.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const header: ImageHeader = {
  format: 'png',
  width: 800,
  height: 600,
  orientation: 1,
  colour: 'rgb',
  alpha: false,
  depth: 8,
  resolution: null,
  end: 3530,
};

describe("an image's derivatives (the AL plan, AL-H)", () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let figures: string;
  const key = (fill: string) => `${production.role}/sha256/${fill.repeat(64)}`;
  const inTenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);
  /** The `derive` jobs queued, by subject, as the worker would claim them. */
  const deriveJobs = async () =>
    (
      await queryAs(
        db.adminUrl,
        `select subject_id from platform.job where kind = 'derive' and tenant_id = $1 order by created_at`,
        [production.id],
      )
    ).rows.map((row: { subject_id: string }) => row.subject_id);

  /** An image recorded as the ingest job records one, its bytes under this fill's key. */
  const ingested = async (fill: string) => {
    const upload = await inTenant((trx) =>
      createAssetUpload(trx, { spaceId: figures, uploader: ada, alternative: null }),
    );
    await inTenant((trx) =>
      receiveAssetBytes(trx, upload.id, { key: key(fill), format: 'png', bytes: 3530 }),
    );
    return inTenant((trx) => recordAsset(trx, upload.id, header));
  };

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
    await inTenant(async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.test', subject: 'ada', email: null, display_name: 'Ada' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      figures = (await createSpace(trx, 'Figures')).id;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('AST-008 asks for an image’s derivatives as it is recorded, not when it is first shown', async () => {
    const version = await ingested('5');
    expect(await deriveJobs()).toContain(version.id);
  });

  it('AST-010 keeps each derivative by its version beside the original, which it never replaces, and counts its bytes in use', async () => {
    const version = await ingested('6');
    const made = {
      versionId: version.id,
      assetId: version.artifactId,
      kind: 'thumbnail' as const,
      objectKey: key('8'),
      width: 256,
      height: 192,
      bytes: 1200,
      stripped: ['exif'],
    };
    await inTenant((trx) => recordDerivative(trx, made));
    expect(await inTenant((trx) => readDerivative(trx, version.id, 'thumbnail'))).toEqual({
      objectKey: key('8'),
      width: 256,
      height: 192,
      bytes: 1200,
    });
    expect(await inTenant((trx) => readDerivative(trx, version.id, 'preview'))).toBeUndefined();
    // Its bytes are in use while it is kept: a refused upload of the same bytes never removes them.
    expect(await inTenant((trx) => objectInUse(trx, key('8'), version.id))).toBe(true);
    // Never written over its original's key.
    await expect(
      inTenant((trx) => recordDerivative(trx, { ...made, kind: 'preview', objectKey: key('6') })),
    ).rejects.toThrow(/its original/);
  });

  it('AST-048 discards a space’s derivatives, answering their keys, and asks for them again once on the next read', async () => {
    const version = await ingested('0');
    await inTenant((trx) =>
      recordDerivative(trx, {
        versionId: version.id,
        assetId: version.artifactId,
        kind: 'preview',
        objectKey: key('9'),
        width: 800,
        height: 600,
        bytes: 9000,
        stripped: [],
      }),
    );
    await inTenant((trx) => derivativesMade(trx, version.id));
    expect(await inTenant((trx) => discardDerivatives(trx, figures))).toContain(key('9'));
    expect(await inTenant((trx) => readDerivative(trx, version.id, 'preview'))).toBeUndefined();
    const before = (await deriveJobs()).length;
    // Read twice before the job runs: asked for once.
    expect(await inTenant((trx) => wantDerivatives(trx, version.id))).toBe(true);
    expect(await inTenant((trx) => wantDerivatives(trx, version.id))).toBe(false);
    expect((await deriveJobs()).length).toBe(before + 1);
    // Made, it may be asked for again.
    await inTenant((trx) => derivativesMade(trx, version.id));
    expect(await inTenant((trx) => wantDerivatives(trx, version.id))).toBe(true);
  });
});
