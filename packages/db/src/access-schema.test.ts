import { permissions, principalKinds, starterRoles } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('the access tables', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let reader: string;

  const principal = (trx: TenantTransaction, subject: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: 'https://idp.example', subject, email: null, display_name: null })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const roleId = (trx: TenantTransaction, name: string) =>
    trx
      .selectFrom('role')
      .select('id')
      .where('name', '=', name)
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** Sorted by name: the starter roles share one `created_at`, so an order test cannot rely on it. */
  const byName = <T extends { name: string }>(rows: readonly T[]) =>
    [...rows].sort((a, b) => a.name.localeCompare(b.name));

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
    ({ ada, reader } = await service.withTenant(production, async (trx) => ({
      ada: await principal(trx, 'ada'),
      reader: await roleId(trx, 'Reader'),
    })));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('starts every tenant with the nine starter roles and one space, General', async () => {
    for (const tenant of [production, development]) {
      const roles = await service.withTenant(tenant, (trx) =>
        trx.selectFrom('role').select(['name', 'permissions']).execute(),
      );
      expect(byName(roles)).toEqual(
        byName(starterRoles.map((role) => ({ name: role.name, permissions: role.permissions }))),
      );
      const spaces = await service.withTenant(tenant, (trx) =>
        trx.selectFrom('space').select('name').execute(),
      );
      expect(spaces).toEqual([{ name: 'General' }]);
    }
  });

  it("holds a role's permissions to the domain's closed set", async () => {
    for (const permission of permissions) {
      await service.withTenant(production, (trx) =>
        trx
          .insertInto('role')
          .values({ name: `Only ${permission}`, permissions: [permission] })
          .execute(),
      );
    }
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into role (name, permissions) values ('Deleter', array['read', 'delete'])`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/role_permissions_closed/);
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into role (name, permissions) values ('Nested', array[array['read']])`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/role_permissions_closed/);
  });

  it("holds a principal's kind to the domain's kinds, a user unless said otherwise", async () => {
    const kind = await service.withTenant(production, (trx) =>
      trx.selectFrom('principal').select('kind').where('id', '=', ada).executeTakeFirstOrThrow(),
    );
    expect(kind).toEqual({ kind: 'user' });
    for (const allowed of principalKinds) {
      await service.withTenant(production, (trx) =>
        trx.updateTable('principal').set({ kind: allowed }).where('id', '=', ada).execute(),
      );
    }
    await service.withTenant(production, (trx) =>
      trx.updateTable('principal').set({ kind: 'user' }).where('id', '=', ada).execute(),
    );
    await expect(
      service.withTenant(production, (trx) =>
        sql`update principal set kind = 'guest' where id = ${ada}`.execute(trx),
      ),
    ).rejects.toThrow(/principal_kind_check/);
  });

  it('IAM-062 confers a permission only by a grant naming a role, exactly one subject and one level', async () => {
    const space = await service.withTenant(production, (trx) => createSpace(trx, 'Clinical'));
    const insert = (values: Record<string, unknown>) =>
      service.withTenant(production, (trx) =>
        trx
          .insertInto('access_grant')
          .values({
            role_id: reader,
            level: 'tenant',
            effect: 'allow',
            granted_by: ada,
            ...values,
          })
          .execute(),
      );

    await expect(insert({ principal_id: ada })).resolves.toBeDefined();
    await expect(insert({})).rejects.toThrow(/access_grant_one_subject/);
    const group = await service.withTenant(production, (trx) =>
      trx
        .insertInto('access_group')
        .values({ name: 'Editors', source: 'tenant', provider_value: null })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await expect(insert({ principal_id: ada, group_id: group.id })).rejects.toThrow(
      /access_grant_one_subject/,
    );
    await expect(insert({ principal_id: ada, level: 'space' })).rejects.toThrow(
      /access_grant_level_target/,
    );
    await expect(
      insert({ principal_id: ada, level: 'tenant', space_id: space.id }),
    ).rejects.toThrow(/access_grant_level_target/);
    await expect(
      insert({ principal_id: ada, level: 'space', space_id: space.id }),
    ).resolves.toBeDefined();
    await expect(insert({ role_id: null, principal_id: ada })).rejects.toThrow(/role_id/);

    const columns = await service.withTenant(production, async (trx) => {
      const { rows } = await sql<{ table_name: string; column_name: string }>`
        select table_name, column_name from information_schema.columns
        where table_schema = current_schema() and column_name like '%permission%'
        order by table_name, column_name
      `.execute(trx);
      return rows;
    });
    expect(columns).toEqual([{ table_name: 'role', column_name: 'permissions' }]);
  });

  it('makes the same grant once, and never changes one: the runtime role holds no update', async () => {
    const insert = () =>
      service.withTenant(production, (trx) =>
        trx
          .insertInto('access_grant')
          .values({
            role_id: reader,
            principal_id: ada,
            level: 'tenant',
            effect: 'deny',
            granted_by: ada,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
    const made = await insert();
    await expect(insert()).rejects.toThrow(/access_grant_once/);
    await expect(
      service.withTenant(production, (trx) =>
        sql`update access_grant set effect = 'allow' where id = ${made.id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('holds a provider value on a group from the provider, and only there', async () => {
    const insert = (source: string, value: string | null, name: string) =>
      service.withTenant(production, (trx) =>
        trx
          .insertInto('access_group')
          .values({ name, source: source as 'tenant', provider_value: value })
          .execute(),
      );
    await expect(insert('provider', 'staff', 'Staff')).resolves.toBeDefined();
    await expect(insert('provider', null, 'Nobody')).rejects.toThrow(/access_group_provider_value/);
    await expect(insert('tenant', 'staff-2', 'Somebody')).rejects.toThrow(
      /access_group_provider_value/,
    );
  });

  it('starts external access at thirty days by default, capped at ninety', async () => {
    const policy = await service.withTenant(production, (trx) =>
      trx.selectFrom('access_policy').selectAll().execute(),
    );
    expect(policy).toEqual([{ singleton: true, external_default_days: 30, external_cap_days: 90 }]);
  });

  it("holds the policy row the runtime role reads for grant's defaults and caps: no insert, no delete", async () => {
    await expect(
      service.withTenant(production, (trx) => sql`delete from access_policy`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into access_policy (singleton) values (true)`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot grant a role, a space or a principal from another tenant', async () => {
    const theirs = await service.withTenant(development, async (trx) => ({
      space: (await createSpace(trx, 'Theirs')).id,
      role: await roleId(trx, 'Reader'),
      principal: await principal(trx, 'grace'),
    }));
    const insert = (values: Record<string, unknown>) =>
      service.withTenant(production, (trx) =>
        trx
          .insertInto('access_grant')
          .values({
            role_id: reader,
            principal_id: ada,
            level: 'tenant',
            effect: 'allow',
            granted_by: ada,
            ...values,
          })
          .execute(),
      );
    await expect(insert({ role_id: theirs.role })).rejects.toThrow(/access_grant_role_id_fkey/);
    await expect(insert({ level: 'space', space_id: theirs.space })).rejects.toThrow(
      /access_grant_space_id_fkey/,
    );
    await expect(insert({ principal_id: theirs.principal })).rejects.toThrow(
      /access_grant_principal_id_fkey/,
    );
  });
});
