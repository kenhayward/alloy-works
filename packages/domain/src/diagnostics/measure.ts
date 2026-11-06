/**
 * **How a capability's requests and work are measured** (diagnostics.md; the DG plan, pre-flight 4 and
 * 5): counted, and timed into fixed buckets, so a minute adds to an hour and an hour to a day exactly,
 * and a 95th percentile is read as the smallest bound holding it. The bounds are log-spaced with one at
 * each registered request budget; changing them is a new `BUCKETS_VERSION`, never a rewrite of what is
 * stored.
 */

/** The upper bound of each bucket, in milliseconds; a last bucket holds what passes them all. */
export const LATENCY_BOUNDS_MS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 3000, 5000, 10_000, 30_000, 60_000,
] as const;

/** Which bounds a stored row was counted against. */
export const BUCKETS_VERSION = 1;

/** The precisions kept, and for how long (DG-B): declared before anything is measured (ADM-035). */
export const MEASUREMENT_TIERS = [
  { span: 'minute', keptDays: 7 },
  { span: 'hour', keptDays: 90 },
  // 13 months, so a year's trend has the same month a year before (ADM-033).
  { span: 'day', keptDays: 396 },
] as const;

export type MeasurementSpan = (typeof MEASUREMENT_TIERS)[number]['span'];

/** The bucket a duration falls in. */
export function bucketOf(ms: number): number {
  const at = LATENCY_BOUNDS_MS.findIndex((bound) => ms <= bound);
  return at === -1 ? LATENCY_BOUNDS_MS.length : at;
}

/** No durations yet: one count a bucket, the overflow last. */
export function emptyBuckets(): number[] {
  return Array.from({ length: LATENCY_BOUNDS_MS.length + 1 }, () => 0);
}

/** Two counts of the same bounds, added. */
export function addBuckets(a: readonly number[], b: readonly number[]): number[] {
  return a.map((count, at) => count + (b[at] ?? 0));
}

/**
 * The smallest bound holding the `fraction`th of what was counted: `Infinity` where that is past the
 * last bound, null where nothing was counted.
 */
export function percentileBound(buckets: readonly number[], fraction: number): number | null {
  const total = buckets.reduce((sum, each) => sum + each, 0);
  if (total === 0) return null;
  const wanted = Math.ceil(total * fraction);
  let seen = 0;
  for (const [at, count] of buckets.entries()) {
    seen += count;
    if (seen >= wanted) return LATENCY_BOUNDS_MS[at] ?? Infinity;
  }
  return Infinity;
}
