import { decide } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { grant, removeGrant } from './grants.js';
import {
  claimInvitation,
  invite,
  listInvitations,
  readInvitation,
  withdrawInvitation,
  type ClaimingIdentity,
} from './invitations.js';
import { listPrincipals } from './access-listings.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  untilBlockedBy,
  untilWaitingOnLocks,
  whileAccessIsDecided,
  type TestDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';

const identity = (subject: string, email: string, extra: Partial<ClaimingIdentity> = {}) => ({
  issuer: ISSUER,
  subject,
  email,
  emailVerified: true,
  name: subject,
  ...extra,
});

function latch() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** Like `latch`, but the opener carries a value out - here, a transaction's own backend pid. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('inviting somebody by address, before they sign in', () => {
  let db: TestDatabase;
  let service: TenantDatabase;

  const tenant = async (): Promise<Tenant> => {
    const id = db.newTenantId();
    return createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
  };

  const signedIn = (
    trx: TenantTransaction,
    subject: string,
    email: string | null = null,
    emailVerified = true,
  ) =>
    trx
      .insertInto('principal')
      .values({
        issuer: ISSUER,
        subject,
        email,
        email_verified: emailVerified,
        display_name: subject,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** Ada, who administers, as whoever invites. */
  const withAda = async (where: Tenant) =>
    service.withTenant(where, async (trx) => {
      const ada = await signedIn(trx, 'ada', 'ada@example.com');
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      return ada;
    });

  const inviting = async (where: Tenant, by: string, email: string, external = false) => {
    const answer = await service.withTenant(where, (trx) =>
      invite(trx, { email, external, invitedBy: by }),
    );
    if (!('invited' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.invited;
  };

  const granting = (where: Tenant, role: string, principal: string, by: string) =>
    service.withTenant(where, async (trx) => {
      const found = await findRole(trx, role);
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return grant(trx, {
        roleId: found!.id,
        subject: { principal },
        level: { kind: 'space', id: general.id },
        effect: 'allow',
        grantedBy: by,
      });
    });

  const may = (where: Tenant, principal: string, permission: 'read' | 'edit') =>
    service.withTenant(where, async (trx) => {
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const facts = await loadFacts(trx, principal, { kind: 'space', id: general.id });
      return decide(permission, facts!).allowed;
    });

  const claiming = (
    where: Tenant,
    who: ClaimingIdentity,
    route: 'organisation' | 'google' = 'organisation',
  ) => service.withTenant(where, (trx) => claimInvitation(trx, who, route));

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('makes a principal holding nothing that a grant can name, and the first verified sign-in becomes it', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const invited = await inviting(production, ada, ' Grace@Example.com ');
    expect(invited).toMatchObject({
      email: 'grace@example.com',
      kind: 'user',
      invitedBy: { id: ada, name: 'ada' },
      namedBy: null,
      acceptedAt: null,
      acceptedThrough: null,
    });
    const days = (invited.expiresAt!.getTime() - invited.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(14);

    const listed = await service.withTenant(production, (trx) =>
      listPrincipals(trx, { limit: 100 }),
    );
    expect(listed.items).toContainEqual({
      id: invited.principalId,
      name: null,
      email: 'grace@example.com',
      kind: 'user',
      invited: true,
    });

    expect(await granting(production, 'Author', invited.principalId, ada)).toHaveProperty(
      'granted',
    );
    await expect(may(production, invited.principalId, 'edit')).resolves.toBe(true);

    await expect(
      claiming(production, identity('grace-1', 'grace@example.com'), 'google'),
    ).resolves.toBe(invited.principalId);
    const bound = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('principal')
        .select(['issuer', 'subject', 'email', 'display_name'])
        .where('id', '=', invited.principalId)
        .executeTakeFirstOrThrow(),
    );
    expect(bound).toEqual({
      issuer: ISSUER,
      subject: 'grace-1',
      email: 'grace@example.com',
      display_name: 'grace-1',
    });
    const page = await service.withTenant(production, (trx) =>
      listInvitations(trx, { limit: 100 }),
    );
    expect(page.items).toEqual([
      expect.objectContaining({
        id: invited.id,
        acceptedThrough: 'google',
        acceptedAt: expect.any(Date),
      }),
    ]);
    await expect(may(production, invited.principalId, 'edit')).resolves.toBe(true);
  });

  it('is claimed once, never for an unverified or lapsed address, and never by a second account', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    const alice = await inviting(production, ada, 'alice@example.com');
    await service.withTenant(production, (trx) =>
      trx
        .updateTable('invitation')
        .set({ expires_at: sql<Date>`now() - interval '1 second'` })
        .where('id', '=', alice.id)
        .execute(),
    );

    await expect(
      claiming(production, identity('grace-1', 'grace@example.com', { emailVerified: false })),
    ).resolves.toBeUndefined();
    await expect(
      claiming(production, identity('alice-1', 'alice@example.com')),
    ).resolves.toBeUndefined();
    await expect(claiming(production, identity('grace-1', 'GRACE@example.com'))).resolves.toBe(
      grace.principalId,
    );
    await expect(
      claiming(production, identity('grace-2', 'grace@example.com')),
    ).resolves.toBeUndefined();
  });

  it('claims nothing where the invitation already points at a principal holding an identity', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    // No code path leaves an open invitation pointing at a principal who already has an identity;
    // simulated directly, since only the check under test stands between this state and a claim
    // silently taking over an account that is not theirs.
    await service.withTenant(production, (trx) =>
      trx
        .updateTable('principal')
        .set({ issuer: ISSUER, subject: 'grace-already', email_verified: true })
        .where('id', '=', grace.principalId)
        .execute(),
    );

    await expect(
      claiming(production, identity('grace-1', 'grace@example.com')),
    ).resolves.toBeUndefined();
    const invitation = await service.withTenant(production, (trx) => readInvitation(trx, grace.id));
    expect(invitation?.acceptedAt).toBeNull();
  });

  it('claims nothing in another environment, and withdraws nothing there', async () => {
    const production = await tenant();
    const development = await tenant();
    const ada = await withAda(production);
    const theirs = await inviting(development, await withAda(development), 'grace@example.com');
    await inviting(production, ada, 'grace@example.com');

    await expect(
      service.withTenant(production, (trx) => withdrawInvitation(trx, theirs.id)),
    ).resolves.toEqual({ refused: 'invitation.missing' });
    const theirsFromProduction = await service.withTenant(production, (trx) =>
      readInvitation(trx, theirs.id),
    );
    expect(theirsFromProduction).toBeUndefined();
    const productionList = await service.withTenant(production, (trx) =>
      listInvitations(trx, { limit: 100 }),
    );
    expect(productionList.items.map((item) => item.id)).not.toContain(theirs.id);

    await claiming(production, identity('grace-1', 'grace@example.com'));
    const waiting = await service.withTenant(development, (trx) =>
      trx
        .selectFrom('invitation')
        .select('accepted_at')
        .where('id', '=', theirs.id)
        .executeTakeFirst(),
    );
    expect(waiting).toEqual({ accepted_at: null });
  });

  it('renews a waiting invitation, keeping its grants, and refuses an address somebody signed in shows', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const first = await inviting(production, ada, 'grace@example.com');
    await granting(production, 'Reader', first.principalId, ada);
    await service.withTenant(production, (trx) =>
      trx
        .updateTable('invitation')
        .set({ expires_at: sql<Date>`now() - interval '1 day'` })
        .where('id', '=', first.id)
        .execute(),
    );

    const again = await service.withTenant(production, (trx) =>
      invite(trx, { email: 'grace@example.com', external: false, invitedBy: ada }),
    );
    expect(again).toMatchObject({
      renewed: true,
      invited: { id: first.id, principalId: first.principalId },
    });
    expect(('invited' in again && again.invited.expiresAt!.getTime()) || 0).toBeGreaterThan(
      Date.now(),
    );
    await expect(may(production, first.principalId, 'read')).resolves.toBe(true);

    await expect(
      service.withTenant(production, (trx) =>
        invite(trx, { email: 'grace@example.com', external: true, invitedBy: ada }),
      ),
    ).resolves.toEqual({ refused: 'invitation.kind_differs' });
    await expect(
      service.withTenant(production, (trx) =>
        invite(trx, { email: 'ADA@example.com', external: false, invitedBy: ada }),
      ),
    ).resolves.toEqual({ refused: 'invitation.signed_in' });
    // An account showing an address its provider never verified stops nobody being invited to it.
    await service.withTenant(production, (trx) =>
      signedIn(trx, 'mallory', 'alice@example.com', false),
    );
    await expect(
      service.withTenant(production, (trx) =>
        invite(trx, { email: 'alice@example.com', external: false, invitedBy: ada }),
      ),
    ).resolves.toMatchObject({ renewed: false });
  });

  it('takes turns on one address, so a second invite renews what the first made rather than duplicating it', async () => {
    const production = await tenant();
    const ada = await withAda(production);

    const holding = latch();
    const proceed = latch();
    const first = service.withTenant(production, async (trx) => {
      const answer = await invite(trx, {
        email: 'grace@example.com',
        external: false,
        invitedBy: ada,
      });
      holding.open();
      await proceed.opened;
      return answer;
    });
    await holding.opened;
    // Blocked on the address's advisory lock, which the first transaction still holds.
    const second = service.withTenant(production, (trx) =>
      invite(trx, { email: 'grace@example.com', external: false, invitedBy: ada }),
    );
    await untilWaitingOnLocks(db.adminUrl, 1);
    proceed.open();

    await expect(first).resolves.toMatchObject({ renewed: false });
    await expect(second).resolves.toMatchObject({ renewed: true });
  });

  it('refuses to invite an address a claim, committing while it waited, has just made somebody sign in with', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');

    const claimedLock = latch();
    const commit = latch();
    const claim = service.withTenant(production, async (trx) => {
      const answer = await claimInvitation(
        trx,
        identity('grace-1', 'grace@example.com'),
        'organisation',
      );
      claimedLock.open();
      await commit.opened;
      return answer;
    });
    await claimedLock.opened;
    // Blocked on the invitation's row, which the claim still holds FOR UPDATE, uncommitted - so the
    // signed-in check above already ran and found nobody, before the claim's identity existed.
    const invitingAgain = service.withTenant(production, (trx) =>
      invite(trx, { email: 'grace@example.com', external: false, invitedBy: ada }),
    );
    await untilWaitingOnLocks(db.adminUrl, 1);
    commit.open();

    await expect(claim).resolves.toBe(grace.principalId);
    await expect(invitingAgain).resolves.toEqual({ refused: 'invitation.signed_in' });
  });

  it('refuses to invite an address a new sign-in, still uncommitted, is making somebody sign in with', async () => {
    const production = await tenant();
    const ada = await withAda(production);

    // A sign-in as the routes make one, for an address nothing invited: the claim finds nothing, and
    // the same transaction then makes the new principal, verified - and holds it there, uncommitted.
    const signInPid = deferred<number>();
    const madeIt = latch();
    const commit = latch();
    const signingIn = service.withTenant(production, async (trx) => {
      const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
      signInPid.resolve(rows[0]!.pid);
      const claimed = await claimInvitation(
        trx,
        identity('grace-1', 'grace@example.com'),
        'organisation',
      );
      const principal = await signedIn(trx, 'grace-1', 'grace@example.com');
      madeIt.open();
      await commit.opened;
      return { claimed, principal };
    });
    const pid = await signInPid.promise;
    await madeIt.opened;

    const invitingMeanwhile = service.withTenant(production, (trx) =>
      invite(trx, { email: 'Grace@example.com', external: false, invitedBy: ada }),
    );
    // Either the invite waits behind the sign-in, or - with nothing to wait on - it has already
    // answered; both are let through, so the answer below is what tells them apart.
    await Promise.race([
      invitingMeanwhile,
      untilBlockedBy(db.adminUrl, pid, 1).catch(() => undefined),
    ]);
    commit.open();

    await expect(signingIn).resolves.toMatchObject({ claimed: undefined });
    await expect(invitingMeanwhile).resolves.toEqual({ refused: 'invitation.signed_in' });
    const waiting = await service.withTenant(production, (trx) =>
      trx.selectFrom('invitation').select('id').execute(),
    );
    expect(waiting).toEqual([]);
  });

  it('withdraws a waiting invitation with its principal and grants, and refuses one accepted', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    const alice = await inviting(production, ada, 'alice@example.com');
    await granting(production, 'Author', grace.principalId, ada);
    await granting(production, 'Author', alice.principalId, ada);
    await claiming(production, identity('alice-1', 'alice@example.com'));

    await expect(
      service.withTenant(production, (trx) => withdrawInvitation(trx, grace.id)),
    ).resolves.toEqual({ withdrawn: grace.id });
    const left = await service.withTenant(production, async (trx) => ({
      principal: await trx
        .selectFrom('principal')
        .select('id')
        .where('id', '=', grace.principalId)
        .execute(),
      grants: await trx
        .selectFrom('access_grant')
        .select('id')
        .where('principal_id', '=', grace.principalId)
        .execute(),
    }));
    expect(left).toEqual({ principal: [], grants: [] });
    await expect(
      service.withTenant(production, (trx) => withdrawInvitation(trx, grace.id)),
    ).resolves.toEqual({ refused: 'invitation.missing' });
    await expect(
      service.withTenant(production, (trx) => withdrawInvitation(trx, alice.id)),
    ).resolves.toEqual({ refused: 'invitation.accepted' });
  });

  it('never counts somebody invited who has not signed in as keeping the environment administered', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    const adas = await service.withTenant(production, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: grace.principalId },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      return trx
        .selectFrom('access_grant')
        .select('id')
        .where('principal_id', '=', ada)
        .executeTakeFirstOrThrow();
    });

    await expect(
      service.withTenant(production, (trx) => removeGrant(trx, adas.id)),
    ).resolves.toEqual({
      refused: 'grant.last_administrator',
    });
    await claiming(production, identity('grace-1', 'grace@example.com'));
    await expect(
      service.withTenant(production, (trx) => removeGrant(trx, adas.id)),
    ).resolves.toHaveProperty('removed');
  });

  it('holds somebody invited from outside the organisation to the external rules from the first grant', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const ivy = await inviting(production, ada, 'ivy@example.net', true);
    expect(ivy.kind).toBe('external');
    const reader = await granting(production, 'Reader', ivy.principalId, ada);
    expect(reader).toMatchObject({ granted: { expiresAt: expect.any(Date) } });
    await expect(granting(production, 'Author', ivy.principalId, ada)).resolves.toEqual({
      refused: 'grant.external_capped',
    });
  });

  it('claims while a decision is in flight, without waiting for it, and a withdrawal waiting behind it then finds the invitation accepted', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    await granting(production, 'Author', grace.principalId, ada);

    // Wrapped, so the decision's transaction does not wait for the withdrawal it is holding up.
    const { withdrawal } = await whileAccessIsDecided(service, production, async () => {
      const waiting = service.withTenant(production, (trx) => withdrawInvitation(trx, grace.id));
      await untilWaitingOnLocks(db.adminUrl, 1);
      // The withdrawal waits on the epoch; the claim needs neither, so it lands now.
      await expect(claiming(production, identity('grace-1', 'grace@example.com'))).resolves.toBe(
        grace.principalId,
      );
      return { withdrawal: waiting };
    });

    await expect(withdrawal).resolves.toEqual({ refused: 'invitation.accepted' });
    await expect(may(production, grace.principalId, 'edit')).resolves.toBe(true);
  });

  it('finds nothing to claim once a withdrawal holding the invitation commits, rather than deadlocking', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');
    await granting(production, 'Author', grace.principalId, ada);

    const locked = latch();
    const commit = latch();
    const withdrawal = service.withTenant(production, async (trx) => {
      const answer = await withdrawInvitation(trx, grace.id);
      locked.open();
      await commit.opened;
      return answer;
    });
    await locked.opened;
    const claim = claiming(production, identity('grace-1', 'grace@example.com'));
    await untilWaitingOnLocks(db.adminUrl, 1);
    commit.open();

    await expect(withdrawal).resolves.toEqual({ withdrawn: grace.id });
    await expect(claim).resolves.toBeUndefined();
  });

  it('lands a grant to somebody invited and their claim together, while a decision is in flight', async () => {
    const production = await tenant();
    const ada = await withAda(production);
    const grace = await inviting(production, ada, 'grace@example.com');

    const claimedPid = deferred<number>();
    const claimed = latch();
    const commit = latch();
    const claim = service.withTenant(production, async (trx) => {
      const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(trx);
      claimedPid.resolve(rows[0]!.pid);
      const answer = await claimInvitation(
        trx,
        identity('grace-1', 'grace@example.com'),
        'organisation',
      );
      claimed.open();
      await commit.opened;
      return answer;
    });
    const pid = await claimedPid.promise;
    await claimed.opened;
    const { granted } = await whileAccessIsDecided(service, production, async () => {
      // The grant waits on the epoch behind the decision.
      const waiting = granting(production, 'Author', grace.principalId, ada);
      await untilWaitingOnLocks(db.adminUrl, 1);
      return { granted: waiting };
    });
    // Then, holding the epoch, specifically behind the claim's lock of Grace's row - not the epoch,
    // which the claim never takes.
    await untilBlockedBy(db.adminUrl, pid, 1);
    commit.open();

    await expect(claim).resolves.toBe(grace.principalId);
    await expect(granted).resolves.toHaveProperty('granted');
    await expect(may(production, grace.principalId, 'edit')).resolves.toBe(true);
  });
});
