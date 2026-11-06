import { describe, expect, it } from 'vitest';
import {
  addBuckets,
  bucketOf,
  emptyBuckets,
  LATENCY_BOUNDS_MS,
  MEASUREMENT_TIERS,
  percentileBound,
} from './measure.js';

describe('latency in fixed buckets (the DG plan, pre-flight 5)', () => {
  it('puts a duration in the first bucket whose bound holds it, past the last in the overflow', () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(5)).toBe(0);
    expect(bucketOf(6)).toBe(1);
    expect(bucketOf(250)).toBe(LATENCY_BOUNDS_MS.indexOf(250));
    expect(bucketOf(10 ** 7)).toBe(LATENCY_BOUNDS_MS.length);
    expect(emptyBuckets()).toHaveLength(LATENCY_BOUNDS_MS.length + 1);
  });

  it('holds a bound at each registered request budget, so one is met or not exactly', () => {
    for (const budget of [250, 500, 3000]) expect(LATENCY_BOUNDS_MS).toContain(budget);
    expect([...LATENCY_BOUNDS_MS].sort((a, b) => a - b)).toEqual([...LATENCY_BOUNDS_MS]);
  });

  it('reads the 95th percentile as the smallest bound holding it, and adds minutes exactly', () => {
    const fast = emptyBuckets();
    fast[bucketOf(40)] = 95;
    fast[bucketOf(400)] = 5;
    expect(percentileBound(fast, 0.95)).toBe(50);
    const slow = emptyBuckets();
    slow[bucketOf(400)] = 100;
    const both = addBuckets(fast, slow);
    expect(both.reduce((sum, each) => sum + each, 0)).toBe(200);
    expect(percentileBound(both, 0.95)).toBe(500);
    expect(percentileBound(emptyBuckets(), 0.95)).toBeNull();
    const over = emptyBuckets();
    over[LATENCY_BOUNDS_MS.length] = 1;
    expect(percentileBound(over, 0.95)).toBe(Infinity);
  });

  it('ADM-035 declares how long each precision is kept before any is measured', () => {
    expect(MEASUREMENT_TIERS).toEqual([
      { span: 'minute', keptDays: 7 },
      { span: 'hour', keptDays: 90 },
      { span: 'day', keptDays: 396 },
    ]);
  });
});
