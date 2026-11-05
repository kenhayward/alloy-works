import type { AuditContext } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  claimMail,
  listMail,
  mailChannel,
  mailCounts,
  queueTestMail,
  recordMailAttempt,
  setMailChannel,
  setMailPassword,
  sweepMail,
} from './mail.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createServiceIdentity } from './service-identities.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const SYSTEM: AuditContext = { actorKind: 'system' };
const LEASE_MS = 60_000;

describe('the mail queue (the EM plan, EM-G, EM-L, EM-M and EM-N)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, SYSTEM);

  const person = (name: string, over: { email?: string | null; verified?: boolean } = {}) =>
    as(async (trx) => {
      const { id } = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: name,
          email: over.email === undefined ? `${name}@example.test` : over.email,
          email_verified: over.verified ?? true,
          display_name: name,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return id;
    });

  const claim = () => as((trx) => claimMail(trx, 50, LEASE_MS));
  const delivery = (id: string) =>
    as((trx) =>
      trx
        .selectFrom('email_delivery')
        .select(['state', 'attempts', 'dropped_reason', 'next_at', 'first_attempt_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
  const channel = () =>
    as(async (trx) =>
      trx.selectFrom('mail_channel').select(['failing_since', 'last_success_at']).executeTakeFirst(),
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
    ada = await person('ada');
  });

  beforeEach(async () => {
    await as(async (trx) => {
      await trx.deleteFrom('email_delivery').execute();
      await trx.deleteFrom('mail_channel').execute();
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('claims a test mail with its channel and the verified address it goes to, leased', async () => {
    await as((trx) =>
      setMailChannel(trx, {
        enabled: false,
        relay: 'own',
        host: 'mail.example.test',
        port: 587,
        username: 'ada',
        fromAddress: 'news@example.test',
        fromName: 'Acme news',
        by: ada,
      }),
    );
    const held = await as((trx) => mailChannel(trx));
    await as((trx) => setMailPassword(trx, held!.id, 'sealed-for-the-test', ada));
    const id = await as((trx) => queueTestMail(trx, ada));
    const { claimed, dropped } = await claim();
    expect(dropped).toBe(0);
    expect(claimed).toEqual([
      {
        id,
        purpose: 'test',
        to: 'ada@example.test',
        relay: {
          kind: 'own',
          host: 'mail.example.test',
          port: 587,
          username: 'ada',
          sealed: 'sealed-for-the-test',
          fromAddress: 'news@example.test',
        },
        fromName: 'Acme news',
        lease: expect.any(String) as string,
      },
    ]);
    // Leased: no other worker claims it while it is sent.
    expect((await claim()).claimed).toEqual([]);
  });

  it('claims by the operator’s relay where nobody has set a channel, naming nothing of its own', async () => {
    await as((trx) => queueTestMail(trx, ada));
    const { claimed } = await claim();
    expect(claimed[0]).toMatchObject({ relay: { kind: 'platform' }, fromName: null });
  });

  it('sends nothing to an unverified address, an erased person or a service identity, and counts them', async () => {
    const grace = await person('grace', { verified: false });
    const ida = await person('ida', { email: null });
    const erased = await person('emmy');
    await as((trx) =>
      sql`update principal set erased_at = now(), email = null where id = ${erased}`.execute(trx),
    );
    const disabled = await person('hedy');
    await as((trx) =>
      sql`update principal set disabled_at = now(), disabled_by = 'person' where id = ${disabled}`.execute(
        trx,
      ),
    );
    const robot = (
      await as((trx) => createServiceIdentity(trx, { name: 'Robot', description: '', by: ada }))
    ).id;
    const ids = await as(async (trx) => {
      const each: Record<string, string> = {};
      for (const [name, who] of Object.entries({ grace, ida, erased, disabled, robot })) {
        each[name] = await queueTestMail(trx, who);
      }
      return each;
    });
    const { claimed, dropped } = await claim();
    expect(claimed).toEqual([]);
    expect(dropped).toBe(5);
    expect((await delivery(ids.grace!)).dropped_reason).toBe('unverified');
    expect((await delivery(ids.ida!)).dropped_reason).toBe('no_address');
    expect((await delivery(ids.erased!)).dropped_reason).toBe('erased');
    expect((await delivery(ids.disabled!)).dropped_reason).toBe('disabled');
    expect((await delivery(ids.robot!)).dropped_reason).toBe('service_identity');
    expect(await as((trx) => mailCounts(trx))).toMatchObject({
      waiting: 0,
      dropped: { unverified: 1, no_address: 1, erased: 1, disabled: 1, service_identity: 1 },
    });
  });

  it('retries a relay’s failure from 30 seconds, marking the channel failing until a send clears it', async () => {
    await as((trx) =>
      setMailChannel(trx, {
        enabled: true,
        relay: 'platform',
        host: null,
        port: null,
        username: null,
        fromAddress: null,
        fromName: null,
        by: ada,
      }),
    );
    const id = await as((trx) => queueTestMail(trx, ada));
    const [first] = (await claim()).claimed;
    const failed = await as((trx) =>
      recordMailAttempt(
        trx,
        id,
        { kind: 'failed', failure: 'connection_failed', latencyMs: 12 },
        first!.lease,
      ),
    );
    expect(failed).toEqual({ relayFailed: true });
    const waiting = await delivery(id);
    expect(waiting).toMatchObject({ state: 'pending', attempts: 1 });
    expect(waiting.next_at.getTime() - Date.now()).toBeGreaterThan(25_000);
    expect((await channel())!.failing_since).not.toBeNull();

    await as((trx) => sql`update email_delivery set next_at = now() where id = ${id}`.execute(trx));
    const [second] = (await claim()).claimed;
    expect(
      await as((trx) =>
        recordMailAttempt(trx, id, { kind: 'sent', latencyMs: 30 }, second!.lease),
      ),
    ).toEqual({ relayFailed: false });
    expect(await delivery(id)).toMatchObject({ state: 'sent', attempts: 2 });
    expect(await channel()).toMatchObject({ failing_since: null });
    expect((await channel())!.last_success_at).not.toBeNull();
  });

  it('gives up one recipient the relay refuses for good, and the channel is not failing', async () => {
    const id = await as((trx) => queueTestMail(trx, ada));
    const [one] = (await claim()).claimed;
    expect(
      await as((trx) =>
        recordMailAttempt(
          trx,
          id,
          { kind: 'failed', failure: 'recipient_refused', smtpCode: 550, latencyMs: 9 },
          one!.lease,
        ),
      ),
    ).toEqual({ relayFailed: false });
    expect(await delivery(id)).toMatchObject({ state: 'given_up', attempts: 1 });
    const page = await as((trx) => listMail(trx, { limit: 10 }));
    expect(page.items[0]).toMatchObject({
      id,
      purpose: 'test',
      state: 'given_up',
      attempts: 1,
      last: { failure: 'recipient_refused', smtpCode: 550 },
    });
  });

  it('drops a mail at once where the operator offers no relay', async () => {
    const id = await as((trx) => queueTestMail(trx, ada));
    const [one] = (await claim()).claimed;
    await as((trx) =>
      recordMailAttempt(
        trx,
        id,
        { kind: 'failed', failure: 'relay_not_configured', latencyMs: 0 },
        one!.lease,
      ),
    );
    expect(await delivery(id)).toMatchObject({
      state: 'dropped',
      dropped_reason: 'relay_not_configured',
    });
  });

  it('lets a full connector or a spent hour wait, costing no attempt', async () => {
    const id = await as((trx) => queueTestMail(trx, ada));
    for (const failure of ['wait', 'quota_reached'] as const) {
      await as((trx) => sql`update email_delivery set next_at = now() where id = ${id}`.execute(trx));
      const [one] = (await claim()).claimed;
      await as((trx) =>
        recordMailAttempt(
          trx,
          id,
          failure === 'wait'
            ? { kind: 'wait' }
            : { kind: 'failed', failure, latencyMs: 0 },
          one!.lease,
        ),
      );
      expect(await delivery(id)).toMatchObject({
        state: 'pending',
        attempts: 0,
        first_attempt_at: null,
      });
    }
    expect((await channel()) ?? { failing_since: null }).toMatchObject({ failing_since: null });
  });

  it('gives up a test an hour after its first attempt, decided at claiming', async () => {
    const id = await as((trx) => queueTestMail(trx, ada));
    await as((trx) =>
      sql`update email_delivery set attempts = 3, first_attempt_at = now() - interval '61 minutes'
          where id = ${id}`.execute(trx),
    );
    expect((await claim()).claimed).toEqual([]);
    expect(await delivery(id)).toMatchObject({ state: 'given_up' });
  });

  it('records nothing for a claim whose lease another worker claimed past', async () => {
    const id = await as((trx) => queueTestMail(trx, ada));
    await claim();
    await as((trx) =>
      recordMailAttempt(trx, id, { kind: 'sent', latencyMs: 1 }, '2000-01-01 00:00:00+00'),
    );
    expect(await delivery(id)).toMatchObject({ state: 'pending', attempts: 0 });
  });

  it('sweeps deliveries past 30 days, with their attempts', async () => {
    const id = await as((trx) => queueTestMail(trx, ada));
    await as((trx) =>
      sql`update email_delivery set created_at = now() - interval '31 days' where id = ${id}`.execute(
        trx,
      ),
    );
    const kept = await as((trx) => queueTestMail(trx, ada));
    expect(await as((trx) => sweepMail(trx))).toBe(1);
    const left = await as((trx) => trx.selectFrom('email_delivery').select('id').execute());
    expect(left).toEqual([{ id: kept }]);
  });
});
