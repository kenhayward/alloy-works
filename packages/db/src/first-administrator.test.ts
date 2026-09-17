import { decide } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { administeredQuery, inviteFirstAdministrator } from './first-administrator.js';
import { administeringGrants, grant } from './grants.js';
import { addToGroup, createGroup } from './groups.js';
import { claimInvitation } from './invitations.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const ISSUER = 'https://idp.example';
const DAY = 24 * 60 * 60 * 1000;

describe('the first administrator, invited by address', () => {
  let db: TestDatabase;
  let service: TenantDatabase;

  const tenant = (name: string) =>
    createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name },
      hostnames: [`${name.toLowerCase()}.acme.alloy.test`],
    });

  const inviting = (on: Tenant, email: string) =>
    inviteFirstAdministrator(db.adminUrl, on, { email, namedBy: 'provisioning' });

  /**
   * A principal made directly, as a sign-in that claims nothing leaves one: `emailVerified` is written
   * exactly as given, never inferred from whether an address is present, so a sign-in an invitation
   * cannot claim (F8) is never mistaken for one that could.
   */
  const made = (
    trx: TenantTransaction,
    subject: string,
    email: string | null = null,
    emailVerified = email !== null,
  ) =>
    trx
      .insertInto('principal')
      .values({
        issuer: ISSUER,
        subject,
        email,
        email_verified: emailVerified,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** A sign-in as the service makes one: the known principal, or the invitation's, or a new one. */
  const signingIn = (on: Tenant, subject: string, email: string, emailVerified = true) =>
    service.withTenant(on, async (trx) => {
      const known = await trx
        .selectFrom('principal')
        .select('id')
        .where('issuer', '=', ISSUER)
        .where('subject', '=', subject)
        .executeTakeFirst();
      if (known) return known.id;
      const claimed = await claimInvitation(
        trx,
        { issuer: ISSUER, subject, email, emailVerified, name: subject },
        'organisation',
      );
      if (claimed) return claimed;
      return made(trx, subject, email, emailVerified);
    });

  const administers = (on: Tenant, principalId: string) =>
    service.withTenant(on, async (trx) => {
      const facts = await loadFacts(trx, principalId, { kind: 'tenant' });
      return decide('administer', facts!).allowed;
    });

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

  it('is Administrator at the tenant from the first sign-in the provider verifies the address for, and nobody else is', async () => {
    const production = await tenant('Production');
    await expect(inviting(production, 'Ada@Example.com')).resolves.toEqual({
      invited: true,
      renewed: false,
    });

    const unverified = await signingIn(production, 'ada-unverified', 'ada@example.com', false);
    await expect(administers(production, unverified)).resolves.toBe(false);
    const grace = await signingIn(production, 'grace', 'grace@example.com');
    await expect(administers(production, grace)).resolves.toBe(false);

    const ada = await signingIn(production, 'ada', 'ada@example.com');
    await expect(administers(production, ada)).resolves.toBe(true);
    const second = await signingIn(production, 'ada-2', 'ada@example.com');
    await expect(administers(production, second)).resolves.toBe(false);

    const record = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('invitation')
        .select(['email', 'principal_id', 'named_by', 'invited_by', 'accepted_through'])
        .execute(),
    );
    expect(record).toEqual([
      {
        email: 'ada@example.com',
        principal_id: ada,
        named_by: 'provisioning',
        invited_by: null,
        accepted_through: 'organisation',
      },
    ]);
  });

  it('is refused once somebody who has signed in administers, and while another address waits', async () => {
    const development = await tenant('Development');
    await expect(inviting(development, 'ada@example.com')).resolves.toMatchObject({
      invited: true,
    });
    await expect(inviting(development, 'grace@example.com')).resolves.toEqual({
      refused: 'first_administrator.already_invited',
    });
    await expect(inviting(development, 'ada@example.com')).resolves.toEqual({
      invited: true,
      renewed: true,
    });

    await signingIn(development, 'ada', 'ada@example.com');
    await expect(inviting(development, 'grace@example.com')).resolves.toEqual({
      refused: 'first_administrator.administrator_exists',
    });
  });

  it('replaces an invitation that lapsed for another address, and never lets the lapsed one be claimed', async () => {
    const sandbox = await tenant('Sandbox');
    await inviting(sandbox, 'ada@example.com');
    await service.withTenant(sandbox, (trx) =>
      trx
        .updateTable('invitation')
        .set({ expires_at: sql<Date>`now() - interval '1 second'` })
        .execute(),
    );
    await expect(inviting(sandbox, 'grace@example.com')).resolves.toMatchObject({ invited: true });

    const ada = await signingIn(sandbox, 'ada', 'ada@example.com');
    await expect(administers(sandbox, ada)).resolves.toBe(false);
    const grace = await signingIn(sandbox, 'grace', 'grace@example.com');
    await expect(administers(sandbox, grace)).resolves.toBe(true);
    const invited = await service.withTenant(sandbox, (trx) =>
      trx.selectFrom('invitation').select('email').execute(),
    );
    expect(invited).toEqual([{ email: 'grace@example.com' }]);
  });

  it('is refused for an address somebody who has signed in already shows, verified', async () => {
    const staging = await tenant('Staging');
    await service.withTenant(staging, (trx) => made(trx, 'ada', 'ADA@example.com'));
    await expect(inviting(staging, 'ada@example.com')).resolves.toEqual({
      refused: 'first_administrator.signed_in',
    });
  });

  it('agrees with administeringGrants on whether the tenant is administered, over the same grants', async () => {
    const agreement = await tenant('Agreement');
    const { administrator, reader } = await service.withTenant(agreement, async (trx) => ({
      administrator: (await findRole(trx, 'Administrator'))!,
      reader: (await findRole(trx, 'Reader'))!,
    }));
    const { ada, grace, alice, ivy, clinical, admins } = await service.withTenant(
      agreement,
      async (trx) => {
        const group = await createGroup(trx, 'Admins');
        if (!('group' in group)) throw new Error('the group was not made');
        return {
          ada: await made(trx, 'ada'),
          grace: await made(trx, 'grace'),
          alice: await made(trx, 'alice'),
          ivy: await made(trx, 'ivy'),
          clinical: (await createSpace(trx, 'Clinical')).id,
          admins: group.group.id,
        };
      },
    );

    const agree = () =>
      service.withTenant(agreement, async (trx) => {
        const raw = await sql<{
          administered: boolean;
        }>`${sql.raw(administeredQuery(''))}`.execute(trx);
        const counted = await administeringGrants(trx);
        return { administered: raw.rows[0]?.administered ?? false, counted: counted.length > 0 };
      });
    const give = (input: Parameters<typeof grant>[1]) =>
      service.withTenant(agreement, (trx) => grant(trx, input));

    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // A Reader at the tenant: permanent, direct, not external - but the role holds no administer.
    await give({
      roleId: reader.id,
      subject: { principal: ada },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: ada,
    });
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // An expiring administer allow.
    await give({
      roleId: administrator.id,
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'allow',
      expiresAt: new Date(Date.now() + DAY),
      grantedBy: grace,
    });
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // An administer allow, granted while a user, then made external.
    await give({
      roleId: administrator.id,
      subject: { principal: alice },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: alice,
    });
    await service.withTenant(agreement, (trx) =>
      trx.updateTable('principal').set({ kind: 'external' }).where('id', '=', alice).execute(),
    );
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // A space-level administer: not the tenant.
    await give({
      roleId: administrator.id,
      subject: { principal: ivy },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      grantedBy: ivy,
    });
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // A group-held administer: the group holds it, not a principal.
    await service.withTenant(agreement, (trx) => addToGroup(trx, admins, ada));
    await give({
      roleId: administrator.id,
      subject: { group: admins },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: ada,
    });
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // An address invited to administer, which nobody has signed in as.
    await inviting(agreement, 'eve@example.com');
    await expect(agree()).resolves.toEqual({ administered: false, counted: false });

    // A real one: direct, permanent, administer, at the tenant, to somebody signed in and not external.
    await give({
      roleId: administrator.id,
      subject: { principal: ada },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: ada,
    });
    await expect(agree()).resolves.toEqual({ administered: true, counted: true });
  });
});
