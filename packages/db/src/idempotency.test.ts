import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { recallAnswer, rememberAnswer } from './idempotency.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  untilWaitingOnLocks,
  type TestDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';
const DIGEST = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('an answer kept against its idempotency key', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let adaThere: string;

  const person = (tenant: Tenant) =>
    service.withTenant(
      tenant,
      async (trx) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id,
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl, { max: 4 });
    ada = await person(production);
    adaThere = await person(development);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const asked = (key: string, digest = DIGEST, principal = () => ada) => ({
    principal: principal(),
    key,
    operation: 'createDocument',
    digest,
  });

  it('recalls an answer for the same request, and refuses the key for another', async () => {
    await service.withTenant(production, async (trx) => {
      expect(await recallAnswer(trx, asked('k1'))).toEqual({ kind: 'none' });
      await rememberAnswer(trx, { ...asked('k1'), status: 200, body: { id: 'made' } });
    });
    await service.withTenant(production, async (trx) => {
      expect(await recallAnswer(trx, asked('k1'))).toEqual({
        kind: 'replay',
        status: 200,
        body: { id: 'made' },
      });
      // The same key for a different request: never the other's answer, never run as new.
      expect(await recallAnswer(trx, asked('k1', OTHER))).toEqual({ kind: 'reused' });
    });
  });

  it("IAM-075 keeps each principal's keys their own, in their own environment", async () => {
    await service.withTenant(production, (trx) =>
      rememberAnswer(trx, { ...asked('shared'), status: 200, body: { id: 'hers' } }),
    );
    // Another environment's principal with the same key has nothing kept.
    await service.withTenant(development, async (trx) => {
      expect(
        await recallAnswer(
          trx,
          asked('shared', DIGEST, () => adaThere),
        ),
      ).toEqual({
        kind: 'none',
      });
    });
  });

  it('forgets an answer after a day, and the next request with its key is new', async () => {
    await service.withTenant(production, async (trx) => {
      await rememberAnswer(trx, { ...asked('old'), status: 200, body: { id: 'then' } });
      await sql`update idempotency_record set made_at = now() - interval '25 hours'
                where key = 'old'`.execute(trx);
    });
    await service.withTenant(production, async (trx) => {
      expect(await recallAnswer(trx, asked('old', OTHER))).toEqual({ kind: 'none' });
      await rememberAnswer(trx, { ...asked('old', OTHER), status: 200, body: { id: 'now' } });
    });
    await service.withTenant(production, async (trx) => {
      expect(await recallAnswer(trx, asked('old', OTHER))).toMatchObject({ body: { id: 'now' } });
    });
  });

  it('makes a second request with a key wait for the first, then answers it from the record', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = service.withTenant(production, async (trx) => {
      expect(await recallAnswer(trx, asked('race'))).toEqual({ kind: 'none' });
      await held;
      await rememberAnswer(trx, { ...asked('race'), status: 200, body: { id: 'once' } });
    });
    const second = service.withTenant(production, (trx) => recallAnswer(trx, asked('race')));
    await untilWaitingOnLocks(db.adminUrl, 1);
    release();
    await first;
    expect(await second).toEqual({ kind: 'replay', status: 200, body: { id: 'once' } });
  });
});
