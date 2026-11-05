import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { copySharedProviders, hasSharedProvider, markProviderShared } from './provider-sharing.js';
import { turnScimOn } from './scim.js';
import { addProvider, changeProvider, closeProviderAsked } from './sign-in-settings.js';
import { openSecret, sealSecret } from '@alloy-works/sealing';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  createTenantMaker,
  hostnameSuffix,
  REQUEST_ATTEMPTS,
  requestTenant,
  tenantRequests,
  type TenantMaker,
} from './tenant-creation.js';
import { organisationTenants } from './tenant-lifecycle.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const KEY = Buffer.alloc(32, 7);
const LEASE = 60_000;

describe('creating a tenant and sharing a provider (the TL plan, TLe)', () => {
  let db: TestDatabase;
  let admin: pg.Client;
  let service: TenantDatabase;
  let steward: TenantDatabase;
  let maker: TenantMaker;
  let organisation: Tenant;
  const org = 'acme';

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    service = testTenantDatabase(db.serviceUrl);
    steward = createTenantDatabase(db.stewardUrl);
    maker = createTenantMaker(db.stewardUrl);
    organisation = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: org, name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Acme' },
      hostnames: ['org.acme.alloy.test'],
      kind: 'organisation',
    });
    await admin.query(`update platform.organisation set hostname_suffix = '.acme.alloy.test'`);
  }, 120_000);

  afterAll(async () => {
    await maker?.close();
    await steward?.close();
    await service?.close();
    await admin?.end();
    await db?.drop();
  });

  const carryOut = async () => {
    const request = await maker.claim(LEASE);
    if (!request) throw new Error('Nothing was waiting');
    const tenant = await maker.build(request);
    await maker.invite(request, tenant);
    await maker.finish(request, tenant);
    return { request, tenant };
  };

  const ask = (name: string, label: string) =>
    service.withTenant(organisation, (trx) =>
      requestTenant(trx, { name, label, firstAdministrator: 'Ada@Example.test' }),
    );

  it('IAM-059 the steward alone makes a tenant whose first administrator holds an invitation and no account', async () => {
    const asked = await ask('Legal', 'legal');
    expect(asked).toMatchObject({ hostname: 'legal.acme.alloy.test' });
    const { tenant } = await carryOut();

    const { rows: invited } = await admin.query(
      `select email, accepted_at from ${tenant.schema}.invitation`,
    );
    expect(invited).toEqual([{ email: 'ada@example.test', accepted_at: null }]);
    const { rows: signedIn } = await admin.query(
      `select id from ${tenant.schema}.principal where issuer is not null`,
    );
    expect(signedIn).toEqual([]);
    expect(await service.resolveHostname('legal.acme.alloy.test')).toMatchObject({
      id: tenant.id,
      kind: 'content',
    });
    // A new tenant runs as any other: its own role, its own tables, its first event.
    await service.withTenant(tenant, async (trx) => {
      const profile = await trx
        .selectFrom('profile')
        .select('display_name')
        .executeTakeFirstOrThrow();
      expect(profile.display_name).toBe('Legal');
      const { rows } = await sql<{ kind: string; detail: unknown }>`
        select kind, detail from audit_event where kind = 'tenant.created'`.execute(trx);
      expect(rows).toEqual([{ kind: 'tenant.created', detail: { by: 'organisation' } }]);
    });
  }, 120_000);

  it('forgets the address once the invitation exists', async () => {
    const { rows } = await admin.query(
      `select first_administrator from platform.tenant_request where state = 'done'`,
    );
    expect(rows.every((row) => row.first_administrator === null)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("IAM-068 the request is in the organisation's log, and the address is not", async () => {
    await service.withTenant(organisation, async (trx) => {
      const { rows } = await sql<{ detail: { change: string }; text: string }>`
        select detail, to_jsonb(e)::text as text from audit_event e
         where kind = 'organisation.changed'`.execute(trx);
      expect(rows.map((row) => row.detail.change)).toContain('requested');
      expect(rows.some((row) => row.text.includes('ada@example.test'))).toBe(false);
    });
  });

  it("refuses another organisation's address, one taken and one that is no address", async () => {
    expect(await ask('Again', 'legal')).toEqual({ refused: 'organisation.address_taken' });
    expect(await ask('Bad', 'Not An.Address')).toEqual({ refused: 'organisation.bad_label' });
    const another = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'umbrella', name: 'Umbrella' },
      tenant: { id: db.newTenantId(), name: 'Umbrella' },
      hostnames: ['org.umbrella.alloy.test'],
      kind: 'organisation',
    });
    const refused = await service.withTenant(another, (trx) =>
      requestTenant(trx, { name: 'X', label: 'x', firstAdministrator: 'a@b.test' }),
    );
    expect(refused).toEqual({ refused: 'organisation.no_suffix' });
  }, 120_000);

  it('IAM-069 a content tenant may not ask, nor read what was asked', async () => {
    const content = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: org, name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Neighbour' },
      hostnames: ['neighbour.acme.alloy.test'],
    });
    await expect(
      service.withTenant(content, (trx) =>
        requestTenant(trx, { name: 'X', label: 'x', firstAdministrator: 'a@b.test' }),
      ),
    ).rejects.toThrow(/organisation's tenant/);
    expect(await service.withTenant(content, (trx) => tenantRequests(trx))).toEqual([]);
    expect(await service.withTenant(content, (trx) => hostnameSuffix(trx))).toBeNull();
  }, 120_000);

  it('a stage stopped part-way finishes when taken again, and shows only as a request until then', async () => {
    await ask('Halfway', 'halfway');
    const request = (await maker.claim(LEASE))!;
    await maker.build(request);
    const seen = await service.withTenant(organisation, async (trx) => ({
      tenants: await organisationTenants(trx),
      requests: await tenantRequests(trx),
    }));
    expect(seen.tenants.map((each) => each.name)).not.toContain('Halfway');
    expect(seen.requests).toMatchObject([{ name: 'Halfway', state: 'waiting' }]);
    expect(await service.resolveHostname('halfway.acme.alloy.test')).toBeUndefined();
    // Its lease is over, and another run takes it from the top.
    await admin.query(
      `update platform.tenant_request set locked_until = now() - interval '1 second'`,
    );
    const { tenant } = await carryOut();
    expect(tenant.id).toBe(request.tenantId);
    expect(await service.resolveHostname('halfway.acme.alloy.test')).toMatchObject({
      id: tenant.id,
    });
  }, 120_000);

  it('gives up after its attempts, keeps no address, and says so', async () => {
    await ask('Doomed', 'doomed');
    await admin.query(`update platform.tenant_request set attempts = $1 where state = 'waiting'`, [
      REQUEST_ATTEMPTS - 1,
    ]);
    const request = (await maker.claim(LEASE))!;
    expect(await maker.giveUpIfSpent(request)).toBe(true);
    const { rows } = await admin.query(
      `select state, first_administrator from platform.tenant_request where id = $1`,
      [request.id],
    );
    expect(rows).toEqual([{ state: 'failed', first_administrator: null }]);
    const listed = await service.withTenant(organisation, (trx) => tenantRequests(trx));
    expect(listed).toMatchObject([{ name: 'Doomed', state: 'failed' }]);
  });

  it("TL-P the operator asks for an organisation's own tenant, which holds the starter role", async () => {
    await maker.requestOrganisation({
      organisation: { id: 'initech', name: 'Initech' },
      tenantId: db.newTenantId(),
      hostname: 'org.initech.alloy.test',
      suffix: '.initech.alloy.test',
      firstAdministrator: 'grace@initech.test',
      google: true,
    });
    const { tenant } = await carryOut();
    expect(await service.resolveHostname('org.initech.alloy.test')).toMatchObject({
      kind: 'organisation',
    });
    await service.withTenant(tenant, async (trx) => {
      const roles = await trx.selectFrom('role').select(['name', 'permissions']).execute();
      expect(roles.find((role) => role.name === 'Organisation administrator')?.permissions).toEqual(
        expect.arrayContaining(['create_tenant', 'share_provider', 'suspend_tenant']),
      );
      expect(roles.find((role) => role.name === 'Administrator')?.permissions).toEqual(
        expect.arrayContaining(['create_tenant', 'share_provider', 'suspend_tenant']),
      );
      const { rows } = await sql<{ route: string }>`select route from sign_in_route`.execute(trx);
      expect(rows).toEqual([{ route: 'google' }]);
      expect(await hostnameSuffix(trx)).toBe('.initech.alloy.test');
    });
  }, 120_000);

  describe("what the operator's request refuses, and what comes of a failure (the final review)", () => {
    const asking = (over: object = {}) => ({
      organisation: { id: 'wayne', name: 'Wayne' },
      tenantId: db.newTenantId(),
      hostname: 'org.wayne.alloy.test',
      suffix: '.wayne.alloy.test',
      firstAdministrator: 'grace@wayne.test',
      google: false,
      ...over,
    });

    it('refuses an existing tenant by id, and takes nothing over', async () => {
      await expect(
        maker.requestOrganisation(
          asking({ tenantId: organisation.id, hostname: 'a.wayne.alloy.test' }),
        ),
      ).rejects.toMatchObject({ refused: 'tenant_exists' });
      expect(await maker.claim(LEASE)).toBeUndefined();
    });

    it('refuses an address already taken, leaving the suffix as it was', async () => {
      await expect(
        maker.requestOrganisation(
          asking({
            hostname: 'org.acme.alloy.test',
            organisation: { id: org, name: 'Acme' },
            suffix: '.other.alloy.test',
          }),
        ),
      ).rejects.toMatchObject({ refused: 'address_taken' });
      const { rows } = await admin.query(
        'select hostname_suffix from platform.organisation where id = $1',
        [org],
      );
      expect(rows).toEqual([{ hostname_suffix: '.acme.alloy.test' }]);
    });

    it('refuses a second organisation tenant, and another suffix for an organisation with one', async () => {
      await expect(
        maker.requestOrganisation(
          asking({
            organisation: { id: org, name: 'Acme' },
            hostname: 'two.acme.alloy.test',
            suffix: '.acme.alloy.test',
          }),
        ),
      ).rejects.toMatchObject({ refused: 'organisation_has_one' });
    });

    it('a build refuses a request naming a tenant of another organisation or kind', async () => {
      await admin.query(
        `insert into platform.tenant_request
           (organisation_id, tenant_id, name, hostname, kind, requested_by)
         values ($1, $2, 'Forged', 'forged.acme.alloy.test', 'organisation', 'operator')`,
        [org, organisation.id],
      );
      const request = (await maker.claim(LEASE))!;
      await expect(maker.build({ ...request, organisationId: 'wayne' })).rejects.toThrow(/another/);
      await admin.query('delete from platform.tenant_request where id = $1', [request.id]);
    });

    it("a tenant still being made is no sweep's, and a failed one is told apart from a finished one", async () => {
      await ask('Unready', 'unready');
      const request = (await maker.claim(LEASE))!;
      await provisionTenant(db.adminUrl, {
        organisation: { id: org, name: 'Acme' },
        tenant: { id: request.tenantId, name: 'Unready' },
        hostnames: [],
      });
      const live = await service.liveTenants();
      expect(live.map((each) => each.id)).not.toContain(request.tenantId);

      // Answered with a shorter lease, so a failure is tried again in minutes, not half an hour.
      expect(await maker.giveUpIfSpent(request)).toBe(false);
      const { rows } = await admin.query(
        `select locked_until < now() + interval '10 minutes' as soon from platform.tenant_request where id = $1`,
        [request.id],
      );
      expect(rows).toEqual([{ soon: true }]);

      await admin.query(`update platform.tenant_request set locked_until = null where id = $1`, [
        request.id,
      ]);
      const again = (await maker.claim(LEASE))!;
      const tenant = await maker.build(again);
      await maker.invite(again, tenant);
      await maker.finish(again, tenant);
      expect((await service.liveTenants()).map((each) => each.id)).toContain(request.tenantId);

      // Finished, it cannot be failed by a run that had lost its lease.
      expect(await maker.giveUpIfSpent({ ...again, attempts: REQUEST_ATTEMPTS })).toBe(false);
      const { rows: state } = await admin.query(
        'select state from platform.tenant_request where id = $1',
        [request.id],
      );
      expect(state).toEqual([{ state: 'done' }]);
      await expect(maker.finish(again, tenant)).rejects.toThrow(/no longer/);
    }, 120_000);

    it('the operator can try a failed request again, naming who to invite', async () => {
      const { rows } = await admin.query<{ tenant_id: string }>(
        `select tenant_id from platform.tenant_request where state = 'failed' limit 1`,
      );
      const id = rows[0]!.tenant_id;
      expect(await maker.retry(id, 'ada@example.test')).toBe(true);
      expect(await maker.retry('nothing', undefined)).toBe(false);
      const taken = (await maker.claim(LEASE))!;
      expect(taken).toMatchObject({
        tenantId: id,
        firstAdministrator: 'ada@example.test',
        attempts: 1,
      });
      await admin.query(
        `update platform.tenant_request set state = 'failed', first_administrator = null where tenant_id = $1`,
        [id],
      );
    });
  });

  describe('a shared provider (TL-M)', () => {
    let target: Tenant;
    let provider = '';

    beforeAll(async () => {
      await ask('Sales', 'sales');
      target = (await carryOut()).tenant;
      const added = await service.withTenant(organisation, (trx) =>
        addProvider(trx, {
          name: 'Acme staff',
          issuer: 'https://id.acme.test',
          clientId: 'alloy',
          sealedSecret: sealSecret(KEY, 'sign-in', organisation.id, 'sealed-in-the-organisation'),
        }),
      );
      provider = (added as { id: string }).id;
    }, 120_000);

    const copy = async () => {
      const family = await maker.family(org);
      return copySharedProviders(steward, KEY, family.organisation!, family.tenants);
    };
    const copied = () =>
      service.withTenant(target, (trx) =>
        trx
          .selectFrom('identity_provider')
          .selectAll()
          .where('issuer', '=', 'https://id.acme.test')
          .executeTakeFirst(),
      );

    it('IAM-085 copies it into each tenant, its secret resealed for that tenant', async () => {
      expect(await service.withTenant(organisation, (trx) => hasSharedProvider(trx))).toBe(false);
      expect(
        await service.withTenant(organisation, (trx) => markProviderShared(trx, provider, true)),
      ).toBe(true);
      expect(await service.withTenant(organisation, (trx) => hasSharedProvider(trx))).toBe(true);
      await copy();
      const row = (await copied())!;
      expect(row).toMatchObject({
        name: 'Acme staff',
        managed_by_organisation: true,
        closed_at: null,
      });
      expect(openSecret(KEY, 'sign-in', target.id, row.sealed_secret!)).toBe(
        'sealed-in-the-organisation',
      );
      expect(() => openSecret(KEY, 'sign-in', organisation.id, row.sealed_secret!)).toThrow();
      await service.withTenant(target, async (trx) => {
        const { rows } = await sql<{ actor_kind: string }>`
          select actor_kind from audit_event
           where kind = 'sign_in.configured' and detail ->> 'change' = 'provider_copied'`.execute(
          trx,
        );
        expect(rows).toEqual([{ actor_kind: 'organisation' }]);
      });
    });

    it('IAM-085 a tenant may close its copy and may not edit it, and closed it stays', async () => {
      const row = (await copied())!;
      expect(
        await service.withTenant(target, (trx) =>
          changeProvider(trx, row.id, { name: 'Ours now' }),
        ),
      ).toBe('provider.managed');
      await service.withTenant(organisation, (trx) =>
        changeProvider(trx, provider, { name: 'Acme people' }),
      );
      await service.withTenant(target, (trx) =>
        sql`insert into principal (issuer, subject, display_name)
            values ('https://other.test', 'keeps-a-way-in', 'Ada')`.execute(trx),
      );
      await admin.query(
        `insert into ${target.schema}.sign_in_route (route) values ('google') on conflict do nothing`,
      );
      await service.withTenant(target, (trx) => closeProviderAsked(trx, row.id));
      await copy();
      expect(await copied()).toMatchObject({ name: 'Acme people' });
      expect((await copied())!.closed_at).not.toBeNull();
    });

    it("IAM-085 leaves a tenant's own provider of that issuer as its own", async () => {
      await ask('Own', 'own');
      const own = (await carryOut()).tenant;
      await service.withTenant(own, (trx) =>
        trx.deleteFrom('identity_provider').where('issuer', '=', 'https://id.acme.test').execute(),
      );
      await service.withTenant(own, (trx) =>
        addProvider(trx, {
          name: 'Ours',
          issuer: 'https://id.acme.test',
          clientId: 'theirs',
          sealedSecret: sealSecret(KEY, 'sign-in', own.id, 'theirs'),
        }),
      );
      expect((await copy()).passedOver).toBeGreaterThan(0);
      const held = await service.withTenant(own, (trx) =>
        trx
          .selectFrom('identity_provider')
          .selectAll()
          .where('issuer', '=', 'https://id.acme.test')
          .executeTakeFirstOrThrow(),
      );
      expect(held).toMatchObject({ client_id: 'theirs', managed_by_organisation: false });
    }, 120_000);

    it('IAM-085 SCIM may not be turned on for a copy, and no secret means nothing to share', async () => {
      const row = (await copied())!;
      const by = (
        await service.withTenant(target, (trx) =>
          trx.selectFrom('principal').select('id').executeTakeFirstOrThrow(),
        )
      ).id;
      expect(await service.withTenant(target, (trx) => turnScimOn(trx, row.id, 'sub', by))).toBe(
        'provider.managed',
      );
    });

    it('IAM-085 a copy whose name another provider has takes rotations under the name it has', async () => {
      await admin.query(
        `update ${target.schema}.identity_provider set name = 'Kept here' where issuer = 'https://id.acme.test'`,
      );
      await service.withTenant(target, (trx) =>
        addProvider(trx, {
          name: 'Acme people',
          issuer: 'https://taken-the-name.test',
          clientId: 'x',
          sealedSecret: sealSecret(KEY, 'sign-in', target.id, 'x'),
        }),
      );
      await service.withTenant(organisation, async (trx) => {
        await sql`update identity_provider
                     set sealed_secret = ${sealSecret(KEY, 'sign-in', organisation.id, 'rotated')}
                   where id = ${provider}`.execute(trx);
      });
      await copy();
      const row = (await copied())!;
      expect(row.name).toBe('Kept here');
      expect(openSecret(KEY, 'sign-in', target.id, row.sealed_secret!)).toBe('rotated');
    });

    it('IAM-085 no longer shared, each tenant keeps it as its own to close', async () => {
      await service.withTenant(organisation, (trx) => markProviderShared(trx, provider, false));
      await copy();
      expect(await copied()).toMatchObject({ managed_by_organisation: false });
      expect((await copied())!.sealed_secret).not.toBeNull();
    });
  });
});
