/**
 * A passing run has no errors or warnings. Enforced here rather than left to discipline: a suite
 * that prints React's `act(...)` warning is a suite whose output nobody reads any more.
 *
 * The gate throws from inside `console.error`/`console.warn`, so the failure names the source line
 * that produced the noise - an assertion in `afterEach` can only say that noise happened somewhere.
 */
type GatedMethod = 'error' | 'warn';

let saved: Pick<Console, GatedMethod> | null = null;
let allowed = false;

/** Opt out for a single test that deliberately provokes an error or warning. */
export function allowConsoleNoise(): void {
  allowed = true;
}

function describeArguments(args: readonly unknown[]): string {
  return args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
}

export function armConsoleGate(): void {
  allowed = false;
  saved = { error: console.error, warn: console.warn };
  const original = saved;

  for (const method of ['error', 'warn'] as const) {
    console[method] = (...args: unknown[]): void => {
      if (allowed) {
        original[method](...args);
        return;
      }
      throw new Error(
        `console.${method} during a test: ${describeArguments(args)}\n` +
          'Fix the cause, or call allowConsoleNoise() if this test provokes it on purpose.',
      );
    };
  }
}

export function releaseConsoleGate(): void {
  if (saved === null) return;
  console.error = saved.error;
  console.warn = saved.warn;
  saved = null;
}
