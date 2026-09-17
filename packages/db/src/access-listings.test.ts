import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listGrants, listPrincipals, listRoles, readGrant } from './access-listings.js';
import { bootstrapCluster } from './bootstrap.js';
import { grant, type NewGrant } from './grants.js';
import { createGroup } from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createRole, findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('listing grants, roles and people, for managing access', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let clinical: string;
  let quality: string;
  let editors: string;

  const person = (trx: TenantTransaction, subject: string, name: string | null) =>
    trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject,
        email: name === null ? null : `${subject}@example.test`,
        display_name: name,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const give = async (where: Tenant, input: Omit<NewGrant, 'roleId'> & { role: string }) => {
    const answer = await service.withTenant(where, async (trx) => {
      const role = await findRole(trx, input.role);
      return grant(trx, { ...input, roleId: role!.id });
    });
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const group = await createGroup(trx, 'Editors');
      if (!('group' in group)) throw new Error('the group was not made');
      editors = group.group.id;
    });
    // The other environment holds a grant, a role and a person of its own, none of which may appear.
    await service.withTenant(development, async (trx) => {
      const ivy = await person(trx, 'ivy', 'Ivy');
      const space = await createSpace(trx, 'Clinical');
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ivy },
        level: { kind: 'space', id: space.id },
        effect: 'allow',
        grantedBy: ivy,
      });
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('lists the grants made at one level and no other, each with its role, subject and grantor by name', async () => {
    const toGrace = await give(production, {
      role: 'Author',
      subject: { principal: grace },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      grantedBy: ada,
    });
    const toEditors = await give(production, {
      role: 'Editing',
      subject: { group: editors },
      level: { kind: 'space', id: clinical },
      effect: 'deny',
      grantedBy: ada,
    });
    await give(production, {
      role: 'Reader',
      subject: { principal: grace },
      level: { kind: 'space', id: quality },
      effect: 'allow',
      grantedBy: ada,
    });
    await give(production, {
      role: 'Reader',
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: ada,
    });

    const page = await service.withTenant(production, (trx) =>
      listGrants(trx, { kind: 'space', id: clinical }, { limit: 50 }),
    );
    expect(page.after).toBeNull();
    expect(page.items).toHaveLength(2);
    expect(page.items).toEqual(
      expect.arrayContaining([
        {
          id: toGrace.id,
          role: { id: toGrace.roleId, name: 'Author' },
          subject: { principal: { id: grace, name: 'Grace', email: 'grace@example.test' } },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          expiresAt: null,
          extends: null,
          grantedBy: { id: ada, name: 'Ada' },
          grantedAt: toGrace.grantedAt,
        },
        {
          id: toEditors.id,
          role: { id: toEditors.roleId, name: 'Editing' },
          subject: { group: { id: editors, name: 'Editors' } },
          level: { kind: 'space', id: clinical },
          effect: 'deny',
          expiresAt: null,
          extends: null,
          grantedBy: { id: ada, name: 'Ada' },
          grantedAt: toEditors.grantedAt,
        },
      ]),
    );
    const atTenant = await service.withTenant(production, (trx) =>
      listGrants(trx, { kind: 'tenant' }, { limit: 50 }),
    );
    expect(atTenant.items.map((item) => item.role.name)).toEqual(['Reader']);
  });

  it('reads one grant as a listing shows it, and nothing for an id this tenant does not hold', async () => {
    const made = await give(production, {
      role: 'Reviewer',
      subject: { principal: grace },
      level: { kind: 'tenant' },
      effect: 'deny',
      grantedBy: ada,
    });
    await expect(service.withTenant(production, (trx) => readGrant(trx, made.id))).resolves.toEqual(
      {
        id: made.id,
        role: { id: made.roleId, name: 'Reviewer' },
        subject: { principal: { id: grace, name: 'Grace', email: 'grace@example.test' } },
        level: { kind: 'tenant' },
        effect: 'deny',
        expiresAt: null,
        extends: null,
        grantedBy: { id: ada, name: 'Ada' },
        grantedAt: made.grantedAt,
      },
    );
    await expect(
      service.withTenant(development, (trx) => readGrant(trx, made.id)),
    ).resolves.toBeUndefined();
  });

  it('pages grants in the order of their ids, and says where the next page starts', async () => {
    const artifact = await service.withTenant(production, (trx) =>
      trx
        .insertInto('artifact')
        .values({ kind: 'component', space_id: clinical })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    const made = [];
    for (const role of ['Reader', 'Reviewer', 'Author']) {
      made.push(
        await give(production, {
          role,
          subject: { principal: grace },
          level: { kind: 'artifact', id: artifact },
          effect: 'allow',
          grantedBy: ada,
        }),
      );
    }
    const ids = made.map((each) => each.id).sort();
    const level = { kind: 'artifact', id: artifact } as const;

    const first = await service.withTenant(production, (trx) =>
      listGrants(trx, level, { limit: 2 }),
    );
    expect(first.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(first.after).toBe(ids[1]);
    const second = await service.withTenant(production, (trx) =>
      listGrants(trx, level, { after: first.after!, limit: 2 }),
    );
    expect(second).toMatchObject({ after: null });
    expect(second.items.map((item) => item.id)).toEqual(ids.slice(2));
  });

  it('lists the roles a grant can name, with what each holds, a page at a time', async () => {
    const first = await service.withTenant(production, (trx) => listRoles(trx, { limit: 5 }));
    const rest = await service.withTenant(production, (trx) =>
      listRoles(trx, { after: first.after!, limit: 5 }),
    );
    expect(first.items).toHaveLength(5);
    expect(rest.after).toBeNull();
    const all = [...first.items, ...rest.items];
    expect(all.map((role) => role.id)).toEqual(all.map((role) => role.id).sort());
    expect(all.map((role) => role.name).sort()).toEqual([
      'Administrator',
      'Approver',
      'Author',
      'Definitions manager',
      'Designer',
      'Editing',
      'Reader',
      'Reviewer',
    ]);
    expect(all.find((role) => role.name === 'Editing')).toMatchObject({ permissions: ['edit'] });
  });

  it('lists no role from another tenant, as every other listing does', async () => {
    const created = await service.withTenant(production, (trx) =>
      createRole(trx, 'Provisional', ['read']),
    );
    if (!('role' in created)) throw new Error('the role was not made');
    const theirs = await service.withTenant(development, (trx) => listRoles(trx, { limit: 50 }));
    expect(theirs.items.map((role) => role.name)).not.toContain('Provisional');
  });

  it('lists the people in this environment, and nobody from another', async () => {
    const page = await service.withTenant(production, (trx) => listPrincipals(trx, { limit: 50 }));
    expect(page.after).toBeNull();
    expect(page.items).toEqual(
      [
        { id: ada, name: 'Ada', email: 'ada@example.test', kind: 'user' },
        { id: grace, name: 'Grace', email: 'grace@example.test', kind: 'user' },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );

    const first = await service.withTenant(production, (trx) => listPrincipals(trx, { limit: 1 }));
    expect(first.items).toHaveLength(1);
    expect(first.after).toBe(first.items[0]!.id);
  });

  it('lists nothing at a level the tenant does not hold, and never another environment grant', async () => {
    const theirs = await service.withTenant(development, (trx) =>
      trx.selectFrom('space').select('id').where('name', '=', 'Clinical').executeTakeFirstOrThrow(),
    );
    await expect(
      service.withTenant(production, (trx) =>
        listGrants(trx, { kind: 'space', id: theirs.id }, { limit: 50 }),
      ),
    ).resolves.toEqual({ items: [], after: null });
  });

  it('refuses a page size outside 1 to 100, as the other listings do', async () => {
    await expect(
      service.withTenant(production, (trx) => listRoles(trx, { limit: 0 })),
    ).rejects.toThrow(/1 to 100/);
    await expect(
      service.withTenant(production, (trx) => listPrincipals(trx, { limit: 101 })),
    ).rejects.toThrow(/1 to 100/);
    await expect(
      service.withTenant(production, (trx) => listGrants(trx, { kind: 'tenant' }, { limit: 1.5 })),
    ).rejects.toThrow(/1 to 100/);
  });
});
