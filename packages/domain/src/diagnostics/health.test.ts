import { describe, expect, it } from 'vitest';
import { capabilityHealth, workHealth } from './health.js';
import { bucketOf, emptyBuckets } from './measure.js';

const timed = (ms: number, count: number) => {
  const buckets = emptyBuckets();
  buckets[bucketOf(ms)] = count;
  return buckets;
};
const counts = (over: Partial<Parameters<typeof capabilityHealth>[0]> = {}) => ({
  requests: 100,
  clientErrors: 0,
  serverErrors: 0,
  refused: 0,
  buckets: timed(40, 100),
  ...over,
});

describe("a capability's health over the last 15 minutes (the DG plan, DG-F)", () => {
  it('ADM-015 reads health, latency and error rate per capability from its own counts', () => {
    expect(capabilityHealth(counts())).toEqual({
      health: 'healthy',
      requests: 100,
      errorRate: 0,
      p95Ms: 50,
    });
    expect(capabilityHealth(counts({ serverErrors: 10 }))).toMatchObject({
      health: 'degraded',
      errorRate: 0.1,
    });
    expect(capabilityHealth(counts({ serverErrors: 60 })).health).toBe('failing');
    expect(capabilityHealth(counts({ buckets: timed(400, 100) }), 250).health).toBe('degraded');
  });

  it("keeps a caller's own mistakes and refusals by the environment out of its health", () => {
    expect(capabilityHealth(counts({ clientErrors: 90 })).health).toBe('healthy');
    expect(capabilityHealth(counts({ refused: 100 })).health).toBe('idle');
    expect(capabilityHealth(counts({ requests: 0, buckets: emptyBuckets() }))).toEqual({
      health: 'idle',
      requests: 0,
      errorRate: null,
      p95Ms: null,
    });
  });
});

describe("background work's health (the DG plan, DG-F, pre-flight 9)", () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const minutes = (n: number) => new Date(now.getTime() - n * 60_000);

  it('reads failing for a failed run or one not run for twice its cadence, paused as paused', () => {
    expect(
      workHealth({ outcome: 'succeeded', lastStartedAt: minutes(1), nextDueAt: minutes(-1) }, now),
    ).toBe('healthy');
    expect(
      workHealth({ outcome: 'failed', lastStartedAt: minutes(1), nextDueAt: minutes(-1) }, now),
    ).toBe('failing');
    // Due a minute after it last ran, 2 minutes ago: twice its cadence has passed.
    expect(
      workHealth({ outcome: 'succeeded', lastStartedAt: minutes(3), nextDueAt: minutes(2) }, now),
    ).toBe('failing');
    expect(
      workHealth({ outcome: 'succeeded', lastStartedAt: minutes(3), nextDueAt: null }, now),
    ).toBe('healthy');
    expect(
      workHealth({ outcome: 'paused', lastStartedAt: minutes(300), nextDueAt: minutes(200) }, now),
    ).toBe('paused');
  });
});
