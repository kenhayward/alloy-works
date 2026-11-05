import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  cancelClosing,
  cancelClosureFromOrganisation,
  liftFromOrganisation,
  organisationTenants,
  resumeTenant,
  startClosing,
  suspendFromOrganisation,
  suspendTenant,
  TenantStateRefused,
} from './tenant-lifecycle.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const OPERATOR = { actorKind: 'vendor' } as const;

describe("an organisation's tenant (the TL plan, TLd)", () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let steward: TenantDatabase;
  let organisation: Tenant;
  let ada = '';
  let round = 0;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    service = testTenantDatabase(db.serviceUrl);
    steward = createTenantDatabase(db.stewardUrl);
    organisation = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Acme' },
      hostnames: ['org.acme.alloy.test'],
      kind: 'organisation',
    });
    ada = (
      await service.withTenant(organisation, (trx) =>
        trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      )
    ).id;
  }, 120_000);

  afterAll(async () => {
    await steward?.close();
    await service?.close();
    await db?.drop();
  });

  const content = async (org = 'acme') => {
    round += 1;
    const id = db.newTenantId();
    return createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: org, name: org },
      tenant: { id, name: `Tenant ${round}` },
      hostnames: [`${id}.alloy.test`],
    });
  };
  const fromOrganisation = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(organisation, work, { actorKind: 'person', actor: ada });
  const inTenant = <T>(tenant: Tenant, work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'system' });
  const stateOf = async (tenant: Tenant) =>
    (await queryAs(db.adminUrl, `select state from platform.tenant where id = $1`, [tenant.id]))
      .rows[0].state as string;
  const events = (
    tenant: Tenant,
    kind: string,
  ): Promise<
    readonly { detail: Record<string, unknown>; actor_kind: string; actor: string | null }[]
  > =>
    service
      .withTenant(tenant, (trx) =>
        sql<{ detail: Record<string, unknown>; actor_kind: string; actor: string | null }>`
          select detail, actor_kind, actor from audit_event where kind = ${kind}
           order by sequence`.execute(trx),
      )
      .then(({ rows }) => rows);

  it('IAM-069 shows an organisation its own tenants, as metadata, and nobody else any', async () => {
    const mine = await content();
    const other = await content('elsewhere');
    const listed = await fromOrganisation((trx) => organisationTenants(trx));
    expect(listed.map((each) => each.id)).toContain(mine.id);
    expect(listed.map((each) => each.id)).not.toContain(other.id);
    expect(listed.map((each) => each.id)).not.toContain(organisation.id);
    expect(Object.keys(listed[0]!).sort()).toEqual([
      'closingBy',
      'graceEndsAt',
      'hostnames',
      'id',
      'name',
      'since',
      'state',
      'suspendedBy',
    ]);
    // A content tenant asking sees nothing of its siblings.
    expect(await inTenant(mine, (trx) => organisationTenants(trx))).toEqual([]);
  });

  it('IAM-069 reads none of a sibling by its table, whatever its role is asked', async () => {
    const mine = await content();
    await expect(
      fromOrganisation((trx) => sql`select * from ${sql.id(mine.schema, 'profile')}`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it("IAM-068 suspends a tenant in both logs, naming the person in the organisation's alone", async () => {
    const mine = await content();
    expect(
      await fromOrganisation((trx) => suspendFromOrganisation(trx, mine.id, 'An incident')),
    ).toBe('done');
    expect(await stateOf(mine)).toBe('suspended');

    const inOrganisation = (await events(organisation, 'organisation.changed')).filter(
      (each) => each.detail['tenant'] === mine.id,
    );
    expect(inOrganisation).toMatchObject([
      {
        actor_kind: 'person',
        actor: ada,
        detail: { change: 'suspended', by: 'organisation', reason: 'An incident' },
      },
    ]);
    const inTarget = await events(mine, 'tenant.suspended');
    expect(inTarget).toMatchObject([
      { actor_kind: 'organisation', actor: null, detail: { reason: 'An incident' } },
    ]);
    expect(inTarget[0]!.detail['organisationEvent']).toEqual(expect.any(String));
    expect(JSON.stringify(inTarget)).not.toContain(ada);
  });

  it('IAM-068 writes both logs or neither, and changes nothing when the second is refused', async () => {
    const mine = await content();
    await queryAs(
      db.adminUrl,
      `alter table ${mine.schema}.audit_event
         add constraint refuse_for_this_test check (kind <> 'tenant.suspended') not valid`,
    );
    await expect(
      fromOrganisation((trx) => suspendFromOrganisation(trx, mine.id, 'An incident')),
    ).rejects.toThrow();
    expect(await stateOf(mine)).toBe('active');
    const inOrganisation = (await events(organisation, 'organisation.changed')).filter(
      (each) => each.detail['tenant'] === mine.id,
    );
    expect(inOrganisation).toEqual([]);
  });

  it('ADM-028 lifts from the organisation what nobody inside could, with the time given back', async () => {
    const mine = await content();
    await fromOrganisation((trx) => suspendFromOrganisation(trx, mine.id, 'An incident'));
    await expect(
      inTenant(mine, (trx) =>
        sql`
      select platform.change_tenant_state(${mine.id}, 'active', null)`.execute(trx),
      ),
    ).rejects.toThrow(/may not change/);
    expect(await fromOrganisation((trx) => liftFromOrganisation(trx, mine.id))).toBe('done');
    expect(await stateOf(mine)).toBe('active');
    expect(await events(mine, 'tenant.resumed')).toMatchObject([
      { actor_kind: 'organisation', detail: { suspendedSeconds: expect.any(Number) } },
    ]);
  });

  it("IAM-069 answers an unknown tenant, or another organisation's, as missing", async () => {
    const other = await content('elsewhere');
    expect(await fromOrganisation((trx) => suspendFromOrganisation(trx, other.id, 'No'))).toBe(
      'missing',
    );
    expect(await fromOrganisation((trx) => liftFromOrganisation(trx, 'nobody'))).toBe('missing');
    expect(await stateOf(other)).toBe('active');
  });

  it('ADM-028 refuses a tenant suspending itself where no organisation could lift it', async () => {
    const alone = await content('alone');
    await expect(
      inTenant(alone, (trx) => suspendTenant(trx, alone, 'An incident')),
    ).rejects.toBeInstanceOf(TenantStateRefused);
    expect(await stateOf(alone)).toBe('active');
    const mine = await content();
    await inTenant(mine, (trx) => suspendTenant(trx, mine, 'An incident'));
    expect(await stateOf(mine)).toBe('suspended');
  });

  it("IAM-068 keeps in the organisation's log a closure begun inside a tenant, naming nobody", async () => {
    const mine = await content();
    await service.withTenant(mine, (trx) => startClosing(trx, mine, { declined: true }), {
      actorKind: 'system',
    });
    expect(
      (await events(organisation, 'organisation.changed')).filter(
        (each) => each.detail['tenant'] === mine.id,
      ),
    ).toMatchObject([{ actor_kind: 'system', actor: null, detail: { change: 'closing' } }]);
    await inTenant(mine, (trx) => cancelClosing(trx, mine));
    expect(
      (await events(organisation, 'organisation.changed')).filter(
        (each) => each.detail['tenant'] === mine.id,
      ),
    ).toMatchObject([
      { detail: { change: 'closing' } },
      { detail: { change: 'closure_cancelled' } },
    ]);
  });

  it("IAM-068 gives up a person's closure from the organisation, but never the operator's", async () => {
    const mine = await content();
    await inTenant(mine, (trx) => startClosing(trx, mine, { declined: true }));
    expect(await fromOrganisation((trx) => cancelClosureFromOrganisation(trx, mine.id))).toBe(
      'done',
    );
    expect(await stateOf(mine)).toBe('active');
    expect(await events(mine, 'tenant.closure_cancelled')).toMatchObject([
      { actor_kind: 'organisation' },
    ]);

    await steward.withTenant(mine, (trx) => startClosing(trx, mine, { notice: 'N' }), OPERATOR);
    await expect(
      fromOrganisation((trx) => cancelClosureFromOrganisation(trx, mine.id)),
    ).rejects.toBeInstanceOf(TenantStateRefused);
  });

  it("ADM-030 will not close an organisation's tenant while it has a tenant left", async () => {
    await expect(
      fromOrganisation((trx) => startClosing(trx, organisation, { declined: true })),
    ).rejects.toBeInstanceOf(TenantStateRefused);
    expect(await stateOf(organisation)).toBe('active');
  });

  it("ADM-030 will not close a suspended organisation's tenant while it has a tenant left", async () => {
    await steward.withTenant(
      organisation,
      (trx) => suspendTenant(trx, organisation, 'R'),
      OPERATOR,
    );
    await expect(
      steward.withTenant(
        organisation,
        (trx) => startClosing(trx, organisation, { notice: 'N' }),
        OPERATOR,
      ),
    ).rejects.toBeInstanceOf(TenantStateRefused);
    await steward.withTenant(organisation, (trx) => resumeTenant(trx, organisation), OPERATOR);
    expect(await stateOf(organisation)).toBe('active');
  });

  it("IAM-068 keeps a closure in the organisation's log while the organisation's tenant is suspended", async () => {
    const mine = await content();
    await steward.withTenant(
      organisation,
      (trx) => suspendTenant(trx, organisation, 'R'),
      OPERATOR,
    );
    await inTenant(mine, (trx) => startClosing(trx, mine, { declined: true }));
    await steward.withTenant(organisation, (trx) => resumeTenant(trx, organisation), OPERATOR);
    expect(
      (await events(organisation, 'organisation.changed')).filter(
        (each) => each.detail['tenant'] === mine.id,
      ),
    ).toMatchObject([{ detail: { change: 'closing' } }]);
  });

  it('ADM-028 refuses an organisation lifting what the operator suspended, and says it was them', async () => {
    const mine = await content();
    await steward.withTenant(mine, (trx) => suspendTenant(trx, mine, 'Non-payment'), OPERATOR);
    const listed = await fromOrganisation((trx) => organisationTenants(trx));
    expect(listed.find((each) => each.id === mine.id)?.suspendedBy).toBe('operator');
    await expect(
      fromOrganisation((trx) => liftFromOrganisation(trx, mine.id)),
    ).rejects.toBeInstanceOf(TenantStateRefused);
    // Still the operator's after a closure over it is given up.
    await steward.withTenant(mine, (trx) => startClosing(trx, mine, { notice: 'N' }), OPERATOR);
    await steward.withTenant(mine, (trx) => cancelClosing(trx, mine), OPERATOR);
    await expect(
      fromOrganisation((trx) => liftFromOrganisation(trx, mine.id)),
    ).rejects.toBeInstanceOf(TenantStateRefused);
    await steward.withTenant(mine, (trx) => resumeTenant(trx, mine), OPERATOR);

    await fromOrganisation((trx) => suspendFromOrganisation(trx, mine.id, 'An incident'));
    expect(await fromOrganisation((trx) => liftFromOrganisation(trx, mine.id))).toBe('done');
  });

  it("IAM-068 names the tenant in the organisation's log, so it is known after the tenant has gone", async () => {
    const mine = await content();
    await inTenant(mine, (trx) => startClosing(trx, mine, { declined: true }));
    await inTenant(mine, (trx) => cancelClosing(trx, mine));
    await fromOrganisation((trx) => suspendFromOrganisation(trx, mine.id, 'An incident'));
    const { rows } = await fromOrganisation((trx) =>
      sql<{ subject_kind: string; name: string | null }>`
        select e.subject_kind,
               (select l.text from audit_label l
                 where l.sequence = e.sequence and l.role = 'subject') as name
          from audit_event e
         where e.kind = 'organisation.changed' and e.detail ->> 'tenant' = ${mine.id}`.execute(trx),
    );
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        subject_kind: 'tenant',
        name: expect.stringMatching(/^Tenant /),
      });
    }
  });

  it("gives an organisation's tenant the role that holds its acts, and no other tenant", async () => {
    const roles = await service.withTenant(organisation, (trx) =>
      sql<{ name: string; permissions: string[] }>`
        select name, permissions from role
         where name in ('Organisation administrator', 'Administrator')`.execute(trx),
    );
    expect(roles.rows.map((role) => role.name).sort()).toEqual([
      'Administrator',
      'Organisation administrator',
    ]);
    for (const role of roles.rows) expect(role.permissions).toContain('suspend_tenant');
    const mine = await content();
    const theirs = await inTenant(mine, (trx) =>
      sql<{
        name: string;
      }>`select name from role where 'suspend_tenant' = any(permissions)`.execute(trx),
    );
    expect(theirs.rows).toEqual([]);
  });

  it('says which kind a tenant is as its hostname resolves', async () => {
    expect((await service.resolveHostname('org.acme.alloy.test'))?.kind).toBe('organisation');
    const mine = await content();
    expect((await service.resolveHostname(`${mine.id}.alloy.test`))?.kind).toBe('content');
  });
});
