import { bucketOf, emptyBuckets } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import type { CapabilityCount } from './measurements.js';
import { createMeasuring } from './measuring.js';
import type { Tenant } from './provision.js';

const ACME = {
  id: 'acme',
  schema: 't_acme',
  role: 't_acme_role',
  name: 'Acme',
} as unknown as Tenant;
const OTHER = {
  id: 'other',
  schema: 't_other',
  role: 't_other_role',
  name: 'Other',
} as unknown as Tenant;

describe('measuring requests in the process, a minute at a time (the DG plan, pre-flight 3 and 4)', () => {
  const capture = () => {
    const written: { tenant: string; minute: string; counts: CapabilityCount[] }[] = [];
    return {
      written,
      write: (tenant: Tenant, minute: Date, counts: readonly CapabilityCount[]) => {
        written.push({ tenant: tenant.id, minute: minute.toISOString(), counts: [...counts] });
        return Promise.resolve();
      },
    };
  };

  it('sums each tenant’s capabilities by minute, 4xx apart from 5xx, refusals apart from both', async () => {
    let now = new Date('2026-11-06T10:00:30Z');
    const { written, write } = capture();
    const measuring = createMeasuring(write, { now: () => now });
    measuring.record(ACME, 'Components', { status: 200, ms: 40, refused: false });
    measuring.record(ACME, 'Components', { status: 404, ms: 8, refused: false });
    measuring.record(ACME, 'Components', { status: 503, ms: 300, refused: true });
    measuring.record(OTHER, 'Search', { status: 500, ms: 9000, refused: false });
    now = new Date('2026-11-06T10:01:10Z');
    measuring.record(ACME, 'Components', { status: 200, ms: 40, refused: false });
    await measuring.flush();
    const buckets = (...ms: number[]) => {
      const counted = emptyBuckets();
      for (const each of ms) counted[bucketOf(each)]! += 1;
      return counted;
    };
    expect(written).toEqual([
      {
        tenant: 'acme',
        minute: '2026-11-06T10:00:00.000Z',
        counts: [
          {
            capability: 'Components',
            requests: 3,
            clientErrors: 1,
            serverErrors: 0,
            refused: 1,
            buckets: buckets(40, 8, 300),
          },
        ],
      },
      {
        tenant: 'acme',
        minute: '2026-11-06T10:01:00.000Z',
        counts: [
          {
            capability: 'Components',
            requests: 1,
            clientErrors: 0,
            serverErrors: 0,
            refused: 0,
            buckets: buckets(40),
          },
        ],
      },
      {
        tenant: 'other',
        minute: '2026-11-06T10:00:00.000Z',
        counts: [
          {
            capability: 'Search',
            requests: 1,
            clientErrors: 0,
            serverErrors: 1,
            refused: 0,
            buckets: buckets(9000),
          },
        ],
      },
    ]);
    // Written once: the next flush has nothing.
    await measuring.flush();
    expect(written).toHaveLength(3);
  });

  it('keeps a minute whose write failed for the next flush, and holds no more than its cap', async () => {
    let failing = true;
    const written: number[] = [];
    const measuring = createMeasuring(
      (_tenant, _minute, counts) => {
        if (failing) return Promise.reject(new Error('down'));
        written.push(...counts.map((each) => each.requests));
        return Promise.resolve();
      },
      { now: () => new Date('2026-11-06T10:00:00Z'), most: 2 },
    );
    measuring.record(ACME, 'Components', { status: 200, ms: 1, refused: false });
    measuring.record(ACME, 'Search', { status: 200, ms: 1, refused: false });
    // A third capability past the cap is not held: memory is bounded whatever arrives.
    measuring.record(ACME, 'Documents', { status: 200, ms: 1, refused: false });
    await measuring.flush();
    failing = false;
    measuring.record(ACME, 'Components', { status: 200, ms: 1, refused: false });
    await measuring.flush();
    expect(written.sort()).toEqual([1, 2]);
    expect(measuring.dropped()).toBe(1);
  });
});
