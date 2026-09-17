import { decide } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { grant, grantLevel, removeGrant, type NewGrant } from './grants.js';
import { addToGroup, createGroup } from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createRole, findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  untilWaitingOnLocks,
  type TestDatabase,
} from './testing/database.js';

const DAY = 24 * 60 * 60 * 1000;

function latch() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe('removing a grant, and the lock-out guard', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let organisation: { id: string; name: string };

  /** A tenant of its own for each case, so what one test removes never decides another. */
  const tenant = async (): Promise<Tenant> => {
    const id = db.newTenantId();
    return createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
  };

  const principal = (trx: TenantTransaction, subject: string, kind: 'user' | 'external' = 'user') =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: null, kind })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const give = async (
    where: Tenant,
    input: Omit<NewGrant, 'roleId' | 'grantedBy'> & { role: string; by: string },
  ) => {
    const answer = await service.withTenant(where, async (trx) => {
      const role = await findRole(trx, input.role);
      return grant(trx, {
        roleId: role!.id,
        subject: input.subject,
        level: input.level,
        effect: input.effect,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        grantedBy: input.by,
      });
    });
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

  const administrator = (where: Tenant, who: string) =>
    give(where, {
      role: 'Administrator',
      subject: { principal: who },
      level: { kind: 'tenant' },
      effect: 'allow',
      by: who,
    });

  const remove = (where: Tenant, id: string) =>
    service.withTenant(where, (trx) => removeGrant(trx, id));

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    organisation = { id: 'acme', name: 'Acme' };
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('removes a grant, answers what it was, and the next decision no longer reads it', async () => {
    const production = await tenant();
    const { ada, grace, clinical } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      grace: await principal(trx, 'grace'),
      clinical: (await createSpace(trx, 'Clinical')).id,
    }));
    const author = await give(production, {
      role: 'Author',
      subject: { principal: grace },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      by: ada,
    });

    await expect(remove(production, author.id)).resolves.toEqual({ removed: author });

    const facts = await service.withTenant(production, (trx) =>
      loadFacts(trx, grace, { kind: 'space', id: clinical }),
    );
    expect(decide('edit', facts!)).toMatchObject({ allowed: false, reason: 'not_granted' });
    await expect(remove(production, author.id)).resolves.toEqual({ refused: 'grant.missing' });
  });

  it("answers the level a grant was made at, and nothing for another environment's grant", async () => {
    const production = await tenant();
    const development = await tenant();
    const made = async (where: Tenant) => {
      const { ada, clinical } = await service.withTenant(where, async (trx) => ({
        ada: await principal(trx, 'ada'),
        clinical: (await createSpace(trx, 'Clinical')).id,
      }));
      const reader = await give(where, {
        role: 'Reader',
        subject: { principal: ada },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        by: ada,
      });
      return { reader, clinical };
    };
    const ours = await made(production);
    const theirs = await made(development);

    await expect(
      service.withTenant(production, (trx) => grantLevel(trx, ours.reader.id)),
    ).resolves.toEqual({ kind: 'space', id: ours.clinical });
    await expect(
      service.withTenant(production, (trx) => grantLevel(trx, theirs.reader.id)),
    ).resolves.toBeUndefined();
    await expect(remove(production, theirs.reader.id)).resolves.toEqual({
      refused: 'grant.missing',
    });
    await expect(
      service.withTenant(development, (trx) =>
        trx.selectFrom('access_grant').select('id').where('id', '=', theirs.reader.id).execute(),
      ),
    ).resolves.toHaveLength(1);
  });

  it('refuses to remove the last direct, permanent grant of administer at the tenant, and allows it once somebody else holds one', async () => {
    const production = await tenant();
    const { ada, grace } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      grace: await principal(trx, 'grace'),
    }));
    const adas = await administrator(production, ada);

    await expect(remove(production, adas.id)).resolves.toEqual({
      refused: 'grant.last_administrator',
    });

    await administrator(production, grace);
    await expect(remove(production, adas.id)).resolves.toEqual({ removed: adas });
  });

  it('counts a role holding administer by what it holds, not by its name', async () => {
    const production = await tenant();
    const ada = await service.withTenant(production, (trx) => principal(trx, 'ada'));
    await service.withTenant(production, (trx) =>
      createRole(trx, 'Steward', ['read', 'administer', 'manage_definitions']),
    );
    const steward = await give(production, {
      role: 'Steward',
      subject: { principal: ada },
      level: { kind: 'tenant' },
      effect: 'allow',
      by: ada,
    });

    await expect(remove(production, steward.id)).resolves.toEqual({
      refused: 'grant.last_administrator',
    });
  });

  it('never counts a tenant-level allow whose role does not hold administer', async () => {
    const production = await tenant();
    const { ada, grace } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      grace: await principal(trx, 'grace'),
    }));
    const adas = await administrator(production, ada);
    // Grace holds Reader at the tenant - a permanent, direct, non-external allow, exactly the shape
    // an administering grant has, except for what the role permits.
    await give(production, {
      role: 'Reader',
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'allow',
      by: ada,
    });

    await expect(remove(production, adas.id)).resolves.toEqual({
      refused: 'grant.last_administrator',
    });
  });

  it('never counts a tenant-level deny of an administer role, inserted directly', async () => {
    const production = await tenant();
    const { ada, grace } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      grace: await principal(trx, 'grace'),
    }));
    const adas = await administrator(production, ada);
    // Made directly, not through `grant()`, which refuses a deny of administer at the tenant outright
    // (grant.administer_denied_at_tenant) - so this shape can only arise from something other than the
    // guarded path, and the count must still not mistake it for an administering allow.
    const administratorRole = await service.withTenant(production, (trx) =>
      findRole(trx, 'Administrator'),
    );
    await service.withTenant(production, (trx) =>
      trx
        .insertInto('access_grant')
        .values({
          role_id: administratorRole!.id,
          principal_id: grace,
          level: 'tenant',
          effect: 'deny',
          granted_by: ada,
        })
        .execute(),
    );

    await expect(remove(production, adas.id)).resolves.toEqual({
      refused: 'grant.last_administrator',
    });
  });

  it('keeps the tenant administered only through a direct grant with no expiry to somebody not external', async () => {
    const production = await tenant();
    const { ada, grace, alice, admins } = await service.withTenant(production, async (trx) => {
      const group = await createGroup(trx, 'Admins');
      if (!('group' in group)) throw new Error('the group was not made');
      return {
        ada: await principal(trx, 'ada'),
        grace: await principal(trx, 'grace'),
        alice: await principal(trx, 'alice'),
        admins: group.group.id,
      };
    });
    const adas = await administrator(production, ada);
    // Grace administers until next week, Alice through a group, and a third principal, made external
    // after being granted, holds a direct permanent grant the cap refuses: none of them counts.
    await give(production, {
      role: 'Administrator',
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'allow',
      expiresAt: new Date(Date.now() + 7 * DAY),
      by: ada,
    });
    await service.withTenant(production, (trx) => addToGroup(trx, admins, alice));
    await give(production, {
      role: 'Administrator',
      subject: { group: admins },
      level: { kind: 'tenant' },
      effect: 'allow',
      by: ada,
    });
    const outsider = await service.withTenant(production, (trx) => principal(trx, 'ivy'));
    await administrator(production, outsider);
    await service.withTenant(production, (trx) =>
      trx.updateTable('principal').set({ kind: 'external' }).where('id', '=', outsider).execute(),
    );

    await expect(remove(production, adas.id)).resolves.toEqual({
      refused: 'grant.last_administrator',
    });
  });

  it('never refuses a removal that leaves the count where it was, even where nobody administers', async () => {
    const production = await tenant();
    const { ada, clinical } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      clinical: (await createSpace(trx, 'Clinical')).id,
    }));
    const expiring = await give(production, {
      role: 'Administrator',
      subject: { principal: ada },
      level: { kind: 'tenant' },
      effect: 'allow',
      expiresAt: new Date(Date.now() + DAY),
      by: ada,
    });
    const spaceAdministrator = await give(production, {
      role: 'Administrator',
      subject: { principal: ada },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      by: ada,
    });

    await expect(remove(production, spaceAdministrator.id)).resolves.toEqual({
      removed: spaceAdministrator,
    });
    await expect(remove(production, expiring.id)).resolves.toEqual({ removed: expiring });
  });

  it('refuses one of two removals made at once that would together leave nobody administering', async () => {
    const production = await tenant();
    const { ada, grace } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      grace: await principal(trx, 'grace'),
    }));
    const adas = await administrator(production, ada);
    const graces = await administrator(production, grace);

    const removed = latch();
    const commit = latch();
    const first = service.withTenant(production, async (trx) => {
      const answer = await removeGrant(trx, adas.id);
      removed.open();
      await commit.opened;
      return answer;
    });
    await removed.opened;
    const second = remove(production, graces.id);
    try {
      // The second has reached a lock the first holds - whichever it is - before the first commits, so
      // it cannot have counted after the first's removal unless the guard waited for it.
      await untilWaitingOnLocks(db.adminUrl, 1);
    } finally {
      // Even if the wait above throws - the second never reached a lock - the first is still holding
      // the epoch waiting on this latch, so it is opened regardless or the first hangs until its own
      // test timeout instead of failing where the real problem is.
      commit.open();
    }

    await expect(first).resolves.toEqual({ removed: adas });
    await expect(second).resolves.toEqual({ refused: 'grant.last_administrator' });
  });
});
