import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepExpiredSignIns } from './sweep.js';

describe('sweeping what sign-ins leave behind', () => {
  let db: TestDatabase;
  let worker: TenantDatabase;
  let tenant: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    worker = createTenantDatabase(db.workerUrl);
  });

  afterAll(async () => {
    await worker.close();
    await db.drop();
  });

  it('removes what has expired in every tenant, and leaves what has not', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60 * 60_000);
    await worker.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const [state, expires] of [
        ['gone', past],
        ['kept', future],
      ] as const) {
        await trx
          .insertInto('sign_in_attempt')
          .values({
            state_hash: `attempt-${state}`,
            nonce: 'n',
            code_verifier: 'v',
            route: 'organisation',
            expires_at: expires,
          })
          .execute();
        await trx
          .insertInto('sign_in_handoff')
          .values({
            code_hash: `handoff-${state}`,
            principal_id: principal.id,
            attempt_hash: 'a',
            expires_at: expires,
          })
          .execute();
        await trx
          .insertInto('session')
          .values({
            token_hash: `session-${state}`,
            principal_id: principal.id,
            route: 'organisation',
            idle_expires_at: expires,
            expires_at: expires,
          })
          .execute();
      }
    });

    expect(await sweepExpiredSignIns(worker)).toBe(3);

    const left = await worker.withTenant(tenant, async (trx) => ({
      attempts: await trx.selectFrom('sign_in_attempt').select('state_hash').execute(),
      handoffs: await trx.selectFrom('sign_in_handoff').select('code_hash').execute(),
      sessions: await trx.selectFrom('session').select('token_hash').execute(),
    }));
    expect(left).toEqual({
      attempts: [{ state_hash: 'attempt-kept' }],
      handoffs: [{ code_hash: 'handoff-kept' }],
      sessions: [{ token_hash: 'session-kept' }],
    });
    expect(await sweepExpiredSignIns(worker)).toBe(0);
  });
});
