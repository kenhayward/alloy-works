import {
  addProvider,
  advanceClosure,
  bootstrapCluster,
  createJobQueue,
  createStewardDatabase,
  createTenant,
  createTenantDatabase,
  createTenantMaker,
  markProviderShared,
  migrate,
  PURGE_WAIT_MS,
  startClosing,
  openSecret,
  requestTenant,
  sealSecret,
  type JobQueue,
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
import {
  createObjectStores,
  setUpTenantStore,
  storeForPurging,
  type ObjectStores,
} from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  processNextProviderCopy,
  processNextRequest,
  type MakingDeps,
} from './jobs/tenant-create.js';
import { processNextPurge } from './jobs/tenant-purge.js';
import { runSteward } from './steward-commands.js';

const errors: { details: object; message: string }[] = [];
const log = {
  info: () => undefined,
  error: (details: object, message: string) => void errors.push({ details, message }),
};

describe("the steward's making of tenants (the TL plan, TLe)", () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let stores: ObjectStores;
  let service: TenantDatabase;
  let tenants: TenantDatabase;
  let steward: StewardDatabase;
  let maker: TenantMaker;
  let queue: JobQueue;
  let organisation: Tenant;
  let deps: MakingDeps;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    store = await testObjectStore();
    stores = createObjectStores(store.settings, store.sealingKey);
    service = testTenantDatabase(db.serviceUrl);
    tenants = createTenantDatabase(db.stewardUrl);
    steward = createStewardDatabase(db.stewardUrl);
    maker = createTenantMaker(db.stewardUrl);
    queue = createJobQueue(db.stewardUrl);
    deps = {
      maker,
      db: tenants,
      queue,
      sealingKey: store.sealingKey,
      setUpStore: (tenant) =>
        setUpTenantStore({
          settings: store.settings,
          admin: store.admin,
          sealingKey: store.sealingKey,
          adminUrl: db.stewardUrl,
          tenant,
        }),
      workerId: 'steward-test',
      leaseMs: 60_000,
      log,
    };
    organisation = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Acme' },
      hostnames: ['org.acme.alloy.test'],
      kind: 'organisation',
    });
    await queryAs(
      db.adminUrl,
      `update platform.organisation set hostname_suffix = '.acme.alloy.test'`,
    );
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await maker?.close();
    await steward?.close();
    await tenants?.close();
    await service?.close();
    await db?.drop();
  });

  it('IAM-085 a tenant created from the console arrives with the shared provider, its store and its invitation', async () => {
    const added = await service.withTenant(organisation, (trx) =>
      addProvider(trx, {
        name: 'Acme staff',
        issuer: 'https://id.acme.test',
        clientId: 'alloy',
        sealedSecret: sealSecret(store.sealingKey, 'sign-in', organisation.id, 'kept-sealed'),
      }),
    );
    const provider = (added as { id: string }).id;
    await service.withTenant(organisation, (trx) => markProviderShared(trx, provider, true));
    await service.withTenant(organisation, (trx) =>
      requestTenant(trx, { name: 'Legal', label: 'legal', firstAdministrator: 'ada@example.test' }),
    );

    expect(await processNextRequest(deps)).toBe('done');

    const made = (await service.resolveHostname('legal.acme.alloy.test'))!;
    const copies = await service.withTenant(made, (trx) =>
      trx.selectFrom('identity_provider').selectAll().execute(),
    );
    expect(copies).toMatchObject([
      { issuer: 'https://id.acme.test', managed_by_organisation: true },
    ]);
    expect(openSecret(store.sealingKey, 'sign-in', made.id, copies[0]!.sealed_secret!)).toBe(
      'kept-sealed',
    );
    // The invitation names the copy as a way to claim it, which is what IAM-059 asks of a route.
    const ways = await service.withTenant(made, (trx) =>
      trx
        .selectFrom('invitation_provider')
        .innerJoin('invitation', 'invitation.id', 'invitation_provider.invitation_id')
        .select(['invitation.email', 'invitation_provider.provider_id'])
        .execute(),
    );
    expect(ways).toEqual([{ email: 'ada@example.test', provider_id: copies[0]!.id }]);
    // It holds a store of its own, which it can write to.
    const own = await service.withTenant(made, (trx) => stores.forTenant(trx, made));
    await own.put(Buffer.from('hello'), 'text/plain');
  }, 120_000);

  it('IAM-085 a job brings the copies current when the organisation changes one', async () => {
    const queued = await processNextProviderCopy(deps);
    expect(queued).toBe('done');
    expect(await processNextProviderCopy(deps)).toBe('idle');
  });

  it('logs a reason, never a message, when making one fails, and tries again', async () => {
    errors.length = 0;
    await service.withTenant(organisation, (trx) =>
      requestTenant(trx, {
        name: 'Broken',
        label: 'broken',
        firstAdministrator: 'grace@example.test',
      }),
    );
    const failing: MakingDeps = {
      ...deps,
      setUpStore: () => Promise.reject(new Error('grace@example.test could not be set up')),
    };
    expect(await processNextRequest(failing)).toBe('retry');
    expect(JSON.stringify(errors)).not.toContain('grace@example.test');
    await queryAs(db.adminUrl, `update platform.tenant_request set locked_until = null`);
    expect(await processNextRequest(deps)).toBe('done');
  }, 120_000);

  it('TL-P the operator asks for an organisation at the command line, which refuses what is taken', async () => {
    const said: string[] = [];
    const run = (argv: string[]) =>
      runSteward(argv, { db: tenants, steward, maker, out: (line) => said.push(line) });
    const asking = [
      'organisation',
      '--id',
      'initech',
      '--name',
      'Initech',
      '--tenant',
      db.newTenantId(),
      '--hostname',
      'org.initech.alloy.test',
      '--suffix',
      '.initech.alloy.test',
      '--first-administrator',
      'grace@initech.test',
      '--google',
    ];
    expect(await run(asking)).toBe(0);
    expect(await processNextRequest(deps)).toBe('done');
    expect(await service.resolveHostname('org.initech.alloy.test')).toMatchObject({
      kind: 'organisation',
    });
    expect(await run(asking)).toBe(1);
    expect(await run(['organisation', '--id', 'x'])).toBe(2);
  }, 120_000);

  it('IAM-086 a tenant made from the console, written to, closed and purged leaves only its record, and the next is made', async () => {
    await service.withTenant(organisation, (trx) =>
      requestTenant(trx, { name: 'Brief', label: 'brief', firstAdministrator: 'ada@example.test' }),
    );
    expect(await processNextRequest(deps)).toBe('done');
    const made = (await service.resolveHostname('brief.acme.alloy.test'))!;
    const own = await service.withTenant(made, (trx) => stores.forTenant(trx, made));
    const stored = await own.put(Buffer.from('written'), 'text/plain');
    expect(stored.key).toBeTruthy();

    await tenants.withTenant(made, (trx) => startClosing(trx, made, { declined: true }), {
      actorKind: 'vendor',
    });
    await queryAs(
      db.adminUrl,
      `update platform.tenant set grace_ends_at = now() - interval '1 minute' where id = $1`,
      [made.id],
    );
    const worker = testTenantDatabase(db.workerUrl);
    await worker.withTenant(made, (trx) => advanceClosure(trx, made), { actorKind: 'system' });
    await worker.close();
    const purging = {
      queue,
      steward,
      store: storeForPurging(store.settings, store.admin),
      workerId: 'steward-test',
      leaseMs: 60_000,
      log,
      now: () => Date.now() + PURGE_WAIT_MS + 1000,
    };
    expect(await processNextPurge(purging)).toBe('done');
    expect(await steward.record(made.id)).toMatchObject({
      state: 'deleted',
      report: { schemaPresent: false, roles: 0, objects: 0, credentialPresent: false },
    });
    const { rows } = await queryAs(
      db.adminUrl,
      'select 1 from platform.tenant_request where tenant_id = $1',
      [made.id],
    );
    expect(rows).toEqual([]);
    await migrate(db.migratorUrl);

    await service.withTenant(organisation, (trx) =>
      requestTenant(trx, { name: 'Next', label: 'brief', firstAdministrator: 'ada@example.test' }),
    );
    expect(await processNextRequest(deps)).toBe('done');
    expect((await service.resolveHostname('brief.acme.alloy.test'))?.id).not.toBe(made.id);
  }, 120_000);
});
