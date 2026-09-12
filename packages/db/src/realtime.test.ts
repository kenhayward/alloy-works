import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { listenToTenants, notifyTenant, tenantChannel, type TenantListener } from './realtime.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const heard = (listener: TenantListener, tenantId: string) =>
  new Promise<unknown>((resolve) => {
    const stop = listener.subscribe(tenantId, (event) => {
      stop();
      resolve(event);
    });
  });

describe('what an environment says has happened', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let listener: TenantListener;
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    a = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    b = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    listener = listenToTenants(db.serviceUrl);
  });

  afterAll(async () => {
    await listener.close();
    await service.close();
    await db.drop();
  });

  const announce = (tenant: Tenant, id: string) =>
    service.withTenant(tenant, (trx) => notifyTenant(trx, { kind: 'sample', id, state: 'done' }));

  it('names a channel after the tenant, and refuses anything else', () => {
    expect(tenantChannel('acmedev')).toBe('aw_t_acmedev');
    expect(() => tenantChannel('acme; drop')).toThrow(/tenant/i);
  });

  it('carries a kind, an id and a state to whoever is listening', async () => {
    const event = heard(listener, a.id);
    await announce(a, '11111111-2222-4333-8444-555555555555');
    expect(await event).toEqual({
      kind: 'sample',
      id: '11111111-2222-4333-8444-555555555555',
      state: 'done',
    });
  });

  it('reaches nobody listening to another environment', async () => {
    const wrong: unknown[] = [];
    const stop = listener.subscribe(b.id, (event) => wrong.push(event));
    const mine = heard(listener, a.id);
    await announce(a, '11111111-2222-4333-8444-666666666666');
    await mine;
    stop();
    expect(wrong).toEqual([]);
  });

  it('listens while somebody is watching, and stops when the last one goes', () => {
    const first = listener.subscribe(a.id, () => {});
    const second = listener.subscribe(a.id, () => {});
    expect(listener.listening()).toContain(tenantChannel(a.id));
    first();
    expect(listener.listening()).toContain(tenantChannel(a.id));
    second();
    expect(listener.listening()).not.toContain(tenantChannel(a.id));
  });

  it('hears again after its connection is lost', async () => {
    const event = heard(listener, a.id);
    const cut = await queryAs(
      db.adminUrl,
      `select pg_terminate_backend(pid) from pg_stat_activity
        where application_name = 'alloy-works-listener' and pid <> pg_backend_pid()`,
    );
    // Proves the test cuts something: matching nothing would make this pass for the wrong reason.
    expect(cut.rows.length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await announce(a, '11111111-2222-4333-8444-777777777777');
    expect(await event).toMatchObject({ id: '11111111-2222-4333-8444-777777777777' });
  });
});
