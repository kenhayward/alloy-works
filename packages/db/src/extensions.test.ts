import type { AuditContext, ExtensionManifest } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  extensionUses,
  installExtension,
  listExtensions,
  removeExtension,
  updateExtension,
} from './extensions.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const SYSTEM: AuditContext = { actorKind: 'system' };

/** An invented extension's manifest. */
const MANIFEST: ExtensionManifest = {
  manifest: 1,
  name: 'Gauge readings',
  version: '1.2.0',
  publisher: 'Invented Instruments',
  description: 'River gauge readings by site.',
  kind: 'source',
  endpoint: 'https://gauges.example.test/alloy',
  settings: [{ key: 'region', label: 'Region', type: 'text', required: true }],
  authentication: { label: 'API key' },
  capabilities: { parameters: true, keyColumns: false, rowLimit: true },
  outbound: [{ host: 'gauges.example.test', purpose: 'The readings asked for' }],
};
const DIGEST = 'a'.repeat(64);
const NEWER = 'b'.repeat(64);

describe('extensions installed, updated and removed (the EX plan, EX-B to EX-E)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, SYSTEM);

  const changes = (id: string) =>
    as((trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('kind', '=', 'extension.changed')
        .where('subject', '=', id)
        .orderBy('sequence')
        .execute(),
    );

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
    ada = (
      await as((trx) =>
        trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      )
    ).id;
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('API-048 keeps every manifest an extension has had, its latest the one it answers by', async () => {
    const made = await as((trx) =>
      installExtension(trx, {
        url: 'https://gauges.example.test/manifest.json',
        digest: DIGEST,
        manifest: MANIFEST,
        by: ada,
      }),
    );
    expect(made).toMatchObject({ digest: DIGEST, manifest: MANIFEST, removedAt: null });
    const updated = await as((trx) =>
      updateExtension(trx, made.id, {
        digest: NEWER,
        manifest: { ...MANIFEST, version: '1.3.0' },
        by: ada,
      }),
    );
    expect(updated).toMatchObject({ digest: NEWER, manifest: { version: '1.3.0' } });
    // Back to the first: a version of its own, the earlier ones kept.
    await as((trx) =>
      updateExtension(trx, made.id, { digest: DIGEST, manifest: MANIFEST, by: ada }),
    );
    const versions = await as((trx) =>
      trx
        .selectFrom('extension_version')
        .select('digest')
        .where('extension_id', '=', made.id)
        .orderBy('id')
        .execute(),
    );
    expect(versions.map((each) => each.digest)).toEqual([DIGEST, NEWER, DIGEST]);
    await expect(
      as((trx) =>
        sql`update extension_version set digest = ${NEWER} where extension_id = ${made.id}`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    expect((await changes(made.id)).map((each) => each.detail)).toEqual([
      { change: 'installed', digest: DIGEST },
      { change: 'updated', digest: NEWER },
      { change: 'updated', digest: DIGEST },
    ]);
    expect(JSON.stringify(await changes(made.id))).not.toContain('gauges.example.test');
  });

  it('API-048 removes an extension nothing uses, kept so what used it still names it', async () => {
    const made = await as((trx) =>
      installExtension(trx, {
        url: 'https://other.example.test/manifest.json',
        digest: DIGEST,
        manifest: MANIFEST,
        by: ada,
      }),
    );
    expect(await as((trx) => extensionUses(trx, made.id))).toEqual([]);
    expect(await as((trx) => removeExtension(trx, made.id, ada))).toEqual({ removed: true });
    const listed = await as((trx) => listExtensions(trx, { limit: 100 }));
    expect(listed.items.find((each) => each.id === made.id)?.removedAt).toEqual(expect.any(Date));
    expect((await changes(made.id)).at(-1)?.detail).toEqual({ change: 'removed', digest: DIGEST });
  });
});
