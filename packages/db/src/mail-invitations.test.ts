import type { AuditContext } from '@alloy-works/domain';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { inviteFirstAdministrator } from './first-administrator.js';
import { invite, withdrawInvitation } from './invitations.js';
import {
  claimMail,
  mailChannel,
  queueClosureReminders,
  queueTestMail,
  recordMailAttempt,
  setMailChannel,
} from './mail.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createServiceIdentity } from './service-identities.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import { cancelClosing, startClosing } from './tenant-lifecycle.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const SYSTEM: AuditContext = { actorKind: 'system' };
const LEASE_MS = 60_000;

describe('invitations and closure notices by email (the EM plan, EM-S, EM-U and EM-V)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let admin: pg.Client;
  let ada = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, SYSTEM);
  const byAda = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: ada });

  const person = (
    name: string,
    shape: { kind?: 'user' | 'external'; verified?: boolean; issuer?: boolean } = {},
  ) =>
    as(async (trx) => {
      const signedIn = shape.issuer ?? true;
      const { id } = await trx
        .insertInto('principal')
        .values({
          issuer: signedIn ? 'https://idp.example' : null,
          subject: signedIn ? name : null,
          email: `${name}@example.test`,
          email_verified: shape.verified ?? true,
          display_name: name,
          kind: shape.kind ?? 'user',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return id;
    });

  const deliveries = () =>
    as((trx) =>
      sql<{
        purpose: string;
        principal_id: string;
        invitation_id: string | null;
        notice: string | null;
        state: string;
        dropped_reason: string | null;
      }>`select purpose, principal_id, invitation_id, notice, state, dropped_reason
           from email_delivery order by created_at, id`.execute(trx),
    ).then(({ rows }) => rows);
  const claim = (purposes?: readonly ('closure' | 'invitation')[]) =>
    as((trx) => claimMail(trx, 200, LEASE_MS, purposes === undefined ? undefined : { purposes }));
  const inviting = (email: string) =>
    byAda(async (trx) => {
      const answer = await invite(trx, { email, external: false, invitedBy: ada });
      if (!('invited' in answer)) throw new Error(answer.refused);
      return answer.invited;
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = testTenantDatabase(db.serviceUrl);
    admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
  }, 120_000);

  /** Each test its own tenant, since closing leaves it somewhere new. */
  beforeEach(async () => {
    const id = db.newTenantId();
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Acme Production' },
      hostnames: [`${id}.alloy.test`],
    });
    ada = await person('ada');
  });

  afterAll(async () => {
    await admin?.end();
    await service?.close();
    await db?.drop();
  });

  it('IAM-089 mails an invitation on inviting and on renewing, to the invited address, by the operator’s relay where mail is off', async () => {
    const invited = await inviting('grace@example.test');
    await inviting('grace@example.test');
    // Renewed a day later, it is mailed again.
    await as((trx) =>
      sql`update email_delivery set created_at = now() - interval '25 hours'`.execute(trx),
    );
    await inviting('grace@example.test');
    // A share's extension moves the expiry alone, as `extendGrant` does: no mail.
    await as((trx) =>
      sql`update invitation set expires_at = expires_at + interval '1 day'
           where id = ${invited.id}`.execute(trx),
    );
    const rows = await deliveries();
    expect(rows.map((row) => [row.purpose, row.invitation_id, row.state])).toEqual([
      ['invitation', invited.id, 'pending'],
      // One a day to an address (EM-S): the renewal's that day is dropped.
      ['invitation', invited.id, 'dropped'],
      ['invitation', invited.id, 'pending'],
    ]);
    expect(rows[1]!.dropped_reason).toBe('invitation_repeated');
    const { claimed } = await claim();
    expect(claimed).toHaveLength(2);
    expect(claimed[0]).toMatchObject({
      purpose: 'invitation',
      to: 'grace@example.test',
      relay: { kind: 'platform' },
    });
  });

  it('IAM-089 mails the first administrator a vendor names', async () => {
    await inviteFirstAdministrator(db.adminUrl, tenant, {
      email: 'ivy@example.test',
      namedBy: 'Support ticket 12',
    });
    const { claimed } = await claim();
    expect(claimed.map((mail) => [mail.purpose, mail.to])).toEqual([
      ['invitation', 'ivy@example.test'],
    ]);
  });

  it('IAM-089 sends no withdrawn invitation, nor one accepted or lapsed by its sending', async () => {
    const withdrawn = await inviting('grace@example.test');
    await inviting('ivy@example.test');
    await inviting('joan@example.test');
    await byAda((trx) => withdrawInvitation(trx, withdrawn.id));
    await as((trx) =>
      sql`update invitation set accepted_at = now() where email = 'ivy@example.test'`.execute(trx),
    );
    await as((trx) =>
      sql`update invitation set expires_at = now() - interval '1 second'
           where email = 'joan@example.test'`.execute(trx),
    );
    const { claimed, dropped } = await claim();
    expect(claimed).toEqual([]);
    expect(dropped).toBe(2);
    expect((await deliveries()).map((row) => row.dropped_reason)).toEqual(['accepted', 'expired']);
  });

  it('IAM-089 limits how many invitations a tenant mails a day', async () => {
    for (let at = 0; at < 100; at += 1) await inviting(`person${at}@example.test`);
    await inviting('grace@example.test');
    const rows = await deliveries();
    expect(rows.filter((row) => row.state === 'pending')).toHaveLength(100);
    expect(rows.at(-1)).toMatchObject({ state: 'dropped', dropped_reason: 'invitation_quota' });
  });

  it('ADM-055 tells each person on starting to close and on cancelling, by the operator’s relay past the environment’s own, failing', async () => {
    const grace = await person('grace');
    const ivy = await person('ivy', { kind: 'external' });
    const unverified = await person('joan', { verified: false });
    await as((trx) => createServiceIdentity(trx, { name: 'Robot', description: '', by: ada }));
    await person('invited', { issuer: false });
    await as((trx) =>
      setMailChannel(trx, {
        enabled: true,
        relay: 'own',
        host: 'smtp.acme.test',
        port: 587,
        username: null,
        fromAddress: 'docs@acme.test',
        fromName: null,
        by: ada,
      }),
    );
    await byAda((trx) => startClosing(trx, tenant, { declined: true }));
    // The environment's own relay failing, a test waiting behind it.
    const test = await as((trx) => queueTestMail(trx, ada));
    const [lease] = (await claim()).claimed.filter((mail) => mail.id === test).map((m) => m.lease);
    await as((trx) =>
      sql`update email_delivery set locked_until = null where purpose = 'closure'`.execute(trx),
    );
    await as((trx) =>
      recordMailAttempt(
        trx,
        test,
        { kind: 'failed', failure: 'connection_failed', latencyMs: 5 },
        lease!,
      ),
    );
    const queued = (await deliveries()).filter((row) => row.purpose !== 'test');
    expect(queued.every((row) => row.purpose === 'closure' && row.notice === 'closing')).toBe(true);
    // Those who sign in in the ordinary way, the unverified among them to be counted as dropped.
    expect(queued.map((row) => row.principal_id).sort()).toEqual(
      [ada, grace, ivy, unverified].sort(),
    );
    const { claimed } = await claim();
    expect(
      (await deliveries()).find(
        (row) => row.principal_id === unverified && row.notice === 'closing',
      ),
    ).toMatchObject({ state: 'dropped', dropped_reason: 'unverified' });
    expect(claimed.map((mail) => mail.relay)).toEqual(
      Array.from({ length: 3 }, () => ({ kind: 'platform' })),
    );
    expect(claimed[0]!.closure).toMatchObject({ notice: 'closing' });
    expect(claimed[0]!.closure!.graceEndsAt).toBeInstanceOf(Date);

    // Neither the operator's relay carrying them nor its success stands for the environment's own.
    await as((trx) =>
      recordMailAttempt(trx, claimed[0]!.id, { kind: 'sent', latencyMs: 5 }, claimed[0]!.lease),
    );
    expect((await as((trx) => mailChannel(trx)))!.failingSince).not.toBeNull();

    // Cancelled while one still waits to say it is closing: that one is never sent.
    await byAda((trx) => cancelClosing(trx, tenant));
    const now = await deliveries();
    expect(now.filter((row) => row.dropped_reason === 'closure_cancelled')).toHaveLength(2);
    expect(now.filter((row) => row.notice === 'cancelled')).toHaveLength(4);
    const told = (await claim()).claimed;
    expect(told.map((mail) => [mail.closure?.notice, mail.relay.kind])).toEqual(
      Array.from({ length: 3 }, () => ['cancelled', 'platform']),
    );
  });

  it('ADM-055 tells each person once, 7 days before the grace ends', async () => {
    const grace = await person('grace');
    await byAda((trx) => startClosing(trx, tenant, { declined: true }));
    await as((trx) => queueClosureReminders(trx));
    expect((await deliveries()).filter((row) => row.notice === 'seven_days')).toEqual([]);
    await admin.query(
      `update platform.tenant set grace_ends_at = now() + interval '6 days' where id = $1`,
      [tenant.id],
    );
    await as((trx) => queueClosureReminders(trx));
    await as((trx) => queueClosureReminders(trx));
    const reminded = (await deliveries()).filter((row) => row.notice === 'seven_days');
    expect(reminded.map((row) => row.principal_id).sort()).toEqual([ada, grace].sort());
  });
});
