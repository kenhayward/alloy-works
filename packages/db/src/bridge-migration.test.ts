import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordEvent } from './audit.js';
import { bootstrapCluster } from './bootstrap.js';
import { recordNonce, startDelivery } from './bridge-store.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const TOKEN = '3f6d7c2b-9a52-4c1e-8b1f-5e1d0c7a0b01';
const PRINCIPAL = '00000000-0000-4000-8000-0000000000b2';
const NONCE = 'n'.repeat(32);

describe('migration 0172, which stores the delivery bridge', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;
  let tenant: Tenant & { id: string };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every migration up to 0171 and none after, tenant and platform alike.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0172-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        if (numbered !== null) return Number(numbered[1]) < 172;
        return !/[\\/]platform[\\/]0003_bridge_nonces\.sql$/.test(source);
      },
    });
    service = testTenantDatabase(db.serviceUrl);
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    tenant = {
      ...(await provisionTenant(db.adminUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id, name: 'Production' },
        hostnames: [`${id}.alloy.test`],
      })),
      id,
    };
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const general = (trx: TenantTransaction) =>
    trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow()
      .then((space) => space.id);

  it('runs a schema before it without the bridge, then keeps a delivery and its audit kind after', async () => {
    // At 0171: no bridge kind and no nonce table.
    await expect(
      as((trx) => recordEvent(trx, { kind: 'bridge.settings_changed', detail: { changed: [] } })),
    ).rejects.toThrow();
    await expect(as((trx) => recordNonce(trx, NONCE))).rejects.toThrow();

    await migrate(db.migratorUrl);

    const started = await as(async (trx) =>
      startDelivery(trx, {
        key: 'delivery-key-1',
        spaceId: await general(trx),
        family: 'document',
        tokenId: TOKEN,
        principalId: PRINCIPAL,
        packageKey: null,
        provenance: { source: 'a.docx' },
      }),
    );
    expect(started.answer).toBe('started');
    expect(await as((trx) => recordNonce(trx, NONCE))).toBe('new');
    await expect(
      as((trx) => recordEvent(trx, { kind: 'bridge.settings_changed', detail: { changed: [] } })),
    ).resolves.toBeDefined();
  });
});
