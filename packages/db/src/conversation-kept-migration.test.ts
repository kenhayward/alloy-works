import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { listConversations, startConversation, updateConversation } from './conversations.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  beforeTheLogDatabase,
} from './testing/database.js';

/**
 * Migration 0183 (the DQ plan): a conversation listed only once its owner keeps it, and named by them;
 * those made before it kept, so nobody loses one. Nothing else of a conversation changes, and none is
 * deleted, as 0127 holds.
 */
describe('migration 0183, which keeps a conversation by choice and lets its owner name it', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;
  let tenant: Tenant;
  let ada: string;
  let earlier: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration before 0183 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0183-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 183;
      },
    });
    service = beforeTheLogDatabase(db.serviceUrl);
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const provisioned = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Conversations' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    tenant = { ...provisioned, id };
    ada = await service.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    // Made before 0183, as its insert then was.
    earlier = await service.withTenant(tenant, async (trx) => {
      const { rows } = await sql<{ id: string }>`insert into conversation (owner, title)
        values (${ada}, 'Before') returning id`.execute(trx);
      return rows[0]!.id;
    });
    await migrate(db.migratorUrl);
  }, 120_000);

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  it('keeps every conversation made before it, and lists a new one only once it is kept', async () => {
    await service.withTenant(tenant, async (trx) => {
      const made = await startConversation(trx, { owner: ada, documentId: null, title: 'New' });
      expect(made.kept).toBe(false);
      expect((await listConversations(trx, ada)).map((each) => each.title)).toEqual(['Before']);
      const kept = await updateConversation(trx, made.id, { kept: true });
      expect(kept).toMatchObject({ title: 'New', kept: true });
      expect((await listConversations(trx, ada)).map((each) => each.id)).toEqual([
        made.id,
        earlier,
      ]);
      const named = await updateConversation(trx, made.id, { title: 'Floods' });
      expect(named).toMatchObject({ title: 'Floods', kept: true });
      await updateConversation(trx, made.id, { kept: false });
      expect((await listConversations(trx, ada)).map((each) => each.id)).toEqual([earlier]);
    });
  });

  it('changes nothing else of a conversation, and deletes none', async () => {
    const refused = (
      statement: (
        trx: Parameters<Parameters<TenantDatabase['withTenant']>[1]>[0],
      ) => Promise<unknown>,
    ) => service.withTenant(tenant, statement);
    await expect(
      refused((trx) =>
        sql`update conversation set document_id = gen_random_uuid() where id = ${earlier}`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/nothing of a conversation changes/);
    await expect(
      refused((trx) =>
        sql`update conversation set made_at = now() - interval '1 day' where id = ${earlier}`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/nothing of a conversation changes/);
    await expect(
      refused((trx) => sql`delete from conversation where id = ${earlier}`.execute(trx)),
    ).rejects.toThrow(/never deleted/);
  });
});
