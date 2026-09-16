import { decide } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { claimFirstAdministrator, nameFirstAdministrator } from './first-administrator.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const ISSUER = 'https://idp.example';

describe('the first administrator', () => {
  let db: TestDatabase;
  let service: TenantDatabase;

  const tenant = (name: string) =>
    createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name },
      hostnames: [`${name.toLowerCase()}.acme.alloy.test`],
    });

  /** A sign-in's principal: found or made by issuer and subject, as the service does. */
  const signingIn = (trx: TenantTransaction, subject: string, email: string | null = null) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email, display_name: null })
      .onConflict((conflict) => conflict.columns(['issuer', 'subject']).doUpdateSet({ email }))
      .returning(['id', 'issuer', 'subject'])
      .executeTakeFirstOrThrow();

  const administers = (on: Tenant, principalId: string) =>
    service.withTenant(on, async (trx) => {
      const facts = await loadFacts(trx, principalId, { kind: 'tenant' });
      return decide('administer', facts!).allowed;
    });

  const namings = (on: Tenant) =>
    service.withTenant(on, (trx) =>
      trx
        .selectFrom('first_administrator')
        .select(['issuer', 'subject', 'named_by', 'claimed_by', 'outcome'])
        .orderBy('named_at')
        .execute(),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('is granted Administrator at the tenant on the first sign-in as the named identity, once', async () => {
    const production = await tenant('Production');
    await expect(
      nameFirstAdministrator(db.adminUrl, production, {
        issuer: ISSUER,
        subject: 'ada',
        namedBy: 'provisioning',
      }),
    ).resolves.toEqual({ named: true });

    const grace = await service.withTenant(production, async (trx) => {
      const principal = await signingIn(trx, 'grace', 'ada@example.com');
      await expect(claimFirstAdministrator(trx, principal)).resolves.toBeUndefined();
      return principal.id;
    });
    await expect(administers(production, grace)).resolves.toBe(false);

    const ada = await service.withTenant(production, async (trx) => {
      const principal = await signingIn(trx, 'ada');
      await expect(claimFirstAdministrator(trx, principal)).resolves.toBe('granted');
      return principal.id;
    });
    await expect(administers(production, ada)).resolves.toBe(true);
    await expect(namings(production)).resolves.toEqual([
      {
        issuer: ISSUER,
        subject: 'ada',
        named_by: 'provisioning',
        claimed_by: ada,
        outcome: 'granted',
      },
    ]);

    await service.withTenant(production, async (trx) => {
      await expect(
        claimFirstAdministrator(trx, await signingIn(trx, 'ada')),
      ).resolves.toBeUndefined();
    });
    const grants = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('access_grant')
        .select(['principal_id', 'level', 'effect', 'granted_by'])
        .execute(),
    );
    expect(grants).toEqual([
      { principal_id: ada, level: 'tenant', effect: 'allow', granted_by: ada },
    ]);
  });

  it('is refused a naming while one waits, or once somebody administers the tenant', async () => {
    const development = await tenant('Development');
    const name = (subject: string) =>
      nameFirstAdministrator(db.adminUrl, development, {
        issuer: ISSUER,
        subject,
        namedBy: 'provisioning',
      });
    await expect(name('ada')).resolves.toEqual({ named: true });
    await expect(name('grace')).resolves.toEqual({
      refused: 'first_administrator.already_named',
    });

    await service.withTenant(development, async (trx) => {
      await claimFirstAdministrator(trx, await signingIn(trx, 'ada'));
    });
    await expect(name('grace')).resolves.toEqual({
      refused: 'first_administrator.administrator_exists',
    });
  });

  it('records a refusal, and grants nothing, when an administrator was made some other way first', async () => {
    const sandbox = await tenant('Sandbox');
    await nameFirstAdministrator(db.adminUrl, sandbox, {
      issuer: ISSUER,
      subject: 'grace',
      namedBy: 'provisioning',
    });
    const ada = await service.withTenant(sandbox, async (trx) => {
      const principal = await signingIn(trx, 'ada');
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: principal.id },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: principal.id,
      });
      return principal.id;
    });

    const grace = await service.withTenant(sandbox, async (trx) => {
      const principal = await signingIn(trx, 'grace');
      await expect(claimFirstAdministrator(trx, principal)).resolves.toBe(
        'refused_administrator_exists',
      );
      return principal.id;
    });
    await expect(administers(sandbox, grace)).resolves.toBe(false);
    await expect(administers(sandbox, ada)).resolves.toBe(true);
    await expect(namings(sandbox)).resolves.toMatchObject([
      { claimed_by: grace, outcome: 'refused_administrator_exists' },
    ]);
  });

  it('cannot be named, or have its naming changed, by the runtime role the service uses', async () => {
    const staging = await tenant('Staging');
    await nameFirstAdministrator(db.adminUrl, staging, {
      issuer: ISSUER,
      subject: 'ada',
      namedBy: 'provisioning',
    });
    await expect(
      service.withTenant(staging, (trx) =>
        sql`insert into first_administrator (issuer, subject, role_id, named_by)
            select ${ISSUER}, 'mallory', id, 'self' from role where name = 'Administrator'`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      service.withTenant(staging, (trx) =>
        sql`update first_administrator set subject = 'mallory'`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      service.withTenant(staging, (trx) => sql`delete from first_administrator`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });
});
