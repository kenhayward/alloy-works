import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PERFORMANCE_BUDGETS, budgetVerdict, type PerformanceBudget } from './budgets.js';
import { LATENCY_BOUNDS_MS, bucketOf, emptyBuckets } from './measure.js';
import { MEASURED_OPERATIONS } from './usage.js';

const corpus = JSON.parse(
  readFileSync(new URL('../../../trace/trace.json', import.meta.url), 'utf8'),
) as { requirements: { id: string; status: string; statement: string }[] };

/** A requirement stating a performance number or a budget yet to be numbered. */
const STATES_A_BUDGET = /\bp9\d\b|9\dth percentile|stated budget/i;

const timed = (...durations: number[]) => {
  const buckets = emptyBuckets();
  for (const ms of durations) buckets[bucketOf(ms)]! += 1;
  return buckets;
};

const budget = (id: string) => PERFORMANCE_BUDGETS.find((each) => each.id === id)!;

describe('performance budgets registered (the DG plan, DG-J)', () => {
  it('registers every budget the specification states, and only those still in force', () => {
    const stated = corpus.requirements
      .filter((each) => each.status === 'Specified' || each.status === 'Covered')
      .filter((each) => STATES_A_BUDGET.test(each.statement))
      .map((each) => each.id);
    const registered = [...new Set(PERFORMANCE_BUDGETS.map((each) => each.requirement))];
    expect(registered.sort()).toEqual([...new Set(stated)].sort());
  });

  it('gives each its owner, reference configuration, provisional state, confirming tranche and production measure', () => {
    for (const each of PERFORMANCE_BUDGETS) {
      expect(each.owner, each.id).toMatch(/^docs\/design\/[a-z-]+\.md$/);
      expect(each.reference.length, each.id).toBeGreaterThan(0);
      expect(each.confirmedBy, each.id).toMatch(/^T\d$/);
      if (each.production.kind === 'unmeasured' || each.production.kind === 'immediate') {
        expect(each.production.why.length, each.id).toBeGreaterThan(0);
      }
    }
    expect(new Set(PERFORMANCE_BUDGETS.map((each) => each.id)).size).toBe(
      PERFORMANCE_BUDGETS.length,
    );
  });

  it('holds each budget measured from buckets to a bound, so met or missed is exact', () => {
    const bucketed = PERFORMANCE_BUDGETS.filter(
      (each) => each.production.kind === 'request' || each.production.kind === 'job',
    );
    for (const each of bucketed) {
      expect(LATENCY_BOUNDS_MS, each.id).toContain(each.withinMs);
    }
    // Each request measured is an operation measured as its own capability.
    const measured = new Set(Object.values(MEASURED_OPERATIONS));
    for (const each of bucketed.filter((one) => one.production.kind === 'request')) {
      expect(measured, each.id).toContain((each.production as { capability: string }).capability);
    }
  });

  it('says met, missed or nothing measured, from the percentile and the largest sample', () => {
    const search = budget('SCH-033');
    expect(budgetVerdict(search, { buckets: emptyBuckets() }).verdict).toBe('nothing');
    expect(budgetVerdict(search, { buckets: timed(...Array(99).fill(20), 400) })).toEqual({
      verdict: 'met',
      atMs: 25,
      largestMs: 500,
    });
    // The 95th percentile past 250 ms.
    expect(budgetVerdict(search, { buckets: timed(...Array(10).fill(300)) }).verdict).toBe(
      'missed',
    );
    // One sample past the ceiling misses it, whatever the percentile.
    expect(budgetVerdict(search, { buckets: timed(...Array(99).fill(20), 900) }).verdict).toBe(
      'missed',
    );
  });

  it('holds a ceiling between two bounds to the bound below it, never claiming what it cannot see', () => {
    const preview = budget('CNT-186');
    expect(preview.neverAboveMs).toBe(6000);
    expect(budgetVerdict(preview, { buckets: timed(...Array(20).fill(900), 4800) }).verdict).toBe(
      'met',
    );
    // 5.5 s may be under six seconds, but its bucket reaches ten.
    expect(budgetVerdict(preview, { buckets: timed(...Array(20).fill(900), 5500) }).verdict).toBe(
      'missed',
    );
  });

  it('reads the index lag in seconds, and says a budget nothing measures is not measured', () => {
    const meaning = budget('SCH-067');
    expect(budgetVerdict(meaning, { lag: { p95Seconds: 12, maxSeconds: 40 } })).toEqual({
      verdict: 'met',
      atMs: 12_000,
      largestMs: 40_000,
    });
    expect(budgetVerdict(meaning, { lag: { p95Seconds: 90, maxSeconds: 100 } }).verdict).toBe(
      'missed',
    );
    expect(budgetVerdict(meaning, { lag: { p95Seconds: null, maxSeconds: null } }).verdict).toBe(
      'nothing',
    );
    const unmeasured = PERFORMANCE_BUDGETS.find(
      (each: PerformanceBudget) => each.production.kind === 'unmeasured',
    )!;
    expect(budgetVerdict(unmeasured, {}).verdict).toBe('unmeasured');
    expect(budgetVerdict(budget('SCH-066'), {}).verdict).toBe('immediate');
  });
});
