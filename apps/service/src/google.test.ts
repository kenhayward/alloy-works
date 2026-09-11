import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  inviteToTenant,
  migrate,
  permitGoogleSignIn,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admitGoogleAccount } from './google.js';
import type { Identity } from './oidc.js';

const account = (subject: string, email: string, extra: Partial<Identity> = {}): Identity => ({
  issuer: 'https://accounts.google.com',
  subject,
  email,
  emailVerified: true,
  name: subject,
  hostedDomain: null,
  ...extra,
});

describe('who a Google account may enter as (IAM-054)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Demonstration' },
      hostnames: ['demo.acme.alloy.test'],
    });
    await permitGoogleSignIn(db.adminUrl, tenant, { domains: ['example.org'] });
    await inviteToTenant(db.adminUrl, tenant, 'Ada@Example.com');
    await inviteToTenant(db.adminUrl, tenant, 'grace@example.com');
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const admit = (identity: Identity) =>
    service.withTenant(tenant, (trx) => admitGoogleAccount(trx, identity));
  const invitation = (email: string) =>
    service.withTenant(tenant, (trx) =>
      trx
        .selectFrom('invitation')
        .select('principal_id')
        .where('email', '=', email)
        .executeTakeFirstOrThrow(),
    );

  it('admits an invited address, whatever its case, and binds the invitation to that account', async () => {
    const id = await admit(account('ada-1', 'ada@example.com'));
    expect(id).toBeDefined();
    expect((await invitation('ada@example.com')).principal_id).toBe(id);
  });

  it('finds that account again by issuer and subject, whatever its address becomes', async () => {
    const first = await admit(account('ada-1', 'ada@example.com'));
    expect(await admit(account('ada-1', 'ada@elsewhere.example'))).toBe(first);
  });

  it('refuses another account presenting an address already bound', async () => {
    await admit(account('ada-1', 'ada@example.com'));
    expect(await admit(account('ada-2', 'ada@example.com'))).toBeUndefined();
  });

  it('refuses an invited address the provider has not verified, and leaves the invitation open', async () => {
    expect(
      await admit(account('grace-1', 'grace@example.com', { emailVerified: false })),
    ).toBeUndefined();
    expect((await invitation('grace@example.com')).principal_id).toBeNull();
  });

  it('admits any account of a named Workspace domain', async () => {
    const alice = account('alice-1', 'alice@example.org', { hostedDomain: 'example.org' });
    expect(await admit(alice)).toBeDefined();
  });

  it('never matches a named domain on a personal account, whatever its address', async () => {
    expect(await admit(account('mallory-1', 'mallory@example.org'))).toBeUndefined();
  });

  it('refuses an account nobody invited', async () => {
    expect(await admit(account('bob-1', 'bob@example.com'))).toBeUndefined();
  });
});
