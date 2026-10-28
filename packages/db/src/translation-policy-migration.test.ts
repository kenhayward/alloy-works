import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_TRANSLATION_POLICY } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument } from './documents.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import { requestPublication } from './publishing.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import {
  setTranslationPolicy,
  translationPolicyHistory,
  translationPolicyNow,
} from './translation.js';

describe("migration 0170, which keeps the translation policy's history", () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;
  let tenant: Tenant & { id: string };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0169 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0170-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 170;
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

  it('LOC-036 runs today’s code on a schema before it, then inserts the policy as found, by nobody', async () => {
    const changed = {
      fallback: 'refuse' as const,
      outOfDate: 'refuse' as const,
      note: { fr: 'Non traduit' },
      conflict: 'reject' as const,
      machine: 'any' as const,
    };
    // At 0169: set and read as ever, with no history, and a publish in a language recording none.
    const ada = await as(async (trx) => {
      const person = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      expect(await setTranslationPolicy(trx, changed, person.id)).toEqual(changed);
      expect(await translationPolicyNow(trx)).toEqual({ policy: changed, change: null });
      expect((await translationPolicyHistory(trx, { limit: 10 })).items).toEqual([]);
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const made = await createDocument(trx, {
        spaceId: general.id,
        title: 'Pond survey',
        language: 'en-GB',
        direction: 'ltr',
        author: person.id,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const asked = await requestPublication(trx, {
        documentId: made.version.artifactId,
        version: made.version.id,
        formats: ['pdf'],
        requester: person.id,
        language: 'fr-FR',
      });
      expect(asked.answer).toBe('requested');
      const { rows } = await sql<{
        recorded: boolean;
      }>`select bool_or(to_jsonb(r) ? 'policy_change') as recorded
           from publication_request r`.execute(trx);
      expect(rows[0]!.recorded).toBe(false);
      return person.id;
    });

    await migrate(db.migratorUrl);
    const after = await as(async (trx) => ({
      history: (await translationPolicyHistory(trx, { limit: 10 })).items,
      now: await translationPolicyNow(trx),
    }));
    expect(after.history).toEqual([
      expect.objectContaining({ policy: changed, by: null, at: expect.any(Date) }),
    ]);
    expect(after.now).toEqual({ policy: changed, change: after.history[0]!.id });

    // From here, a change is kept.
    await as((trx) => setTranslationPolicy(trx, DEFAULT_TRANSLATION_POLICY, ada));
    const kept = await as((trx) => translationPolicyHistory(trx, { limit: 10 }));
    expect(kept.items.map((each) => [each.policy, each.by?.id ?? null])).toEqual([
      [DEFAULT_TRANSLATION_POLICY, ada],
      [changed, null],
    ]);
  });
});
