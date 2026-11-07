import { createHash } from 'node:crypto';
import { INTEGRITY_PERIOD_DAYS, type ImageHeader } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAssetUpload, receiveAssetBytes, recordAsset } from './assets.js';
import { bootstrapCluster } from './bootstrap.js';
import { integrityDue, integrityOf, verifyIntegrity, type IntegrityItem } from './integrity.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
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
  width: 6,
  height: 4,
  orientation: 1,
  colour: 'rgb',
  alpha: false,
  depth: 8,
  resolution: null,
  end: 3530,
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('integrity re-verified, a share a night (the DG plan, DG-K)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let worker: TenantDatabase;
  let ada: string;
  let general: string;
  /** The tenant's store, as the sweep reads it: absent where an object is missing. */
  const objects = new Map<string, Buffer>();
  const read = (key: string) => Promise.resolve(objects.get(key) ?? null);
  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    worker.withTenant(tenant, work, { actorKind: 'system' });
  const night = (n: number) => new Date(Date.UTC(2026, 10, n, 2));
  const keyOf = (bytes: Buffer) => `${tenant.role}/sha256/${sha(bytes)}`;

  /** A night's share, each item checked and recorded in its own transaction, as the sweep does. */
  const checkNight = async (at: Date) => {
    const due = await as((trx) => integrityDue(trx, at));
    if (due === null) return null;
    for (const item of due) await as((trx) => verifyIntegrity(trx, item, read, at));
    return due;
  };

  /** An image Ada uploaded, as the ingest job records one, its bytes in the store. */
  const image = async (bytes: Buffer) => {
    objects.set(keyOf(bytes), bytes);
    return as(async (trx) => {
      const upload = await createAssetUpload(trx, {
        spaceId: general,
        uploader: ada,
        alternative: null,
      });
      await receiveAssetBytes(
        trx,
        upload.id,
        { key: keyOf(bytes), format: 'png', bytes: 3530 },
        false,
      );
      const version = await recordAsset(trx, upload.id, header);
      return { upload: upload.id, version };
    });
  };

  /** An export written and done, as its job leaves one, its bytes in the store. */
  const exported = async (table: 'audit_export' | 'tenant_export', bytes: Buffer) => {
    objects.set(keyOf(bytes), bytes);
    const { rows } = await queryAs(
      db.adminUrl,
      `insert into "${tenant.schema}".${table} (snapshot, state, object_key, sha256, bytes, finished_at)
       values (pg_current_snapshot(), 'done', $1, $2, $3, now()) returning id`,
      [keyOf(bytes), sha(bytes), bytes.byteLength],
    );
    return rows[0]!.id as string;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Acme Production' },
      hostnames: ['acme.alloy.test'],
    });
    worker = testTenantDatabase(db.workerUrl);
    const service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(tenant, async (trx) => {
      ada = (
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
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
    });
    await service.close();
  });

  afterAll(async () => {
    await worker.close();
    await db.drop();
  });

  it('ADM-044 finds a tampered asset, version and export within the period, records each and audits it', async () => {
    const intact = await image(Buffer.from('an intact image'));
    const swapped = await image(Buffer.from('an image whose bytes are changed'));
    const gone = await image(Buffer.from('an image whose object is lost'));
    const tampered = await image(Buffer.from('an image whose version is changed'));
    const auditExport = await exported('audit_export', Buffer.from('an audit export'));
    const tenantExport = await exported('tenant_export', Buffer.from('a tenant export'));

    // The store's bytes changed under one key and lost under another; a version's row changed.
    objects.set(keyOf(Buffer.from('an image whose bytes are changed')), Buffer.from('other bytes'));
    objects.delete(keyOf(Buffer.from('an image whose object is lost')));
    objects.set(keyOf(Buffer.from('an audit export')), Buffer.from('an audit export, edited'));
    await queryAs(
      db.adminUrl,
      `update "${tenant.schema}".artifact_version set content = content || '{"width": 600}' where id = $1`,
      [tampered.version.id],
    );

    // Every item of every class is checked once in the period, the never-checked first.
    const checked: IntegrityItem[] = [];
    for (let n = 1; n <= INTEGRITY_PERIOD_DAYS; n += 1)
      checked.push(...((await checkNight(night(n))) ?? []));
    const each = (item: IntegrityItem) => `${item.class}:${item.item}`;
    for (const item of [
      `asset:${intact.upload}`,
      `asset:${swapped.upload}`,
      `asset:${gone.upload}`,
      `version:${tampered.version.id}`,
      `version:${intact.version.id}`,
      `audit_export:${auditExport}`,
      `tenant_export:${tenantExport}`,
    ])
      expect(checked.map(each)).toContain(item);

    const { rows: failed } = await queryAs(
      db.adminUrl,
      `select class, item, failure from "${tenant.schema}".integrity_check where not ok order by class, failure`,
    );
    expect(failed).toEqual(
      [
        { class: 'asset', item: gone.upload, failure: 'object_missing' },
        { class: 'asset', item: swapped.upload, failure: 'hash_mismatch' },
        { class: 'audit_export', item: auditExport, failure: 'hash_mismatch' },
        { class: 'version', item: tampered.version.id, failure: 'digest_mismatch' },
      ].sort((a, b) => a.class.localeCompare(b.class) || a.failure.localeCompare(b.failure)),
    );

    // Each failure audited once, by the system, never only logged; checked again, it is not audited again.
    const { rows: events } = await queryAs(
      db.adminUrl,
      `select actor_kind, subject_kind, subject, detail from "${tenant.schema}".audit_event
       where kind = 'integrity.failed' order by sequence`,
    );
    expect(events).toHaveLength(4);
    expect(events).toContainEqual({
      actor_kind: 'system',
      subject_kind: 'version',
      subject: tampered.version.id,
      detail: { class: 'version', item: tampered.version.id, failure: 'digest_mismatch' },
    });

    // Diagnostics' read: each class, its items, those checked in the period and those failing.
    const summary = await as((trx) => integrityOf(trx, night(INTEGRITY_PERIOD_DAYS)));
    expect(summary.periodDays).toBe(INTEGRITY_PERIOD_DAYS);
    expect(summary.classes.map((each) => each.class)).toEqual([
      'asset',
      'version',
      'audit_export',
      'tenant_export',
    ]);
    const asset = summary.classes.find((each) => each.class === 'asset')!;
    expect(asset).toMatchObject({ items: 4, checkedInPeriod: 4, failing: 2 });
    expect(asset.lastFailure).toMatchObject({ failure: expect.any(String) as string });
    const version = summary.classes.find((each) => each.class === 'version')!;
    expect(version.failing).toBe(1);
    expect(version.checkedInPeriod).toBe(version.items);
    expect(version.lastFailure).toEqual({
      item: tampered.version.id,
      failure: 'digest_mismatch',
      at: expect.any(Date) as Date,
    });
    expect(summary.classes.find((each) => each.class === 'tenant_export')).toEqual({
      class: 'tenant_export',
      items: 1,
      checkedInPeriod: 1,
      failing: 0,
      lastFailure: null,
    });
  });

  it('checks once a UTC day, and the next night takes those least recently checked', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select class, item from "${tenant.schema}".integrity_check order by checked_at, item limit 1`,
    );
    const at = night(INTEGRITY_PERIOD_DAYS + 1);
    const first = await checkNight(at);
    expect(first).not.toBeNull();
    expect(await checkNight(new Date(at.getTime() + 3_600_000))).toBeNull();
    // The next night takes the item checked longest ago.
    expect(first!.map((item) => `${item.class}:${item.item}`)).toContain(
      `${rows[0]!.class as string}:${rows[0]!.item as string}`,
    );
  });
});
