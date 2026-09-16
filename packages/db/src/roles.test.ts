import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createGroup } from './groups.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createRole, findRole } from './roles.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('roles and groups', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;

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
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('IAM-021 lets a tenant define a role as a named bundle of permissions, beside the ones it starts with', async () => {
    const answer = await service.withTenant(production, (trx) =>
      createRole(trx, 'Proofreader', ['read', 'comment', 'suggest']),
    );
    expect(answer).toMatchObject({
      role: { name: 'Proofreader', permissions: ['read', 'comment', 'suggest'] },
    });

    const starter = await service.withTenant(production, (trx) => findRole(trx, 'Author'));
    expect(starter).toMatchObject({
      name: 'Author',
      permissions: ['read', 'create', 'edit', 'comment', 'suggest'],
    });
    const renamed = await service.withTenant(production, async (trx) => {
      await trx
        .updateTable('role')
        .set({ name: 'Writer', permissions: ['read', 'edit'] })
        .where('id', '=', starter!.id)
        .execute();
      return findRole(trx, 'Writer');
    });
    expect(renamed).toEqual({ id: starter!.id, name: 'Writer', permissions: ['read', 'edit'] });

    await expect(
      service.withTenant(development, (trx) => findRole(trx, 'Proofreader')),
    ).resolves.toBeUndefined();
    await expect(
      service.withTenant(development, (trx) => findRole(trx, 'Author')),
    ).resolves.toMatchObject({ name: 'Author' });
  });

  it('refuses a role the domain would refuse, or a name the tenant already uses', async () => {
    const make = (name: string, held: readonly string[]) =>
      service.withTenant(production, (trx) => createRole(trx, name, held));
    await expect(make('Nothing', [])).resolves.toEqual({ refused: 'role.empty' });
    await expect(make('Changing', ['edit', 'comment'])).resolves.toMatchObject({
      role: { name: 'Changing', permissions: ['edit', 'comment'] },
    });
    await expect(make('Deleter', ['read', 'delete'])).resolves.toEqual({
      refused: 'role.unknown_permission',
    });
    await expect(make('Twice', ['read', 'read'])).resolves.toEqual({
      refused: 'role.repeated_permission',
    });
    await expect(make('Reader', ['read'])).resolves.toEqual({ refused: 'role.name_taken' });
    await expect(
      service.withTenant(development, (trx) => createRole(trx, 'Proofreader', ['read'])),
    ).resolves.toMatchObject({ role: { name: 'Proofreader' } });
  });

  it('creates a tenant-managed group with a name unique in the tenant', async () => {
    const group = await service.withTenant(production, (trx) => createGroup(trx, 'Editors'));
    expect(group).toMatchObject({ group: { name: 'Editors', source: 'tenant' } });
    await expect(
      service.withTenant(production, (trx) => createGroup(trx, 'Editors')),
    ).resolves.toEqual({ refused: 'group.name_taken' });
  });
});
