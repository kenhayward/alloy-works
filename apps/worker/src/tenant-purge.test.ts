import { readFileSync } from 'node:fs';
import {
  advanceClosure,
  bootstrapCluster,
  createJobQueue,
  createStewardDatabase,
  createTenant,
  createTenantDatabase,
  migrate,
  PURGE_WAIT_MS,
  startClosing,
  type JobQueue,
  type StewardDatabase,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { createObjectStores, storeForPurging, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import {
  DELETION_DAYS,
  GRACE_DAYS,
  TENANT_EFFECT_CAPABILITIES,
  TENANT_STATE_EFFECTS,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  processNextPurge,
  sweepStuckPurges,
  type PurgeDelivered,
  type PurgeStore,
} from './jobs/tenant-purge.js';

const quiet = { info: () => undefined, error: () => undefined };

describe('deleting a tenant (the TL plan, TLc)', () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let stores: ObjectStores;
  let steward: StewardDatabase;
  let operator: TenantDatabase;
  let worker: TenantDatabase;
  let service: TenantDatabase;
  let queue: JobQueue;
  let purging: PurgeStore;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    store = await testObjectStore();
    stores = createObjectStores(store.settings, store.sealingKey);
    steward = createStewardDatabase(db.stewardUrl);
    operator = createTenantDatabase(db.stewardUrl);
    worker = testTenantDatabase(db.workerUrl);
    service = testTenantDatabase(db.serviceUrl);
    queue = createJobQueue(db.stewardUrl);
    purging = storeForPurging(store.settings, store.admin);
  }, 120_000);

  afterAll(async () => {
    await queue?.close();
    await service?.close();
    await worker?.close();
    await operator?.close();
    await steward?.close();
    await store?.drop();
    await db?.drop();
  });

  const admin = (text: string, values: unknown[] = []) => queryAs(db.adminUrl, text, values);

  const makeTenant = async (id = db.newTenantId()) => {
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
    await store.setUp(db.adminUrl, tenant);
    return tenant;
  };
  const stored = async (tenant: Tenant) => {
    const opened = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    return opened.put(new TextEncoder().encode(`bytes of ${tenant.id}`), 'text/plain');
  };
  const advance = (tenant: Tenant) =>
    worker.withTenant(tenant, (trx) => advanceClosure(trx, tenant), { actorKind: 'system' });
  const close = (tenant: Tenant) =>
    operator.withTenant(tenant, (trx) => startClosing(trx, tenant, { notice: 'Ended' }), {
      actorKind: 'vendor',
    });
  /** The tenant's clock, moved as though so many days had gone since it closed. */
  const closedDaysAgo = (tenant: Tenant, days: number) =>
    admin(
      `update platform.tenant
          set state_since = now() - make_interval(days => $1),
              grace_ends_at = now() - make_interval(days => $1 - 30)
        where id = $2`,
      [days, tenant.id],
    );
  const deletionBegan = (tenant: Tenant, ms: number) =>
    admin(
      `update platform.tenant
          set state_since = now() - make_interval(secs => $1::double precision) where id = $2`,
      [ms / 1000, tenant.id],
    );
  /** This tenant's purge, due now, passed over nothing of any other's. */
  const due = (tenant: Tenant) =>
    admin(
      `update platform.job set run_after = now(), locked_until = null
        where tenant_id = $1 and kind = 'tenant_purge';`,
      [tenant.id],
    );
  const clearOthers = (tenant: Tenant) =>
    admin(
      `update platform.job set finished_at = now()
        where kind = 'tenant_purge' and tenant_id <> $1 and finished_at is null`,
      [tenant.id],
    );
  const run = (
    over: Partial<PurgeStore> = {},
    steps: Partial<StewardDatabase> = {},
    delivered?: PurgeDelivered,
  ) =>
    processNextPurge({
      ...(delivered ? { delivered } : {}),
      queue,
      steward: { ...steward, ...steps },
      store: { ...purging, ...over },
      workerId: 'steward-test',
      leaseMs: 60_000,
      log: quiet,
    });
  const toDeleting = async (tenant: Tenant) => {
    await close(tenant);
    await closedDaysAgo(tenant, GRACE_DAYS);
    expect(await advance(tenant)).toBe('deleting');
    await clearOthers(tenant);
  };

  it('IAM-086 holds the timetable: nothing at day 29, deleting at day 30, gone within the day', async () => {
    const tenant = await makeTenant();
    await stored(tenant);
    await close(tenant);
    await closedDaysAgo(tenant, 29);
    expect(await advance(tenant)).toBe('closing');
    await closedDaysAgo(tenant, 30);
    expect(await advance(tenant)).toBe('deleting');
    await clearOthers(tenant);

    // At once its addresses go, and then nothing for the longest lease and the cache.
    expect(await run()).toBe('waiting');
    expect(await service.resolveHostname(`${tenant.id}.alloy.test`)).toBeUndefined();
    expect((await steward.whatRemains(tenant)).schemaPresent).toBe(true);
    expect((await purging.remaining(tenant)).objects).toBe(1);

    await deletionBegan(tenant, PURGE_WAIT_MS);
    await due(tenant);
    expect(await run()).toBe('done');

    const record = await steward.record(tenant.id);
    expect(record).toMatchObject({
      state: 'deleted',
      report: {
        schemaPresent: false,
        roles: 0,
        hostnames: 0,
        jobs: 0,
        objects: 0,
        credentialPresent: false,
      },
    });
    const took = record!.deletedAt!.getTime() - record!.deletionBeganAt!.getTime();
    expect(took).toBeLessThan(DELETION_DAYS * 86_400_000);
  });

  it('IAM-086 finishes though ordinary work was still queued when deletion began', async () => {
    const tenant = await makeTenant();
    await admin(`insert into platform.job (tenant_id, kind) values ($1, 'publish')`, [tenant.id]);
    await toDeleting(tenant);
    await deletionBegan(tenant, PURGE_WAIT_MS);
    expect(await run()).toBe('done');
    expect((await steward.record(tenant.id))?.state).toBe('deleted');
    const { rows } = await admin(`select 1 from platform.job where tenant_id = $1`, [tenant.id]);
    expect(rows).toEqual([]);
  });

  it('IAM-086 empties the delivery store too, and will not call it clean while it holds any', async () => {
    const tenant = await makeTenant();
    await toDeleting(tenant);
    await deletionBegan(tenant, PURGE_WAIT_MS);
    let held = true;
    const delivered = {
      removeTenant: () => Promise.resolve(),
      holdsTenant: () => Promise.resolve(held),
    };
    expect(await run({}, {}, delivered)).toBe('retry');
    expect((await steward.record(tenant.id))?.state).toBe('deleting');
    held = false;
    await due(tenant);
    expect(await run({}, {}, delivered)).toBe('done');
    expect((await steward.record(tenant.id))?.report).toMatchObject({ deliveredPresent: false });
  });

  it('IAM-086 says so when there was no delivery store to ask', async () => {
    const tenant = await makeTenant();
    await toDeleting(tenant);
    await deletionBegan(tenant, PURGE_WAIT_MS);
    expect(await run()).toBe('done');
    expect((await steward.record(tenant.id))?.report).toMatchObject({ deliveredPresent: null });
  });

  it('IAM-086 removes this tenant alone: a neighbour with a similar id keeps everything', async () => {
    const tenant = await makeTenant();
    const neighbour = await makeTenant(`${tenant.id}x`);
    await stored(tenant);
    const theirs = await stored(neighbour);
    await toDeleting(tenant);
    await deletionBegan(tenant, PURGE_WAIT_MS);
    expect(await run()).toBe('done');
    expect((await purging.remaining(neighbour)).objects).toBe(1);
    expect((await purging.remaining(neighbour)).credentialPresent).toBe(true);
    const opened = await service.withTenant(neighbour, (trx) => stores.forTenant(trx, neighbour));
    expect((await opened.get(theirs.key)).toString()).toBe(`bytes of ${neighbour.id}`);
  });

  it('IAM-086 takes a stale credential away before the bytes, so a late write is refused', async () => {
    const tenant = await makeTenant();
    await stored(tenant);
    const opened = await service.withTenant(tenant, (trx) => stores.forTenant(trx, tenant));
    await toDeleting(tenant);
    await deletionBegan(tenant, PURGE_WAIT_MS);
    let late: unknown;
    const outcome = await run({
      deleteObjects: async (each) => {
        late = await opened
          .put(new TextEncoder().encode('late'), 'text/plain')
          .catch(() => 'refused');
        await purging.deleteObjects(each);
      },
    });
    expect(late).toBe('refused');
    expect(outcome).toBe('done');
  });

  it('IAM-086 finishes when taken again, having stopped at any stage', async () => {
    const stages: readonly [string, () => Parameters<typeof run>][] = [
      ['credential', () => [{ removeCredential: () => Promise.reject(new Error('stopped')) }, {}]],
      ['objects', () => [{ deleteObjects: () => Promise.reject(new Error('stopped')) }, {}]],
      ['database', () => [{}, { dropTenantDatabase: () => Promise.reject(new Error('stopped')) }]],
      ['record', () => [{}, { recordDeleted: () => Promise.reject(new Error('stopped')) }]],
    ];
    for (const [stage, stopped] of stages) {
      const tenant = await makeTenant();
      await stored(tenant);
      await toDeleting(tenant);
      await deletionBegan(tenant, PURGE_WAIT_MS);
      expect(await run(...stopped()), stage).toBe('retry');
      expect((await steward.record(tenant.id))?.state, stage).toBe('deleting');
      await due(tenant);
      expect(await run(), stage).toBe('done');
      expect((await steward.record(tenant.id))?.state, stage).toBe('deleted');
    }
  }, 120_000);

  it('IAM-086 will not write a record over what it found still there', async () => {
    const tenant = await makeTenant();
    await toDeleting(tenant);
    await deletionBegan(tenant, PURGE_WAIT_MS);
    expect(
      await run({
        remaining: () => Promise.resolve({ objects: 1, credentialPresent: false }),
      }),
    ).toBe('retry');
    expect((await steward.record(tenant.id))?.report).toBeNull();
    await due(tenant);
    expect(await run()).toBe('done');
  });

  it('IAM-086 queues again a purge out of attempts, and alarms past the day', async () => {
    const tenant = await makeTenant();
    await toDeleting(tenant);
    await admin(
      `update platform.job set attempts = max_attempts, locked_until = now() - interval '1 second'
        where tenant_id = $1 and kind = 'tenant_purge'`,
      [tenant.id],
    );
    await deletionBegan(tenant, 25 * 3_600_000);
    const alarms: object[] = [];
    await sweepStuckPurges({
      steward,
      log: { ...quiet, error: (details) => alarms.push(details) },
    });
    expect(alarms).toContainEqual({ tenant: tenant.id });
    await clearOthers(tenant);
    expect(await run()).toBe('done');
    expect((await steward.record(tenant.id))?.state).toBe('deleted');
  });

  it('leaves a job a tenant queued for itself alone while nothing is being deleted', async () => {
    const tenant = await makeTenant();
    await admin(
      `update platform.job set finished_at = now() where kind = 'tenant_purge' and finished_at is null`,
    );
    await admin(`insert into platform.job (tenant_id, kind) values ($1, 'tenant_purge')`, [
      tenant.id,
    ]);
    expect(await run()).toBe('idle');
    expect((await steward.whatRemains(tenant)).schemaPresent).toBe(true);
  });
});

describe('the guide to closing an environment', () => {
  const guide = readFileSync(
    new URL('../../../docs/guides/closing-an-environment.md', import.meta.url),
    'utf8',
  );

  it('ADM-045 publishes what stops, word for word as the code declares it', () => {
    for (const capability of TENANT_EFFECT_CAPABILITIES) {
      const row = guide.split(/\r?\n/).find((line) => line.startsWith(`| \`${capability}\``));
      expect(row, capability).toBeDefined();
      const cells = row!.split('|').map((cell) => cell.trim());
      expect(cells[2], capability).toBe(TENANT_STATE_EFFECTS.suspended[capability]);
      expect(cells[3], capability).toBe(TENANT_STATE_EFFECTS.closing[capability]);
    }
  });

  it('IAM-086 publishes both numbers, and says what backups mean for them', () => {
    expect(guide).toContain(`**${GRACE_DAYS} days**`);
    expect(guide).toContain(`**${DELETION_DAYS} day**`);
    expect(guide).toMatch(/backups/i);
  });
});
