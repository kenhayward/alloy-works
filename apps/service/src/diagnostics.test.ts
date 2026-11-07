import type { DiagnosticsView, UsageView } from '@alloy-works/api-contract';
import {
  countUsage,
  createMeasuring,
  integrityDue,
  recordBackgroundWork,
  recordCapabilityMinute,
  recordQueryRun,
  verifyIntegrity,
  recordServiceProbe,
} from '@alloy-works/db';
import { queryAs } from '@alloy-works/db/testing';
import { bucketOf, emptyBuckets, PERFORMANCE_BUDGETS } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

const SOURCE = '33333333-3333-4333-8333-333333333333';

describe("the environment's diagnostics, for whoever administers it (the DG plan, DG-H)", () => {
  let h: Harness;
  const measuring = createMeasuring((tenant, minute, counts) =>
    h.tenantDb.withTenant(tenant, (trx) => recordCapabilityMinute(trx, minute, counts), {
      actorKind: 'system',
    }),
  );

  beforeAll(async () => {
    h = await startHarness({
      appOptions: {
        measuring,
        objectives: { availability: 0.9, recoveryPointHours: 48, recoveryTimeHours: 1 },
      },
    });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('gathers health per capability, background work, deliveries and data sources in one read', async () => {
    const named = (await h.connection('Site readings')).id;
    expect((await h.call('ada', 'GET', '/v1/spaces')).statusCode).toBe(200);
    await measuring.flush();
    const now = new Date();
    await h.tenantDb.withTenant(
      h.tenant,
      async (trx) => {
        await recordBackgroundWork(trx, {
          work: 'sweepMailEverywhere',
          startedAt: now,
          finishedAt: now,
          outcome: 'failed',
          failure: 'connection_refused',
        });
        await recordQueryRun(trx, {
          act: 'sample',
          principal: null,
          connection: SOURCE,
          queryDefinition: null,
          document: null,
          durationMs: 30_000,
          rows: null,
          bytes: null,
          outcome: 'failed',
          failure: 'timeout',
        });
        await recordQueryRun(trx, {
          act: 'sample',
          principal: null,
          connection: named,
          queryDefinition: null,
          document: null,
          durationMs: 40,
          rows: 1,
          bytes: 10,
          outcome: 'ran',
          failure: null,
        });
      },
      { actorKind: 'system' },
    );

    const answered = await h.call('ada', 'GET', '/v1/diagnostics');
    expect(answered.statusCode).toBe(200);
    const view = answered.json<DiagnosticsView>();
    expect(view.capabilities.find((each) => each.capability === 'Spaces')).toMatchObject({
      health: 'healthy',
      requests: 1,
      errorRate: 0,
    });
    expect(view.work).toEqual([
      expect.objectContaining({
        work: 'sweepMailEverywhere',
        health: 'failing',
        failure: 'connection_refused',
      }),
    ]);
    expect(view.connections.find((each) => each.connection === SOURCE)).toMatchObject({
      down: true,
      timedOut: 1,
      lastFailure: 'timeout',
    });
    expect(view.connections.find((each) => each.connection === named)).toMatchObject({
      name: 'Site readings',
      down: false,
    });
    expect(view.webhooks).toEqual({ subscriptions: 0, failing: 0, disabledFailing: 0 });
    expect(view.mail).toMatchObject({ enabled: false, failingSince: null });
    expect(view.budgets.queryRunsAtOnce).toBeGreaterThan(0);
  });

  it('reads each performance budget against the last 7 days, and a capability past its budget as degraded', async () => {
    const slow = emptyBuckets();
    slow[bucketOf(300)] = 10;
    await h.tenantDb.withTenant(
      h.tenant,
      (trx) =>
        recordCapabilityMinute(trx, new Date(Date.now() - 60_000), [
          {
            capability: 'Searches',
            requests: 10,
            clientErrors: 0,
            serverErrors: 0,
            refused: 0,
            buckets: slow,
          },
        ]),
      { actorKind: 'system' },
    );
    const view = (await h.call('ada', 'GET', '/v1/diagnostics')).json<DiagnosticsView>();
    expect(view.capabilities.find((each) => each.capability === 'Searches')).toMatchObject({
      health: 'degraded',
      p95Ms: 500,
    });
    const reading = (budget: string) => view.performance.find((each) => each.budget === budget);
    expect(reading('SCH-033')).toMatchObject({
      requirement: 'SCH-033',
      measuredAs: 'request',
      capability: 'Searches',
      withinMs: 250,
      verdict: 'missed',
      atMs: 500,
      largestMs: 500,
    });
    expect(reading('PUB-102')).toMatchObject({ measuredAs: 'job', verdict: 'nothing', atMs: null });
    expect(reading('SCH-066')).toMatchObject({ verdict: 'immediate' });
    expect(reading('API-036')).toMatchObject({ verdict: 'unmeasured', why: expect.any(String) });
    expect(view.performance.map((each) => each.budget)).toEqual(
      PERFORMANCE_BUDGETS.map((each) => each.id),
    );
  });

  it('says, class by class, how many items were checked in the period and which failed', async () => {
    const key = `${h.tenant.role}/sha256/${'a'.repeat(64)}`;
    const { rows } = await queryAs(
      h.db.adminUrl,
      `insert into "${h.tenant.schema}".audit_export (snapshot, state, object_key, sha256, bytes, finished_at)
       values (pg_current_snapshot(), 'done', $1, $2, 1, now()) returning id`,
      [key, 'a'.repeat(64)],
    );
    const lost = rows[0]!.id as string;
    await h.tenantDb.withTenant(
      h.tenant,
      async (trx) => {
        // Tonight's share, the export's object missing from the store.
        for (const item of (await integrityDue(trx)) ?? [])
          await verifyIntegrity(trx, item, () => Promise.resolve(null));
      },
      { actorKind: 'system' },
    );
    const { integrity } = (await h.call('ada', 'GET', '/v1/diagnostics')).json<DiagnosticsView>();
    expect(integrity.periodDays).toBe(28);
    expect(integrity.classes.map((each) => each.class)).toEqual([
      'asset',
      'version',
      'audit_export',
      'tenant_export',
    ]);
    expect(integrity.classes.find((each) => each.class === 'audit_export')).toEqual({
      class: 'audit_export',
      items: 1,
      checkedInPeriod: 1,
      failing: 1,
      lastFailure: { item: lost, failure: 'object_missing', at: expect.any(String) as string },
    });
    const versions = integrity.classes.find((each) => each.class === 'version')!;
    expect(versions.items).toBeGreaterThan(0);
    expect(versions).toMatchObject({ checkedInPeriod: Math.ceil(versions.items / 28), failing: 0 });
  });

  it('ADM-020 reads the operator’s objectives against the probes, the backups and the drills', async () => {
    const quiet = (await h.call('ada', 'GET', '/v1/diagnostics')).json<DiagnosticsView>();
    expect(quiet.objectives).toMatchObject({
      availability: { objective: 0.9, measured: null, verdict: 'unrecorded' },
      recoveryPoint: { objectiveHours: 48, verdict: 'unrecorded' },
      recoveryTime: { objectiveHours: 1, verdict: 'unrecorded' },
      backups: [],
    });

    const worker = {
      query: (text: string, values?: readonly unknown[]) =>
        queryAs(h.db.workerUrl, text, values as unknown[]),
    };
    await recordServiceProbe(worker, new Date(Date.now() - 60_000), true);
    {
      const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);
      for (const [cls, act, hours, seconds] of [
        ['databases', 'backup', 3, 60],
        ['objects', 'backup', 3, 300],
        ['databases', 'drill', 24, 3600],
        ['objects', 'drill', 24, 3600],
      ] as const) {
        await queryAs(
          h.db.adminUrl,
          `insert into platform.backup_run (class, act, started_at, finished_at, outcome)
           values ($1, $2, $3, $3::timestamptz + make_interval(secs => $4), 'succeeded')`,
          [cls, act, ago(hours), seconds],
        );
      }
    }
    const view = (await h.call('ada', 'GET', '/v1/diagnostics')).json<DiagnosticsView>();
    expect(view.objectives.availability).toMatchObject({ measured: 1, verdict: 'met' });
    expect(view.objectives.recoveryPoint).toMatchObject({ verdict: 'met' });
    expect(view.objectives.recoveryPoint.hours).toBeCloseTo(3, 1);
    // Two hours of drills against an hour's objective.
    expect(view.objectives.recoveryTime).toMatchObject({ hours: 2, verdict: 'missed' });
    expect(view.objectives.backups).toHaveLength(4);
  });

  it('is refused to somebody who does not administer the environment', async () => {
    expect((await h.call('grace', 'GET', '/v1/diagnostics')).statusCode).toBe(403);
    expect((await h.call('grace', 'GET', '/v1/usage')).statusCode).toBe(403);
  });

  it('ADM-011 answers each measure by day over 13 months, every measure declared listed', async () => {
    await h.tenantDb.withTenant(h.tenant, (trx) => countUsage(trx), { actorKind: 'system' });
    const answered = await h.call('ada', 'GET', '/v1/usage');
    expect(answered.statusCode).toBe(200);
    const view = answered.json<UsageView>();
    expect(Date.parse(view.to) - Date.parse(view.from)).toBe(395 * 86_400_000);
    expect(view.measures).toHaveLength(13);
    const database = view.measures.find((each) => each.measure === 'databaseBytes');
    expect(database).toMatchObject({ kind: 'sample', unit: 'bytes' });
    expect(database?.days).toEqual([{ day: view.to, amount: expect.any(Number) }]);
    expect(view.measures.find((each) => each.measure === 'publications')?.days).toEqual([]);
  });

  it('refuses a period that ends before it starts or runs past 13 months', async () => {
    expect((await h.call('ada', 'GET', '/v1/usage?from=2026-11-02&to=2026-11-01')).statusCode).toBe(
      400,
    );
    expect((await h.call('ada', 'GET', '/v1/usage?from=2025-01-01&to=2026-11-01')).statusCode).toBe(
      400,
    );
  });
});
