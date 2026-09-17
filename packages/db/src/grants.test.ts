import { decide } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { accessPolicy, grant, type NewGrant } from './grants.js';
import { addToGroup, createGroup } from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const DAY = 24 * 60 * 60 * 1000;

describe('making a grant', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let alice: string;
  let spaceId: string;
  let artifactId: string;
  const roles: Record<string, string> = {};
  let theirs: {
    role: string;
    principal: string;
    space: string;
    artifact: string;
    group: string;
  };

  const principal = (trx: TenantTransaction, subject: string, kind: 'user' | 'external') =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: null, kind })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const make = (input: Omit<NewGrant, 'grantedBy'>) =>
    service.withTenant(production, (trx) => grant(trx, { ...input, grantedBy: ada }));

  const now = () =>
    service.withTenant(production, (trx) =>
      trx
        .selectNoFrom((eb) => eb.fn<Date>('now').as('now'))
        .executeTakeFirstOrThrow()
        .then((row) => row.now),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await principal(trx, 'ada', 'user');
      alice = await principal(trx, 'alice', 'external');
      spaceId = (await createSpace(trx, 'Clinical')).id;
      artifactId = (
        await trx
          .insertInto('artifact')
          .values({ kind: 'component', space_id: spaceId })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      for (const name of ['Reader', 'Reviewer', 'Author', 'Administrator', 'Editing']) {
        roles[name] = (await findRole(trx, name))!.id;
      }
    });
    theirs = await service.withTenant(development, async (trx) => {
      const role = await findRole(trx, 'Reader');
      const space = await createSpace(trx, 'Theirs');
      const artifact = await trx
        .insertInto('artifact')
        .values({ kind: 'component', space_id: space.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      const grace = await principal(trx, 'grace', 'user');
      const group = await createGroup(trx, 'Theirs');
      if (!('group' in group)) throw new Error('the group was not made');
      return {
        role: role!.id,
        space: space.id,
        artifact: artifact.id,
        principal: grace,
        group: group.group.id,
      };
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('IAM-022 assigns a role to a group as well as to an individual', async () => {
    const editors = await service.withTenant(production, (trx) => createGroup(trx, 'Editors'));
    if (!('group' in editors)) throw new Error('the group was not made');

    const toAda = await make({
      roleId: roles.Author!,
      subject: { principal: ada },
      level: { kind: 'space', id: spaceId },
      effect: 'allow',
    });
    const toEditors = await make({
      roleId: roles.Author!,
      subject: { group: editors.group.id },
      level: { kind: 'space', id: spaceId },
      effect: 'allow',
    });
    expect(toAda).toMatchObject({
      granted: {
        roleId: roles.Author,
        subject: { principal: ada },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
        expiresAt: null,
        grantedBy: ada,
      },
    });
    expect(toEditors).toMatchObject({ granted: { subject: { group: editors.group.id } } });
  });

  it('makes the same grant once, and refuses a second', async () => {
    const input = {
      roleId: roles.Reader!,
      subject: { principal: ada },
      level: { kind: 'artifact', id: artifactId },
      effect: 'deny',
    } as const;
    await expect(make(input)).resolves.toHaveProperty('granted');
    await expect(make(input)).resolves.toEqual({ refused: 'grant.duplicate' });
    await expect(make({ ...input, effect: 'allow' })).resolves.toHaveProperty('granted');
  });

  it('allows only a role that holds read, and denies a role that does not', async () => {
    const editing = {
      roleId: roles.Editing!,
      subject: { principal: ada },
      level: { kind: 'artifact', id: artifactId },
    } as const;
    await expect(make({ ...editing, effect: 'allow' })).resolves.toEqual({
      refused: 'grant.allow_without_read',
    });
    await expect(make({ ...editing, effect: 'deny' })).resolves.toHaveProperty(
      'granted.effect',
      'deny',
    );
  });

  it('refuses to deny administer at the tenant, which would leave nobody able to undo it', async () => {
    await expect(
      make({
        roleId: roles.Administrator!,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'deny',
      }),
    ).resolves.toEqual({ refused: 'grant.administer_denied_at_tenant' });
    await expect(
      make({
        roleId: roles.Administrator!,
        subject: { principal: ada },
        level: { kind: 'space', id: spaceId },
        effect: 'deny',
      }),
    ).resolves.toHaveProperty('granted');
  });

  it('IAM-049 gives external access an expiry the tenant defaults and caps, and never none', async () => {
    const started = await now();
    const defaulted = await make({
      roleId: roles.Reader!,
      subject: { principal: alice },
      level: { kind: 'space', id: spaceId },
      effect: 'allow',
    });
    if (!('granted' in defaulted)) throw new Error(`refused: ${defaulted.refused}`);
    const expiry = defaulted.granted.expiresAt!.getTime();
    expect(expiry - started.getTime()).toBeGreaterThanOrEqual(30 * DAY);
    expect(expiry - started.getTime()).toBeLessThan(30 * DAY + 60_000);

    await expect(
      make({
        roleId: roles.Reviewer!,
        subject: { principal: alice },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
        expiresAt: new Date(started.getTime() + 91 * DAY),
      }),
    ).resolves.toEqual({ refused: 'grant.external_past_cap' });
    await expect(
      make({
        roleId: roles.Reviewer!,
        subject: { principal: alice },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
        expiresAt: new Date(started.getTime() + 89 * DAY),
      }),
    ).resolves.toHaveProperty('granted.expiresAt', new Date(started.getTime() + 89 * DAY));
  });

  it('IAM-071 grants external access against a named space or artifact, never at the tenant', async () => {
    const at = (level: NewGrant['level']) =>
      make({
        roleId: roles.Reader!,
        subject: { principal: alice },
        level,
        effect: 'allow',
        expiresAt: new Date(Date.now() + DAY),
      });
    await expect(at({ kind: 'tenant' })).resolves.toEqual({ refused: 'grant.external_at_tenant' });
    await expect(at({ kind: 'artifact', id: artifactId })).resolves.toHaveProperty('granted');
  });

  it('accepts a denial of Reader at the tenant to an external principal, which the allow-only refusals leave alone', async () => {
    const denied = await make({
      roleId: roles.Reader!,
      subject: { principal: alice },
      level: { kind: 'tenant' },
      effect: 'deny',
    });
    expect(denied).toHaveProperty('granted');

    const facts = await service.withTenant(production, (trx) =>
      loadFacts(trx, alice, { kind: 'tenant' }),
    );
    expect(decide('read', facts!).allowed).toBe(false);
  });

  it('stores a no-expiry denial to an external principal with a null expiry, not the tenant default, so it still denies past the default period', async () => {
    // A fresh artifact, so no grant an earlier test made against `artifactId` decides here instead.
    const target = await service.withTenant(production, (trx) =>
      trx
        .insertInto('artifact')
        .values({ kind: 'component', space_id: spaceId })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    const denied = await make({
      roleId: roles.Reader!,
      subject: { principal: alice },
      level: { kind: 'artifact', id: target },
      effect: 'deny',
    });
    if (!('granted' in denied)) throw new Error(`refused: ${denied.refused}`);
    expect(denied.granted.expiresAt).toBeNull();

    const policy = await service.withTenant(production, accessPolicy);
    const facts = await service.withTenant(production, (trx) =>
      loadFacts(trx, alice, { kind: 'artifact', id: target }),
    );
    const pastTheDefault = {
      ...facts!,
      now: new Date(policy.now.getTime() + (policy.externalDefaultDays + 1) * DAY),
    };
    expect(decide('read', pastTheDefault).allowed).toBe(false);
  });

  it('refuses to give an external principal a capped permission, but lets a denial of one stand', async () => {
    const author = {
      roleId: roles.Author!,
      subject: { principal: alice },
      level: { kind: 'artifact', id: artifactId },
      expiresAt: new Date(Date.now() + DAY),
    } as const;
    await expect(make({ ...author, effect: 'allow' })).resolves.toEqual({
      refused: 'grant.external_capped',
    });
    await expect(make({ ...author, effect: 'deny' })).resolves.toHaveProperty('granted');
  });

  it('applies the same rules to a group with an external member, and to adding one to a group', async () => {
    const partners = await service.withTenant(production, (trx) => createGroup(trx, 'Partners'));
    const staff = await service.withTenant(production, (trx) => createGroup(trx, 'Staff'));
    if (!('group' in partners) || !('group' in staff)) throw new Error('the groups were not made');

    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, partners.group.id, alice)),
    ).resolves.toEqual({ added: true });
    const toPartners = (input: Partial<Omit<NewGrant, 'grantedBy'>>) =>
      make({
        roleId: roles.Reader!,
        subject: { group: partners.group.id },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
        ...input,
      });
    await expect(toPartners({ level: { kind: 'tenant' } })).resolves.toEqual({
      refused: 'grant.external_at_tenant',
    });
    await expect(toPartners({ roleId: roles.Author! })).resolves.toEqual({
      refused: 'grant.external_capped',
    });
    await expect(toPartners({ expiresAt: new Date(Date.now() + 120 * DAY) })).resolves.toEqual({
      refused: 'grant.external_past_cap',
    });
    // No expiry is not defaulted for a group: the members inside keep it, and for the external member
    // the decision ignores it.
    await expect(toPartners({})).resolves.toHaveProperty('granted.expiresAt', null);

    await make({
      roleId: roles.Author!,
      subject: { group: staff.group.id },
      level: { kind: 'space', id: spaceId },
      effect: 'allow',
    });
    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, staff.group.id, alice)),
    ).resolves.toEqual({ refused: 'grant.external_capped' });
    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, staff.group.id, ada)),
    ).resolves.toEqual({ added: true });
  });

  it('lets an external principal join a group that holds a tenant-level denial', async () => {
    const wardens = await service.withTenant(production, (trx) => createGroup(trx, 'Wardens'));
    if (!('group' in wardens)) throw new Error('the group was not made');
    await expect(
      make({
        roleId: roles.Reader!,
        subject: { group: wardens.group.id },
        level: { kind: 'tenant' },
        effect: 'deny',
      }),
    ).resolves.toHaveProperty('granted');

    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, wardens.group.id, alice)),
    ).resolves.toEqual({ added: true });
  });

  it('locks the epoch before either reads, so a grant and a membership change take turns', async () => {
    const group = await service.withTenant(production, (trx) => createGroup(trx, 'Race A'));
    if (!('group' in group)) throw new Error('the group was not made');
    const groupId = group.group.id;

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));

    const first = service.withTenant(production, async (trx) => {
      const answer = await grant(trx, {
        roleId: roles.Reader!,
        subject: { group: groupId },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
        expiresAt: new Date(Date.now() + 120 * DAY),
        grantedBy: ada,
      });
      await held;
      return answer;
    });
    // Give the grant time to take the epoch's lock, then start the membership change behind it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = service.withTenant(production, (trx) => addToGroup(trx, groupId, alice));
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();

    const [granted, membership] = await Promise.all([first, second]);
    expect(granted).toHaveProperty('granted');
    expect(membership).toEqual({ refused: 'grant.external_past_cap' });

    const members = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('group_member')
        .select('principal_id')
        .where('group_id', '=', groupId)
        .execute(),
    );
    expect(members).toEqual([]);
  });

  it('takes the other order too: a membership change first, then a grant that would exceed the cap', async () => {
    const group = await service.withTenant(production, (trx) => createGroup(trx, 'Race B'));
    if (!('group' in group)) throw new Error('the group was not made');
    const groupId = group.group.id;

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));

    const first = service.withTenant(production, async (trx) => {
      const answer = await addToGroup(trx, groupId, alice);
      await held;
      return answer;
    });
    // Give the membership change time to take the epoch's lock, then start the grant behind it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = service.withTenant(production, (trx) =>
      grant(trx, {
        roleId: roles.Reader!,
        subject: { group: groupId },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
        expiresAt: new Date(Date.now() + 120 * DAY),
        grantedBy: ada,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();

    const [membership, granted] = await Promise.all([first, second]);
    expect(membership).toEqual({ added: true });
    expect(granted).toEqual({ refused: 'grant.external_past_cap' });

    const stored = await service.withTenant(production, (trx) =>
      trx.selectFrom('access_grant').select('id').where('group_id', '=', groupId).execute(),
    );
    expect(stored).toEqual([]);
  });

  it('answers a role, principal or group from another tenant as missing, refuses a space or artifact from one, and stores nothing', async () => {
    const count = () =>
      service.withTenant(production, (trx) =>
        trx
          .selectFrom('access_grant')
          .select((eb) => eb.fn.countAll().as('count'))
          .executeTakeFirstOrThrow(),
      );
    const before = await count();

    // Named by a caller, so answered rather than thrown: the grants route passes these ids on.
    await expect(
      make({
        roleId: theirs.role,
        subject: { principal: ada },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
      }),
    ).resolves.toEqual({ refused: 'grant.role_missing' });
    await expect(
      make({
        roleId: roles.Reader!,
        subject: { principal: theirs.principal },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
      }),
    ).resolves.toEqual({ refused: 'grant.subject_missing' });
    await expect(
      make({
        roleId: roles.Reader!,
        subject: { group: theirs.group },
        level: { kind: 'space', id: spaceId },
        effect: 'allow',
      }),
    ).resolves.toEqual({ refused: 'grant.subject_missing' });
    // A level is decided before `grant` is called - a route refuses one the tenant does not hold as
    // not found - so reaching here with another tenant's is a caller's bug, and still stores nothing.
    await expect(
      make({
        roleId: roles.Reader!,
        subject: { principal: ada },
        level: { kind: 'space', id: theirs.space },
        effect: 'allow',
      }),
    ).rejects.toThrow();
    await expect(
      make({
        roleId: roles.Reader!,
        subject: { principal: ada },
        level: { kind: 'artifact', id: theirs.artifact },
        effect: 'allow',
      }),
    ).rejects.toThrow();

    expect((await count()).count).toEqual(before.count);
  });

  it("cannot add a group's member using a group or a principal from another tenant, and stores nothing", async () => {
    const own = await service.withTenant(production, (trx) => createGroup(trx, 'Cross-tenant'));
    if (!('group' in own)) throw new Error('the group was not made');

    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, theirs.group, ada)),
    ).rejects.toThrow();
    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, own.group.id, theirs.principal)),
    ).rejects.toThrow();

    const members = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('group_member')
        .select('principal_id')
        .where('group_id', '=', own.group.id)
        .execute(),
    );
    expect(members).toEqual([]);
  });

  it('lets two tenants use the same group name', async () => {
    const here = await service.withTenant(production, (trx) => createGroup(trx, 'Shared name'));
    const there = await service.withTenant(development, (trx) => createGroup(trx, 'Shared name'));
    expect(here).toMatchObject({ group: { name: 'Shared name', source: 'tenant' } });
    expect(there).toMatchObject({ group: { name: 'Shared name', source: 'tenant' } });
  });

  it('refuses to add a member to a group the provider asserts', async () => {
    const provider = await service.withTenant(production, (trx) =>
      trx
        .insertInto('access_group')
        .values({ name: 'Provider staff', source: 'provider', provider_value: 'staff' })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, provider.id, ada)),
    ).resolves.toEqual({ refused: 'group.from_provider' });
  });

  it('refuses to add an external principal where a grant the group holds is at the tenant or past the cap', async () => {
    const atTenant = await service.withTenant(production, (trx) => createGroup(trx, 'At tenant'));
    if (!('group' in atTenant)) throw new Error('the group was not made');
    await make({
      roleId: roles.Reader!,
      subject: { group: atTenant.group.id },
      level: { kind: 'tenant' },
      effect: 'allow',
    });
    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, atTenant.group.id, alice)),
    ).resolves.toEqual({ refused: 'grant.external_at_tenant' });

    const pastCap = await service.withTenant(production, (trx) => createGroup(trx, 'Past cap'));
    if (!('group' in pastCap)) throw new Error('the group was not made');
    await make({
      roleId: roles.Reader!,
      subject: { group: pastCap.group.id },
      level: { kind: 'space', id: spaceId },
      effect: 'allow',
      expiresAt: new Date(Date.now() + 120 * DAY),
    });
    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, pastCap.group.id, alice)),
    ).resolves.toEqual({ refused: 'grant.external_past_cap' });
  });

  it('answers a re-add of an already-present member without repeating checks that could refuse it fresh', async () => {
    const group = await service.withTenant(production, (trx) => createGroup(trx, 'Already there'));
    if (!('group' in group)) throw new Error('the group was not made');

    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, group.group.id, alice)),
    ).resolves.toEqual({ added: true });

    // Recorded directly: what re-adding Alice must not re-litigate, since `grant` itself would now
    // refuse this to the group she is already inside.
    await service.withTenant(production, (trx) =>
      trx
        .insertInto('access_grant')
        .values({
          role_id: roles.Author!,
          group_id: group.group.id,
          level: 'artifact',
          artifact_id: artifactId,
          effect: 'allow',
          granted_by: ada,
        })
        .execute(),
    );

    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, group.group.id, alice)),
    ).resolves.toEqual({ added: true });
  });

  it('ignores an expired grant when deciding whether an external principal may join', async () => {
    const group = await service.withTenant(production, (trx) => createGroup(trx, 'Expired'));
    if (!('group' in group)) throw new Error('the group was not made');
    await service.withTenant(production, (trx) =>
      trx
        .insertInto('access_grant')
        .values({
          role_id: roles.Author!,
          group_id: group.group.id,
          level: 'artifact',
          artifact_id: artifactId,
          effect: 'allow',
          granted_by: ada,
          expires_at: new Date(Date.now() - DAY),
        })
        .execute(),
    );
    await expect(
      service.withTenant(production, (trx) => addToGroup(trx, group.group.id, alice)),
    ).resolves.toEqual({ added: true });
  });
});
