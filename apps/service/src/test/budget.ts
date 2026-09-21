/** STR-063's budget for each measured route: a 95th percentile, and a maximum no sample may pass. */
export const BUDGET = { p95: 250, max: 500 } as const;

/**
 * The bounds a run is held to (issue #179). A shared CI runner's speed varies from run to run by more
 * than the budget's own margin - the same numbering route has measured a p95 of 100 ms and of 258 ms
 * there, and 120 ms on a developer's machine - so there the p95 is recorded beside the result and
 * only the maximum fails the run. Anywhere else, the machine named in the recorded configuration,
 * both bounds hold. `CI` is the variable GitHub Actions, and most other runners, set to `true`.
 */
export function bindingBudget(env: Readonly<Record<string, string | undefined>>): {
  readonly p95: number | null;
  readonly max: number;
} {
  return env['CI'] === 'true' ? { p95: null, max: BUDGET.max } : { ...BUDGET };
}
