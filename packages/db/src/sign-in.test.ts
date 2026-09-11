import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { configureOrganisationSignIn } from './sign-in.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('organisation sign-in settings', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('permits no route until one is configured', async () => {
    const routes = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('sign_in_route').selectAll().execute(),
    );
    expect(routes).toEqual([]);
  });

  it('records the provider by the name of its secret, never the secret, and permits the route', async () => {
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: 'https://idp.example',
      clientId: 'alloy',
      secretName: 'acme_idp',
    });
    const provider = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('identity_provider').selectAll().executeTakeFirstOrThrow(),
    );
    expect(provider).toMatchObject({
      issuer: 'https://idp.example',
      client_id: 'alloy',
      secret_name: 'acme_idp',
    });
    const routes = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('sign_in_route').select('route').execute(),
    );
    expect(routes).toEqual([{ route: 'organisation' }]);
  });

  it('replaces the provider when configured again', async () => {
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: 'https://login.example',
      clientId: 'alloy-2',
      secretName: 'acme_idp',
    });
    const providers = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('identity_provider').select(['issuer', 'client_id']).execute(),
    );
    expect(providers).toEqual([{ issuer: 'https://login.example', client_id: 'alloy-2' }]);
  });
});
