import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapCluster } from './bootstrap.js';
import {
  embeddedHashes,
  readEmbeddings,
  storeEmbeddings,
  textHash,
  vectorLiteral,
} from './embeddings.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const vector = (dims: number, at: number) =>
  Array.from({ length: dims }, (_, index) => (index === at ? 1 : 0));

describe('the embedding store (the G7 plan, G7-B)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('runs on a pgvector with half-precision vectors and iterative index scans', async () => {
    const version = await service.withTenant(tenant, async (trx) => {
      const { rows } = await sql<{ extversion: string }>`
        select extversion from pg_extension where extname = 'vector'`.execute(trx);
      return rows[0]!.extversion;
    });
    const [major, minor] = version.split('.').map(Number);
    expect(major! > 0 || minor! >= 8, version).toBe(true);
  });

  it('VER-039 keeps a vector with the model and the model version that made it, once, and never changes it', async () => {
    const hash = textHash('The north weir floods each spring.');
    await service.withTenant(tenant, async (trx) => {
      await storeEmbeddings(trx, [
        {
          textHash: hash,
          model: 'embed',
          modelVersion: 'embed-2026-10',
          dims: 384,
          vector: vector(384, 3),
        },
      ]);
      // Again, as another run might: the one held is left as it was.
      await storeEmbeddings(trx, [
        {
          textHash: hash,
          model: 'embed',
          modelVersion: 'embed-2026-10',
          dims: 384,
          vector: vector(384, 7),
        },
      ]);
    });
    const stored = await service.withTenant(tenant, (trx) => readEmbeddings(trx, 'embed', [hash]));
    expect(stored).toEqual([
      {
        textHash: hash,
        model: 'embed',
        modelVersion: 'embed-2026-10',
        dims: 384,
        vector: vector(384, 3),
      },
    ]);
    expect(
      await service.withTenant(tenant, (trx) => embeddedHashes(trx, 'another', [hash])),
    ).toEqual(new Set());
    await expect(
      service.withTenant(tenant, (trx) =>
        sql`update embedding set vector = ${vectorLiteral(vector(384, 9))}::extensions.halfvec`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    // A vector of other dimensions than it says is refused.
    await expect(
      service.withTenant(tenant, (trx) =>
        storeEmbeddings(trx, [
          {
            textHash: textHash('x'),
            model: 'embed',
            modelVersion: 'v',
            dims: 768,
            vector: vector(384, 1),
          },
        ]),
      ),
    ).rejects.toThrow();
  });
});
