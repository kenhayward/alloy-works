import { randomUUID } from 'node:crypto';
import { decide } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts, loadReadableSet } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import {
  grantSupport,
  listSupport,
  recordSupportRead,
  recordSupportUse,
  revokeSupport,
} from './support.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const DAY = 86_400_000;

describe('support access (support.md; the SA plan, SA-D)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let clinical: string;
  let quality: string;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: ada });
  const inDays = (days: number) => new Date(Date.now() + days * DAY);
  const granting = (email: string, overrides: Partial<Parameters<typeof grantSupport>[1]> = {}) =>
    as((trx) =>
      grantSupport(trx, {
        email,
        scope: 'metadata',
        spaces: [clinical],
        purpose: 'Why the outline will not save',
        expiresAt: inDays(7),
        grantedBy: ada,
        ...overrides,
      }),
    );
  const events = (kind: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['subject', 'detail', 'actor'])
        .where('kind', '=', kind as never)
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
      hostnames: ['support.acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    ({ ada, clinical, quality } = await service.withTenant(tenant, async (trx) => ({
      ada: (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: 'ada@acme.example',
            email_verified: true,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id,
      clinical: (await createSpace(trx, 'Clinical')).id,
      quality: (await createSpace(trx, 'Quality')).id,
    })));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('ADM-042 grants support to an address, invited from outside, audited with its scope, spaces, purpose and expiry, and revokes it', async () => {
    const answer = await granting('alice@vendor.example');
    if (!('granted' in answer)) throw new Error(answer.refused);
    expect(answer.invitation).toMatchObject({ email: 'alice@vendor.example', kind: 'external' });
    expect(answer.granted).toMatchObject({
      scope: 'metadata',
      spaces: [clinical],
      purpose: 'Why the outline will not save',
      principal: { id: answer.invitation!.principalId, email: 'alice@vendor.example' },
      grantedBy: { id: ada, name: 'Ada' },
      revokedAt: null,
      active: true,
    });
    const [granted] = await events('support.granted');
    expect(granted).toMatchObject({
      subject: answer.granted.id,
      actor: ada,
      detail: {
        principal: answer.invitation!.principalId,
        scope: 'metadata',
        spaces: [clinical],
        purpose: 'Why the outline will not save',
        expiresAt: answer.granted.expiresAt.toISOString(),
      },
    });

    const revoked = await as((trx) => revokeSupport(trx, answer.granted.id, ada));
    expect(revoked).toMatchObject({ revoked: { active: false, revokedBy: { id: ada } } });
    expect(await as((trx) => revokeSupport(trx, answer.granted.id, ada))).toEqual({
      refused: 'support.revoked',
    });
    expect(await as((trx) => revokeSupport(trx, randomUUID(), ada))).toEqual({
      refused: 'support.missing',
    });
    expect(await events('support.revoked')).toHaveLength(1);
    const listed = await as((trx) => listSupport(trx));
    expect(listed.find((each) => each.id === answer.granted.id)).toMatchObject({ active: false });
  });

  it('ADM-023 refuses support with no expiry in reach, beyond the cap, with no space to read, or for somebody inside', async () => {
    expect(await granting('bea@vendor.example', { expiresAt: inDays(-1) })).toEqual({
      refused: 'support.expiry_past',
    });
    expect(await granting('bea@vendor.example', { expiresAt: inDays(400) })).toEqual({
      refused: 'support.past_cap',
    });
    expect(await granting('bea@vendor.example', { scope: 'content', spaces: [] })).toEqual({
      refused: 'support.spaces_required',
    });
    expect(await granting('bea@vendor.example', { spaces: [randomUUID()] })).toEqual({
      refused: 'support.space_missing',
    });
    expect(await granting('ada@acme.example')).toEqual({ refused: 'support.member' });
    // A diagnostics grant may name no space; a second while one is active is refused.
    expect(await granting('cy@vendor.example', { scope: 'diagnostics', spaces: [] })).toMatchObject(
      { granted: { scope: 'diagnostics', spaces: [] } },
    );
    expect(await granting('cy@vendor.example')).toEqual({ refused: 'support.active' });
  });

  it('ADM-022 decides a support principal from the grant alone, reading only its spaces, until the cap is lowered past it', async () => {
    const answer = await granting('dee@vendor.example');
    if (!('granted' in answer)) throw new Error(answer.refused);
    const dee = answer.invitation!.principalId;
    const facts = (space: string) => as((trx) => loadFacts(trx, dee, { kind: 'space', id: space }));
    expect(decide('read', (await facts(clinical))!)).toMatchObject({
      allowed: true,
      reason: 'support',
    });
    expect(decide('read', (await facts(quality))!)).toMatchObject({ allowed: false });
    expect(await as((trx) => loadReadableSet(trx, dee))).toMatchObject({
      tenant: false,
      spaces: [clinical],
    });

    await as((trx) =>
      trx
        .updateTable('access_policy')
        .set({ external_default_days: 3, external_cap_days: 3 })
        .execute(),
    );
    try {
      expect(decide('read', (await facts(clinical))!).allowed).toBe(false);
      expect(await as((trx) => listSupport(trx))).toContainEqual(
        expect.objectContaining({ id: answer.granted.id, active: false }),
      );
    } finally {
      await as((trx) =>
        trx
          .updateTable('access_policy')
          .set({ external_default_days: 30, external_cap_days: 90 })
          .execute(),
      );
    }
  });

  it('ADM-024 records support used once a day a grant, and every content read with its purpose', async () => {
    const answer = await granting('eve@vendor.example', { scope: 'content' });
    if (!('granted' in answer)) throw new Error(answer.refused);
    const before = (await events('support.used')).length;
    await as((trx) => recordSupportUse(trx, answer.granted));
    await as((trx) => recordSupportUse(trx, answer.granted));
    const component = randomUUID();
    await as((trx) =>
      recordSupportRead(trx, answer.granted, {
        route: 'getComponent',
        on: { componentId: component },
        purpose: 'The figure caption is missing',
      }),
    );
    expect((await events('support.used')).slice(before)).toEqual([
      expect.objectContaining({ subject: answer.granted.id, detail: { scope: 'content' } }),
      expect.objectContaining({
        detail: {
          scope: 'content',
          route: 'getComponent',
          on: { componentId: component },
          purpose: 'The figure caption is missing',
        },
      }),
    ]);
  });

  it('keeps a grant as it was given: the runtime role cannot edit or remove one', async () => {
    const answer = await granting('fay@vendor.example', { scope: 'diagnostics', spaces: [] });
    if (!('granted' in answer)) throw new Error(answer.refused);
    await expect(
      as((trx) =>
        sql`update support_grant set scope = 'content' where id = ${answer.granted.id}`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as((trx) => sql`delete from support_grant where id = ${answer.granted.id}`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });
});
