import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { InterfaceLanguage } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { collationFor, collationVersions, keysetPage, sortColumns, type Keyset } from './listing.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

/** Names in two scripts and with accents: what a reader's language orders differently. */
const NAMES = ['zebra', 'Écrit', 'apple', 'بحر', 'Eclair'];

describe('a listing in the reader’s collation (the UI plan, UI-H)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  const rows = NAMES.map((name) => ({ id: randomUUID(), name }));

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

  /** Every name, a page of one at a time, each page continuing from the last's cursor. */
  const walk = (language?: InterfaceLanguage) =>
    service.withTenant(tenant, async (trx) => {
      const inner = sql`select v.id::uuid as id, ${sql.join(sortColumns([sql`v.name`]))}
        from (values ${sql.join(rows.map((row) => sql`(${row.id}, ${row.name})`))}) as v(id, name)`;
      const seen: string[] = [];
      let after: Keyset | undefined;
      for (;;) {
        const page = await keysetPage<{ id: string; sort_key_0: string }>(
          trx,
          inner,
          ['text'],
          'asc',
          1,
          after,
          language,
        );
        seen.push(...page.rows.map((row) => row.sort_key_0));
        if (page.next === null) return seen;
        after = page.next;
      }
    });

  it('LOC-003 orders text as the reader’s language does, page after page, and the right-to-left one as Arabic', async () => {
    expect(await walk('en-GB')).toEqual(['apple', 'Eclair', 'Écrit', 'zebra', 'بحر']);
    expect(await walk('ar-XB')).toEqual(['بحر', 'apple', 'Eclair', 'Écrit', 'zebra']);
  });

  it('names only a collation the cluster holds, never one a request spells', async () => {
    const named = await service.withTenant(tenant, (trx) => collationFor(trx, 'en-GB'));
    expect(named).toMatch(/-x-icu$/);
    expect(await service.withTenant(tenant, (trx) => collationFor(trx, undefined))).toBeUndefined();
  });

  it('LOC-044 names the version of each collation the interface languages sort by, as the cluster has it', async () => {
    const versions = await service.withTenant(tenant, (trx) => collationVersions(trx));
    expect(versions.map((each) => each.language)).toEqual(['en-GB', 'en-XA', 'ar-XB']);
    for (const each of versions) {
      expect(each.collation).toMatch(/-x-icu$/);
      expect(each.version).toMatch(/^\d+(\.\d+)+$/);
    }
    // A pseudo-locale sorts as the language it is made from.
    expect(versions[1]!.collation).toBe(versions[0]!.collation);
  });
});
