import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { grant, type NewGrant } from './grants.js';
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
  let service: TenantDatabase;
  let ada: string;
  let alice: string;
  let spaceId: string;
  let artifactId: string;
  const roles: Record<string, string> = {};

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
});
