import { randomBytes } from 'node:crypto';
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
import { openSecret, SealedSecretRefused } from '@alloy-works/sealing';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const KEY = randomBytes(32);
const SECRET = 'acme-client-secret';

describe('sign-in settings', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let other: Tenant;
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
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
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

  const sealedOf = async (of: Tenant) => {
    const row = await service.withTenant(of, (trx) =>
      trx
        .selectFrom('identity_provider')
        .select(['sealed_secret', 'secret_name'])
        .executeTakeFirstOrThrow(),
    );
    return row;
  };

  it('records the provider with its client secret sealed to this environment, never the secret, and permits the route', async () => {
    await configureOrganisationSignIn(
      db.adminUrl,
      tenant,
      { issuer: 'https://idp.example', clientId: 'alloy', clientSecret: SECRET },
      KEY,
    );
    const provider = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('identity_provider').selectAll().executeTakeFirstOrThrow(),
    );
    expect(provider).toMatchObject({
      issuer: 'https://idp.example',
      client_id: 'alloy',
      secret_name: null,
    });
    expect(provider.sealed_secret).not.toContain(SECRET);
    expect(openSecret(KEY, 'sign-in', tenant.id, provider.sealed_secret!)).toBe(SECRET);
    const routes = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('sign_in_route').select('route').execute(),
    );
    expect(routes).toEqual([{ route: 'organisation' }]);
  });

  it("holds each environment's own secret, which opens for that environment alone and never as another kind of secret", async () => {
    await configureOrganisationSignIn(
      db.adminUrl,
      other,
      { issuer: 'https://idp.example', clientId: 'alloy', clientSecret: 'development-secret' },
      KEY,
    );
    const mine = (await sealedOf(tenant)).sealed_secret!;
    const theirs = (await sealedOf(other)).sealed_secret!;
    expect(openSecret(KEY, 'sign-in', tenant.id, mine)).toBe(SECRET);
    expect(openSecret(KEY, 'sign-in', other.id, theirs)).toBe('development-secret');
    expect(() => openSecret(KEY, 'sign-in', tenant.id, theirs)).toThrow(SealedSecretRefused);
    expect(() => openSecret(KEY, 'sign-in', other.id, mine)).toThrow(SealedSecretRefused);
    expect(() => openSecret(KEY, 'object-store', tenant.id, mine)).toThrow(SealedSecretRefused);
  });

  it('keeps a secret sealed and nothing else: never a plain one, never one cut short, never a name beside it, and never neither', async () => {
    const sealed = (await sealedOf(tenant)).sealed_secret!;
    const table = `${tenant.schema}.identity_provider`;
    await expect(
      queryAs(db.adminUrl, `update ${table} set sealed_secret = $1`, [SECRET]),
    ).rejects.toThrow(/identity_provider_sealed_secret/);
    // A tag cut to four bytes, or an IV of eight: shaped like a sealed secret, but not one this wrote.
    const [version, iv, tag, body] = sealed.split('.');
    const cut = (part: string, bytes: number) =>
      Buffer.from(part, 'base64url').subarray(0, bytes).toString('base64url');
    for (const altered of [
      [version, iv, cut(tag!, 4), body].join('.'),
      [version, cut(iv!, 8), tag, body].join('.'),
    ]) {
      await expect(
        queryAs(db.adminUrl, `update ${table} set sealed_secret = $1`, [altered]),
        altered,
      ).rejects.toThrow(/identity_provider_sealed_secret/);
    }
    await expect(
      queryAs(db.adminUrl, `update ${table} set secret_name = 'stand_in'`),
    ).rejects.toThrow(/identity_provider_one_secret/);
    await expect(queryAs(db.adminUrl, `update ${table} set sealed_secret = null`)).rejects.toThrow(
      /identity_provider_one_secret/,
    );
    expect((await sealedOf(tenant)).sealed_secret).toBe(sealed);
  });

  it('refuses a configuration with no client secret', async () => {
    await expect(
      configureOrganisationSignIn(
        db.adminUrl,
        tenant,
        { issuer: 'https://idp.example', clientId: 'alloy', clientSecret: '' },
        KEY,
      ),
    ).rejects.toThrow(/client secret is required/);
  });

  it('replaces the provider when configured again', async () => {
    await configureOrganisationSignIn(
      db.adminUrl,
      tenant,
      {
        issuer: 'https://login.example',
        clientId: 'alloy-2',
        clientSecret: SECRET,
      },
      KEY,
    );
    const providers = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('identity_provider').select(['issuer', 'client_id']).execute(),
    );
    expect(providers).toEqual([{ issuer: 'https://login.example', client_id: 'alloy-2' }]);
  });

  it("records the claim a provider's groups arrive in: groups unless said, and kept when configured again without one", async () => {
    const claim = () =>
      service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('identity_provider')
          .select('groups_claim')
          .executeTakeFirstOrThrow()
          .then((row) => row.groups_claim),
      );
    expect(await claim()).toBe('groups');
    await configureOrganisationSignIn(
      db.adminUrl,
      tenant,
      {
        issuer: 'https://login.example',
        clientId: 'alloy-2',
        clientSecret: SECRET,
        groupsClaim: 'https://acme.example/claims/roles',
      },
      KEY,
    );
    expect(await claim()).toBe('https://acme.example/claims/roles');
    await configureOrganisationSignIn(
      db.adminUrl,
      tenant,
      {
        issuer: 'https://login.example',
        clientId: 'alloy-2',
        clientSecret: SECRET,
      },
      KEY,
    );
    expect(await claim()).toBe('https://acme.example/claims/roles');
    await configureOrganisationSignIn(
      db.adminUrl,
      tenant,
      {
        issuer: 'https://login.example',
        clientId: 'alloy-2',
        clientSecret: SECRET,
        groupsClaim: 'groups',
      },
      KEY,
    );
    expect(await claim()).toBe('groups');
  });

  it('takes a claim name of 1 to 64 characters that looks like one, and nothing else', async () => {
    for (const refused of ['', ' groups', 'two words', 'a'.repeat(65), 'groups\n', '1groups']) {
      await expect(
        configureOrganisationSignIn(
          db.adminUrl,
          tenant,
          {
            issuer: 'https://login.example',
            clientId: 'alloy-2',
            clientSecret: SECRET,
            groupsClaim: refused,
          },
          KEY,
        ),
        JSON.stringify(refused),
      ).rejects.toThrow(/identity_provider_groups_claim/);
    }
    for (const taken of ['groups', 'wids', 'cognito:groups', 'a'.repeat(64)]) {
      await configureOrganisationSignIn(
        db.adminUrl,
        tenant,
        {
          issuer: 'https://login.example',
          clientId: 'alloy-2',
          clientSecret: SECRET,
          groupsClaim: taken,
        },
        KEY,
      );
    }
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

  it('records an invitation by address, in lower case, once, with the principal it will become', async () => {
    await inviteToTenant(db.adminUrl, tenant, 'Ada@Example.com');
    await inviteToTenant(db.adminUrl, tenant, 'ada@example.com');
    const invitations = await service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('invitation as i')
        .innerJoin('principal as p', 'p.id', 'i.principal_id')
        .select(['i.email', 'i.expires_at', 'i.accepted_at', 'p.issuer', 'p.subject'])
        .execute(),
    );
    expect(invitations).toEqual([
      {
        email: 'ada@example.com',
        expires_at: null,
        accepted_at: null,
        issuer: null,
        subject: null,
      },
    ]);
  });

  it('makes no invitation for an address a signed-in principal already shows, verified', async () => {
    await service.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'alice',
          email: 'alice@example.com',
          email_verified: true,
          display_name: 'Alice',
        })
        .execute(),
    );
    await inviteToTenant(db.adminUrl, tenant, 'Alice@Example.com');
    const invitations = await service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('invitation')
        .select('email')
        .where('email', '=', 'alice@example.com')
        .execute(),
    );
    expect(invitations).toEqual([]);
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
