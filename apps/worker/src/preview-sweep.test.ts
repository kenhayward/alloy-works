import {
  createDocument,
  createTenant,
  createTenantDatabase,
  migrate,
  prepareDatabase,
  recordPreview,
  requestPublication,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, queryAs, type TestDatabase } from '@alloy-works/db/testing';
import { createObjectStores, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepExpiredPreviews } from './sweep.js';
import type { WorkerLog } from './worker.js';

describe('sweeping previews an hour after they finished (PV-F)', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let stores: ObjectStores;
  let tenants: Tenant[];

  beforeAll(async () => {
    db = await freshDatabase();
    objects = await testObjectStore();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenants = [];
    for (const [name, host] of [
      ['Production', 'acme.alloy.test'],
      ['Development', 'dev.acme.alloy.test'],
    ] as const) {
      const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id: db.newTenantId(), name },
        hostnames: [host],
      });
      await objects.setUp(db.adminUrl, tenant);
      tenants.push(tenant);
    }
    service = createTenantDatabase(db.serviceUrl);
    worker = createTenantDatabase(db.workerUrl);
    stores = createObjectStores(objects.settings, objects.sealingKey);
  });

  afterAll(async () => {
    await service?.close();
    await worker?.close();
    await objects?.drop();
    await db?.drop();
  });

  const storeOf = (tenant: Tenant) =>
    worker.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));

  /** Whether the tenant's store still holds the object under this key. */
  const holds = async (tenant: Tenant, key: string) => {
    try {
      await (await storeOf(tenant)).get(key);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * In this tenant: a preview done two hours ago whose PDF nothing else names, and another done two
   * hours ago whose PDF a preview done just now names too, each PDF kept in the tenant's store as a
   * worker keeps one.
   */
  const previewsIn = async (tenant: Tenant) => {
    const store = await storeOf(tenant);
    const alone = await store.put(Buffer.from(`%PDF-1.7 alone in ${tenant.id}`), 'application/pdf');
    const shared = await store.put(
      Buffer.from(`%PDF-1.7 shared in ${tenant.id}`),
      'application/pdf',
    );
    const ids = await service.withTenant(tenant, async (trx) => {
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
      const ask = async () => {
        const made = await createDocument(trx, {
          spaceId: general.id,
          title: 'The dosing report',
          language: 'en-GB',
          direction: 'ltr',
          author: ada.id,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        const answer = await requestPublication(trx, {
          documentId: made.version.artifactId,
          version: made.version.id,
          formats: ['pdf'],
          requester: ada.id,
          kind: 'preview',
        });
        if (answer.answer !== 'requested') throw new Error(answer.answer);
        return answer.request.id;
      };
      const ids = { alone: await ask(), older: await ask(), newer: await ask() };
      await recordPreview(trx, {
        requestId: ids.newer,
        key: shared.key,
        sha256: shared.sha256,
        bytes: shared.size,
      });
      return ids;
    });
    for (const [id, stored] of [
      [ids.alone, alone],
      [ids.older, shared],
    ] as const) {
      await queryAs(
        db.adminUrl,
        `update "${tenant.schema}".publication_request set state = 'done',
            finished_at = now() - interval '2 hours', expires_at = now() - interval '1 hour',
            preview_key = $2, preview_sha256 = $3, preview_bytes = $4
          where id = $1`,
        [id, stored.key, stored.sha256, stored.size],
      );
    }
    return { ...ids, alone: { id: ids.alone, key: alone.key }, shared: shared.key };
  };

  it("removes an expired preview's PDF from its tenant's store, keeps one another row names, and sweeps every tenant though one store fails", async () => {
    const made = new Map<string, Awaited<ReturnType<typeof previewsIn>>>();
    for (const tenant of tenants) made.set(tenant.id, await previewsIn(tenant));

    // Whichever tenant the sweep reaches first, its store refuses every removal.
    let first: string | undefined;
    const failing: ObjectStores = {
      forTenant: async (trx, tenant) => {
        const store = await stores.forTenant(trx, tenant);
        first ??= tenant.id;
        if (tenant.id !== first) return store;
        return {
          ...store,
          remove: () => Promise.reject(new Error('The store is away')),
        } satisfies TenantStore;
      },
    };
    const errors: object[] = [];
    const log: WorkerLog = {
      info: () => {},
      warn: () => {},
      error: (details) => errors.push(details),
    };

    expect(await sweepExpiredPreviews(worker, failing, log)).toBe(1);

    const [failed, swept] = [
      tenants.find((tenant) => tenant.id === first)!,
      tenants.find((tenant) => tenant.id !== first)!,
    ];
    // Swept: the PDF nothing named is gone, and the one a newer preview names is kept.
    expect(await holds(swept, made.get(swept.id)!.alone.key)).toBe(false);
    expect(await holds(swept, made.get(swept.id)!.shared)).toBe(true);
    // The tenant whose store failed had its requests swept, and its PDF left, said so by its key.
    expect(await holds(failed, made.get(failed.id)!.alone.key)).toBe(true);
    expect(errors).toEqual([
      expect.objectContaining({ tenant: failed.id, key: made.get(failed.id)!.alone.key }),
    ]);
    for (const tenant of tenants) {
      const { rows } = await queryAs(
        db.adminUrl,
        `select id from "${tenant.schema}".publication_request order by requested_at, id`,
      );
      const left = new Set(rows.map((row: { id: string }) => row.id));
      const ids = made.get(tenant.id)!;
      expect(left.has(ids.alone.id), tenant.id).toBe(false);
      expect(left.has(ids.older), tenant.id).toBe(false);
      expect(left.has(ids.newer), tenant.id).toBe(true);
    }
  });
});
