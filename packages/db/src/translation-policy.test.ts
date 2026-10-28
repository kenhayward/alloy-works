import { randomUUID } from 'node:crypto';
import { DEFAULT_TRANSLATION_POLICY } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
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
import {
  lockTranslationPolicy,
  setTranslationPolicy,
  translationPolicyHistory,
  translationPolicyNow,
} from './translation.js';

describe("the translation policy's history (the TE plan, TE-D)", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: ada });
  const history = () => as((trx) => translationPolicyHistory(trx, { limit: 100 }));

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
    await service.withTenant(tenant, async (trx) => {
      const person = async (name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: randomUUID(),
              email: null,
              display_name: name,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('Ada');
      grace = await person('Grace');
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('LOC-036 keeps each change to the policy whole, by whom and when, the newest first, and nothing where no value changed', async () => {
    const first = await history();
    // 0170's row: the policy as found, by nobody.
    expect(first.items).toEqual([
      expect.objectContaining({
        policy: DEFAULT_TRANSLATION_POLICY,
        by: null,
        at: expect.any(Date),
      }),
    ]);
    const now = await as((trx) => translationPolicyNow(trx));
    expect(now).toEqual({ policy: DEFAULT_TRANSLATION_POLICY, change: first.items[0]!.id });

    const changed = {
      fallback: 'refuse' as const,
      outOfDate: 'publish' as const,
      note: { fr: 'Non traduit' },
      conflict: 'accept' as const,
      machine: 'inside' as const,
    };
    await as((trx) => setTranslationPolicy(trx, changed, ada));
    // The same again, by somebody else: no change.
    await as((trx) => setTranslationPolicy(trx, changed, grace));
    // Left out, conflict and machine stay as they are; a change to the note alone is a change.
    await as((trx) =>
      setTranslationPolicy(trx, { fallback: 'refuse', outOfDate: 'publish', note: {} }, grace),
    );
    const after = await history();
    expect(after.items.map((each) => [each.policy, each.by])).toEqual([
      [
        { ...changed, note: {} },
        { id: grace, displayName: 'Grace' },
      ],
      [changed, { id: ada, displayName: 'Ada' }],
      [DEFAULT_TRANSLATION_POLICY, null],
    ]);
    expect((await as((trx) => translationPolicyNow(trx))).change).toBe(after.items[0]!.id);

    // Paged, the newest first, by its keyset.
    const page = await as((trx) => translationPolicyHistory(trx, { limit: 2 }));
    expect(page.items.map((each) => each.id)).toEqual(after.items.slice(0, 2).map((e) => e.id));
    const rest = await as((trx) =>
      translationPolicyHistory(trx, { limit: 2, after: page.next!, snapshot: page.snapshot }),
    );
    expect(rest.items.map((each) => each.id)).toEqual([after.items[2]!.id]);
    expect(rest.next).toBeNull();

    // Insert-only: no row of it is changed or removed by the service's role.
    await expect(
      as((trx) => sql`update translation_policy_change set machine = 'any'`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as((trx) => sql`delete from translation_policy_change`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await as((trx) => setTranslationPolicy(trx, DEFAULT_TRANSLATION_POLICY, ada));
  });

  it('LOC-036 loses no row to two changes made at once: the second waits on the first and compares against it', async () => {
    const before = (await history()).items.length;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockedYet = new Promise<void>((resolve) => (locked = resolve));
    const first = as(async (trx) => {
      await lockTranslationPolicy(trx);
      locked();
      await held;
      await setTranslationPolicy(trx, { ...DEFAULT_TRANSLATION_POLICY, fallback: 'refuse' }, ada);
    });
    await lockedYet;
    const second = as(async (trx) => {
      // Read under the lock: the first's change, once it commits.
      const seen = await lockTranslationPolicy(trx);
      await setTranslationPolicy(trx, { ...seen, outOfDate: 'refuse' }, grace);
    });
    release();
    await Promise.all([first, second]);
    const after = (await history()).items;
    expect(after).toHaveLength(before + 2);
    expect(after.slice(0, 2).map((each) => [each.policy.fallback, each.policy.outOfDate])).toEqual([
      ['refuse', 'refuse'],
      ['refuse', 'publish'],
    ]);
    await as((trx) => setTranslationPolicy(trx, DEFAULT_TRANSLATION_POLICY, ada));
  });
});
