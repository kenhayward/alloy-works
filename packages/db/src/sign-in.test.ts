import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  closeSignInRoute,
  configureOrganisationSignIn,
  inviteToTenant,
  permitGoogleSignIn,
} from './sign-in.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('sign-in settings', () => {
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

  it('permits Google, recording the Workspace domains named in lower case, once', async () => {
    await permitGoogleSignIn(db.adminUrl, tenant, { domains: ['Example.org'] });
    await permitGoogleSignIn(db.adminUrl, tenant, { domains: ['example.org'] });
    const { routes, domains } = await service.withTenant(tenant, async (trx) => ({
      routes: await trx.selectFrom('sign_in_route').select('route').orderBy('route').execute(),
      domains: await trx.selectFrom('google_domain').select('domain').execute(),
    }));
    expect(routes).toEqual([{ route: 'google' }, { route: 'organisation' }]);
    expect(domains).toEqual([{ domain: 'example.org' }]);
  });

  it('records an invitation by address, in lower case, once', async () => {
    await inviteToTenant(db.adminUrl, tenant, 'Ada@Example.com');
    await inviteToTenant(db.adminUrl, tenant, 'ada@example.com');
    const invitations = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('invitation').select(['email', 'principal_id']).execute(),
    );
    expect(invitations).toEqual([{ email: 'ada@example.com', principal_id: null }]);
  });

  it('ends the sessions a route issued when it is closed, and no others', async () => {
    await service.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'grace',
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const later = new Date(Date.now() + 60 * 60 * 1000);
      for (const route of ['organisation', 'google'] as const) {
        await trx
          .insertInto('session')
          .values({
            token_hash: `hash-of-a-${route}-token`,
            principal_id: principal.id,
            route,
            idle_expires_at: later,
            expires_at: later,
          })
          .execute();
      }
    });
    await closeSignInRoute(db.adminUrl, tenant, 'google');
    const { routes, sessions } = await service.withTenant(tenant, async (trx) => ({
      routes: await trx.selectFrom('sign_in_route').select('route').execute(),
      sessions: await trx.selectFrom('session').select('route').execute(),
    }));
    expect(routes).toEqual([{ route: 'organisation' }]);
    expect(sessions).toEqual([{ route: 'organisation' }]);
  });
});
