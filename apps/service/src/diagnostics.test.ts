import type { DiagnosticsView } from '@alloy-works/api-contract';
import {
  createMeasuring,
  recordBackgroundWork,
  recordCapabilityMinute,
  recordQueryRun,
} from '@alloy-works/db';
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
    h = await startHarness({ appOptions: { measuring } });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('gathers health per capability, background work, deliveries and data sources in one read', async () => {
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
    expect(view.webhooks).toEqual({ subscriptions: 0, failing: 0, disabledFailing: 0 });
    expect(view.mail).toMatchObject({ enabled: false, failingSince: null });
    expect(view.budgets.queryRunsAtOnce).toBeGreaterThan(0);
  });

  it('is refused to somebody who does not administer the environment', async () => {
    expect((await h.call('grace', 'GET', '/v1/diagnostics')).statusCode).toBe(403);
  });
});
