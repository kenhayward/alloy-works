/** STR-063's budget for each measured route: a 95th percentile, and a maximum no sample may pass. */
export const BUDGET = { p95: 250, max: 500 } as const;

/**
 * The bounds a run is held to. A shared CI runner's speed varies from run to run by more than the
 * budget itself: the same numbering route has measured a p95 of 100 ms and of 258 ms there (issue
 * #179), and the same contributions route a maximum of 167 ms and of 535 ms (issue #188), against
 * about 80 ms on a developer's machine. So on one, Ken decided, the timings are recorded beside the
 * result and nothing fails on them. Anywhere else - the machine named in the recorded configuration -
 * both bounds hold. `CI` is the variable GitHub Actions, and most other runners, set to `true`.
 */
export function bindingBudget(env: Readonly<Record<string, string | undefined>>): {
  readonly p95: number | null;
  readonly max: number | null;
} {
  return env['CI'] === 'true' ? { p95: null, max: null } : { ...BUDGET };
}
