import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { provisionTenant, type NewTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './test/database.js';

describe('provisionTenant', () => {
  let db: TestDatabase;

  const input = (id: string, hostnames: string[]): NewTenant => ({
    organisation: { id: 'acme', name: 'Acme' },
    tenant: { id, name: 'Production' },
    hostnames,
  });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
  });

  afterAll(() => db.drop());

  it('creates the schema, owned by the tenant owner role, and the platform rows', async () => {
    const id = db.newTenantId();
    const tenant = await provisionTenant(db.adminUrl, input(id, ['Acme.Alloy.test']));
    expect(tenant).toEqual({ id, schema: `t_${id}`, role: `t_${id}` });

    const schema = await queryAs(
      db.adminUrl,
      'select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = $1',
      [tenant.schema],
    );
    expect(schema.rows).toEqual([{ owner: `t_${id}_owner` }]);

    const hostnames = await queryAs(
      db.adminUrl,
      'select hostname from platform.tenant_hostname where tenant_id = $1',
      [id],
    );
    expect(hostnames.rows).toEqual([{ hostname: 'acme.alloy.test' }]);
  });

  it('lets the login roles assume the tenant role but never inherit it', async () => {
    const id = db.newTenantId();
    await provisionTenant(db.adminUrl, input(id, [`${id}.acme.alloy.test`]));
    const { rows } = await queryAs(
      db.adminUrl,
      `select m.rolname as member, r.rolname as role, a.inherit_option, a.set_option
         from pg_auth_members a
         join pg_roles m on m.oid = a.member
         join pg_roles r on r.oid = a.roleid
        where r.rolname in ($1, $2)
        order by 1, 2`,
      [`t_${id}`, `t_${id}_owner`],
    );
    expect(rows).toEqual([
      { member: 'aw_migrator', role: `t_${id}_owner`, inherit_option: false, set_option: true },
      { member: 'aw_service', role: `t_${id}`, inherit_option: false, set_option: true },
      { member: 'aw_worker', role: `t_${id}`, inherit_option: false, set_option: true },
    ]);
  });

  it('refuses an id that would not make a safe role name, before touching the database', async () => {
    await expect(provisionTenant(db.adminUrl, input('Acme-Prod', []))).rejects.toThrow(
      /lower-case letters and digits/,
    );
  });

  it('leaves nothing behind when a hostname is already taken', async () => {
    const first = db.newTenantId();
    await provisionTenant(db.adminUrl, input(first, ['taken.acme.alloy.test']));
    const second = db.newTenantId();
    await expect(
      provisionTenant(db.adminUrl, input(second, ['taken.acme.alloy.test'])),
    ).rejects.toThrow(/tenant_hostname_pkey/);

    const roles = await queryAs(db.adminUrl, 'select 1 from pg_roles where rolname like $1', [
      `t_${second}%`,
    ]);
    expect(roles.rowCount).toBe(0);
  });
});
