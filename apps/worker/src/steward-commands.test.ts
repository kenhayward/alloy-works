import {
  bootstrapCluster,
  createTenant,
  createStewardDatabase,
  createTenantDatabase,
  createTenantMaker,
  migrate,
  openSecret,
  type StewardDatabase,
  type Tenant,
  type TenantDatabase,
  type TenantMaker,
} from '@alloy-works/db';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sealingKey } from '@alloy-works/objects';
import { runSteward } from './steward-commands.js';
import { sweepClosures } from './sweep.js';

const HOST = 'steward.alloy.test';

describe("the operator's command line (the TL plan, TL-P)", () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let steward: TenantDatabase;
  let service: TenantDatabase;
  let reach: StewardDatabase;
  const lines: string[] = [];
  const run = (...argv: string[]) =>
    runSteward(argv, {
      db: steward,
      steward: reach,
      maker: {} as TenantMaker,
      readSecret: () => Promise.reject(new Error('Only `provider` reads a secret')),
      key: () => {
        throw new Error('Only `provider` needs the key');
      },
      out: (line) => lines.push(line),
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    steward = createTenantDatabase(db.stewardUrl);
    service = testTenantDatabase(db.serviceUrl);
    reach = createStewardDatabase(db.stewardUrl);
  }, 120_000);

  afterAll(async () => {
    await reach?.close();
    await steward?.close();
    await service?.close();
    await db?.drop();
  });

  it('ADM-028 suspends and resumes a tenant named by its id, recording the reason', async () => {
    expect(await run('suspend', '--tenant', tenant.id, '--reason', 'Unpaid since March')).toBe(0);
    expect((await service.resolveHostname(HOST))?.state).toBe('suspended');
    const { rows } = await service.withTenant(tenant, (trx) =>
      sql<{ actor_kind: string; detail: { reason: string } }>`
        select actor_kind, detail from audit_event where kind = 'tenant.suspended'`.execute(trx),
    );
    expect(rows).toEqual([{ actor_kind: 'vendor', detail: { reason: 'Unpaid since March' } }]);

    expect(await run('resume', '--tenant', tenant.id)).toBe(0);
    expect((await service.resolveHostname(HOST))?.state).toBe('active');
  });

  it("ADM-030 closes a tenant at a contract's end with a notice, and only the operator cancels it", async () => {
    expect(await run('close', '--tenant', tenant.id)).toBe(2);
    expect(await run('close', '--tenant', tenant.id, '--notice', 'Contract 7 ended')).toBe(0);
    expect((await service.resolveHostname(HOST))?.state).toBe('closing');
    const { rows } = await service.withTenant(tenant, (trx) =>
      sql<{ actor_kind: string; detail: { notice: string } }>`
        select actor_kind, detail from audit_event where kind = 'tenant.closing'`.execute(trx),
    );
    expect(rows[0]).toMatchObject({ actor_kind: 'vendor', detail: { notice: 'Contract 7 ended' } });
    expect(await run('cancel', '--tenant', tenant.id)).toBe(0);
    expect((await service.resolveHostname(HOST))?.state).toBe('active');
  });

  it('ADM-030 begins deletion once the grace period is over, and not before', async () => {
    const worker = testTenantDatabase(db.workerUrl);
    const log = { info: () => undefined, error: () => undefined } as never;
    try {
      expect(await run('close', '--tenant', tenant.id, '--notice', 'Contract 8 ended')).toBe(0);
      expect(await sweepClosures(worker, log)).toBe(0);
      expect((await service.resolveHostname(HOST))?.state).toBe('closing');
      await queryAs(
        db.adminUrl,
        `update platform.tenant set grace_ends_at = now() - interval '1 second' where id = $1`,
        [tenant.id],
      );
      expect(await sweepClosures(worker, log)).toBe(1);
      expect((await service.resolveHostname(HOST))?.state).toBe('deleting');
    } finally {
      await queryAs(
        db.adminUrl,
        `update platform.tenant
            set state = 'active', closing_from = null, closing_by = null, grace_ends_at = null
          where id = $1`,
        [tenant.id],
      );
      await worker.close();
    }
  });

  it('IAM-087 reports where a tenant stands, with no reason in it, from the row alone', async () => {
    lines.length = 0;
    expect(await run('report', '--tenant', tenant.id)).toBe(0);
    expect(JSON.parse(lines[0]!)).toMatchObject({ id: tenant.id, state: 'active', report: null });
    expect(await run('report', '--tenant', 'nobody')).toBe(1);
  });

  it('refuses a suspension with no reason, an unknown tenant, a command it does not know and a change that does not apply', async () => {
    expect(await run('suspend', '--tenant', tenant.id)).toBe(2);
    expect(await run('suspend', '--tenant', tenant.id, '--reason', 'x'.repeat(2001))).toBe(2);
    expect(await run('suspend', '--tenant', 'nobody', '--reason', 'x')).toBe(1);
    expect(await run('drop', '--tenant', tenant.id)).toBe(2);
    expect(await run('resume', '--tenant', tenant.id)).toBe(1);
    expect(lines.join('\n')).toMatch(/is active/);
    expect((await service.resolveHostname(HOST))?.state).toBe('active');
  });

  describe('a first way in through any provider (the SP plan)', () => {
    const KEY = sealingKey(Buffer.alloc(32, 7).toString('base64'));
    const SECRET = 'not-a-real-secret-1234';
    const ISSUER = 'https://idp.example/realms/first';
    let maker: TenantMaker;
    const said: string[] = [];
    const provider = (secret: string, ...argv: string[]) =>
      runSteward(['provider', ...argv], {
        db: steward,
        steward: reach,
        maker,
        out: (line) => said.push(line),
        readSecret: () => Promise.resolve(secret),
        key: () => KEY,
      });
    const made = (kind: 'content' | 'organisation') =>
      createTenant(db.adminUrl, db.migratorUrl, {
        // An organisation has one tenant of its own, so each here is another's.
        organisation: { id: `org${Math.random().toString(36).slice(2)}`, name: 'First' },
        tenant: { id: db.newTenantId(), name: kind },
        hostnames: [`${kind}${Math.random().toString(36).slice(2)}.alloy.test`],
        kind,
      });
    const providers = (where: Tenant) =>
      service.withTenant(where, (trx) =>
        trx
          .selectFrom('identity_provider')
          .select(['issuer', 'client_id', 'name', 'sealed_secret'])
          .execute(),
      );

    beforeAll(() => {
      maker = createTenantMaker(db.stewardUrl);
    });
    afterAll(async () => {
      await maker.close();
    });

    const INVITE = ['--first-administrator', 'ada@example.com'];
    const opened = (where: Tenant, sealed: string | null) =>
      openSecret(KEY, 'sign-in', where.id, sealed!);

    it('configures a sealed provider and opens the route, printing no secret, and audits as the vendor', async () => {
      const organisation = await made('organisation');
      said.length = 0;
      expect(
        await provider(
          `${SECRET}\r\n`,
          '--tenant',
          organisation.id,
          '--issuer',
          ISSUER,
          '--client-id',
          'alloy',
          '--name',
          'First sign-in',
          ...INVITE,
        ),
      ).toBe(0);
      const [held] = await providers(organisation);
      expect(held).toMatchObject({ issuer: ISSUER, client_id: 'alloy', name: 'First sign-in' });
      expect(opened(organisation, held!.sealed_secret)).toBe(SECRET);
      expect(JSON.stringify(said)).not.toContain(SECRET);
      const { route, event, waiting } = await service.withTenant(organisation, async (trx) => ({
        route: await trx.selectFrom('sign_in_route').select('route').execute(),
        event: await trx
          .selectFrom('audit_event')
          .select('actor_kind')
          .where('kind', '=', 'sign_in_route.configured')
          .executeTakeFirst(),
        waiting: await trx.selectFrom('invitation').select('email').execute(),
      }));
      expect(route).toContainEqual({ route: 'organisation' });
      expect(event).toEqual({ actor_kind: 'vendor' });
      expect(waiting).toEqual([{ email: 'ada@example.com' }]);
    });

    it('corrects a mistake in place before anybody holds access, the invitation staying with the one provider', async () => {
      const organisation = await made('organisation');
      const args = ['--tenant', organisation.id, '--client-id', 'alloy'];
      expect(await provider('first-try', ...args, '--issuer', ISSUER, ...INVITE)).toBe(0);
      const other = 'https://idp.example/realms/second';
      expect(await provider(SECRET, ...args, '--issuer', other, '--name', 'Second')).toBe(0);
      const held = await providers(organisation);
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({ issuer: other, name: 'Second' });
      expect(opened(organisation, held[0]!.sealed_secret)).toBe(SECRET);
    });

    it('is not stopped by somebody who signed in and holds nothing', async () => {
      const organisation = await made('organisation');
      await service.withTenant(organisation, (trx) =>
        trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'stray', kind: 'user' } as never)
          .execute(),
      );
      const args = ['--tenant', organisation.id, '--issuer', ISSUER, '--client-id', 'alloy'];
      expect(await provider(SECRET, ...args, ...INVITE)).toBe(0);
    });

    it('refuses once somebody who signed in holds access, changing nothing', async () => {
      const organisation = await made('organisation');
      const args = ['--tenant', organisation.id, '--issuer', ISSUER, '--client-id', 'alloy'];
      expect(await provider(SECRET, ...args, ...INVITE)).toBe(0);
      await service.withTenant(organisation, async (trx) => {
        const person = await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'ada', kind: 'user' } as never)
          .returning('id')
          .executeTakeFirstOrThrow();
        const role = await trx
          .selectFrom('role')
          .select('id')
          .where('name', '=', 'Reader')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('access_grant')
          .values({
            principal_id: person.id,
            role_id: role.id,
            level: 'tenant',
            effect: 'allow',
            granted_by: person.id,
          })
          .execute();
      });
      said.length = 0;
      expect(await provider('takeover', ...args)).toBe(1);
      expect(said.join()).toMatch(/signed in/);
      const after = await providers(organisation);
      expect(opened(organisation, after[0]!.sealed_secret)).toBe(SECRET);
    });

    it('refuses where nobody is invited, unless it is told whom to invite', async () => {
      const organisation = await made('organisation');
      const args = ['--tenant', organisation.id, '--issuer', ISSUER, '--client-id', 'alloy'];
      said.length = 0;
      expect(await provider(SECRET, ...args)).toBe(1);
      expect(said.join()).toMatch(/--first-administrator/);
      expect(await providers(organisation)).toEqual([]);
      expect(await provider(SECRET, ...args, ...INVITE)).toBe(0);
    });

    it('refuses a content tenant, an unknown tenant and a suspended one', async () => {
      const args = ['--issuer', ISSUER, '--client-id', 'alloy', ...INVITE];
      const content = await made('content');
      expect(await provider(SECRET, '--tenant', content.id, ...args)).toBe(1);
      expect(await providers(content)).toEqual([]);
      expect(await provider(SECRET, '--tenant', 'nobody', ...args)).toBe(1);
      const suspended = await made('organisation');
      await run('suspend', '--tenant', suspended.id, '--reason', 'Testing');
      expect(await provider(SECRET, '--tenant', suspended.id, ...args)).toBe(1);
      expect(await providers(suspended)).toEqual([]);
    });

    it('understands no missing or malformed argument, and asks for no secret then', async () => {
      const organisation = await made('organisation');
      const reading = { count: 0 };
      const asked = (...argv: string[]) =>
        runSteward(['provider', '--tenant', organisation.id, ...argv], {
          db: steward,
          steward: reach,
          maker,
          out: () => undefined,
          readSecret: () => {
            reading.count += 1;
            return Promise.resolve(SECRET);
          },
          key: () => KEY,
        });
      const good = ['--issuer', ISSUER, '--client-id', 'alloy'];
      expect(await asked('--client-id', 'alloy')).toBe(2);
      expect(await asked('--issuer', ISSUER)).toBe(2);
      expect(await asked('--issuer', 'ftp://x', '--client-id', 'a')).toBe(2);
      expect(await asked(...good, '--name', ' padded ')).toBe(2);
      expect(await asked(...good, '--name', 'x'.repeat(81))).toBe(2);
      expect(await asked(...good, '--first-administrator', 'nobody')).toBe(2);
      expect(reading.count).toBe(0);
    });

    it('refuses no secret at all', async () => {
      const organisation = await made('organisation');
      const args = ['--tenant', organisation.id, '--issuer', ISSUER, '--client-id', 'alloy'];
      expect(await provider('\r\n', ...args, ...INVITE)).toBe(1);
      expect(await providers(organisation)).toEqual([]);
    });

    it('says only a code when the store refuses, however it refuses', async () => {
      said.length = 0;
      const failing = {
        firstProvider: () =>
          Promise.reject(
            Object.assign(new Error(`Failing row contains ${SECRET}`), { code: '23514' }),
          ),
      } as unknown as TenantMaker;
      const answer = await runSteward(
        ['provider', '--tenant', 'x', '--issuer', ISSUER, '--client-id', 'a'],
        {
          db: steward,
          steward: reach,
          maker: failing,
          out: (line) => said.push(line),
          readSecret: () => Promise.resolve(SECRET),
          key: () => KEY,
        },
      );
      expect(answer).toBe(1);
      expect(said.join()).toContain('23514');
      expect(said.join()).not.toContain(SECRET);
    });
  });
});
