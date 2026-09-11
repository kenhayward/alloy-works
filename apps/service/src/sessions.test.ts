import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, endSession, findSession, hashToken, SESSION_POLICY } from './sessions.js';

describe('sessions', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    ada = await service.withTenant(tenant, async (trx) => {
      const row = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'ada',
          email: 'ada@example.com',
          display_name: 'Ada',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const at = (ms: number) => new Date(Date.UTC(2026, 8, 11) + ms);

  it('finds the principal a token belongs to', async () => {
    const token = await service.withTenant(tenant, (trx) =>
      createSession(trx, ada, 'organisation', at(0)),
    );
    const found = await service.withTenant(tenant, (trx) => findSession(trx, token, at(1000)));
    expect(found).toEqual({ principalId: ada, email: 'ada@example.com', displayName: 'Ada' });
  });

  it('keeps only a hash of the token', async () => {
    const token = await service.withTenant(tenant, (trx) =>
      createSession(trx, ada, 'organisation', at(0)),
    );
    const { rows } = await queryAs(db.adminUrl, `select token_hash from ${tenant.schema}.session`);
    const stored = rows.map((row) => row.token_hash as string);
    expect(stored).toContain(hashToken(token));
    expect(stored).not.toContain(token);
  });

  it('ends a session left idle, and one past its absolute lifetime', async () => {
    const idle = await service.withTenant(tenant, (trx) =>
      createSession(trx, ada, 'organisation', at(0)),
    );
    expect(
      await service.withTenant(tenant, (trx) =>
        findSession(trx, idle, at(SESSION_POLICY.idleMs + 1)),
      ),
    ).toBeUndefined();

    const busy = await service.withTenant(tenant, (trx) =>
      createSession(trx, ada, 'organisation', at(0)),
    );
    // Used every 50 minutes, it stays alive by idleness but not past twelve hours.
    for (let minutes = 50; minutes < 12 * 60; minutes += 50) {
      expect(
        await service.withTenant(tenant, (trx) => findSession(trx, busy, at(minutes * 60_000))),
      ).toBeDefined();
    }
    expect(
      await service.withTenant(tenant, (trx) =>
        findSession(trx, busy, at(SESSION_POLICY.absoluteMs + 1)),
      ),
    ).toBeUndefined();
  });

  it('ends a session at once when asked', async () => {
    const token = await service.withTenant(tenant, (trx) =>
      createSession(trx, ada, 'organisation', at(0)),
    );
    await service.withTenant(tenant, (trx) => endSession(trx, token));
    expect(
      await service.withTenant(tenant, (trx) => findSession(trx, token, at(1000))),
    ).toBeUndefined();
  });
});
