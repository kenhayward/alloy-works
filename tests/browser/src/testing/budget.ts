import { readFileSync } from 'node:fs';
import { arch, availableParallelism, cpus, platform, release, totalmem, version } from 'node:os';
import type { Browser } from 'playwright-core';

/** A budget: a 95th percentile, and a maximum no sample may pass, in milliseconds. */
export interface Budget {
  readonly p95: number;
  readonly max: number;
}

/**
 * The navigation budgets the browser measures (the W13 plan's B-K and B-L). STR-072 is the
 * interface's share of an act on the outline, STR-063's interactive budget again with the service's
 * requests taken out; CNT-179's open is CNT-136's preview numbers and its jump STR-063's again, each
 * the whole time a reader waits.
 */
export const BUDGETS = {
  interface: { p95: 250, max: 500 },
  open: { p95: 1000, max: 2000 },
  jump: { p95: 250, max: 500 },
} as const satisfies Record<string, Budget>;

/**
 * The bounds a run is held to: both, anywhere but a shared CI runner, whose speed has varied from
 * run to run by more than a budget itself (issues #179 and #188); there, the samples are recorded and
 * nothing fails on them (B-P), as STR-063's and PUB-102's budgets are. A small copy of the service's
 * own rule (`apps/service/src/test/budget.ts`), since the suite imports nothing from an app.
 */
export function binding(
  budget: Budget,
  env: Readonly<Record<string, string | undefined>>,
): { readonly p95: number | null; readonly max: number | null } {
  return env['CI'] === 'true' ? { p95: null, max: null } : { ...budget };
}

/** The nearest-rank percentile: the smallest sample at or above `p` percent of them. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) throw new Error('No samples to take a percentile of');
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  ]!;
}

/** What a run of samples is reported as: how many, the p50, the p95 and the maximum, and each. */
export interface Summary {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly samples: readonly number[];
}

export function summary(samples: readonly number[]): Summary {
  const round = (value: number) => Number(value.toFixed(1));
  return {
    n: samples.length,
    p50: round(percentile(samples, 50)),
    p95: round(percentile(samples, 95)),
    max: round(Math.max(...samples)),
    samples: samples.map(round),
  };
}

/** The repository's root, whose `version.json` names what the stack was built from. */
const ROOT = new URL('../../../../', import.meta.url);

/**
 * The configuration a measurement ran on, recorded beside it (B-P): the machine, Node, the pinned
 * Chromium as the browser reports itself, and the stack - built from this tree, so the tree's version,
 * and the database image the compose file names.
 */
export async function configuration(browser: Browser): Promise<Record<string, unknown>> {
  const compose = readFileSync(new URL('deploy/compose.yaml', ROOT), 'utf8');
  const { version: tree } = JSON.parse(readFileSync(new URL('version.json', ROOT), 'utf8')) as {
    version: string;
  };
  return {
    platform: `${platform()} ${arch()}`,
    os: `${version()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    // The logical CPUs the machine has, and how many this process may run on at once.
    cpus: cpus().length,
    parallelism: availableParallelism(),
    memory: `${Math.round(totalmem() / 2 ** 30)} GB`,
    node: process.version,
    chromium: browser.version(),
    stack: {
      built: tree,
      postgres: /image:\s*(\S*postgres\S*|\S*pgvector\S*)/.exec(compose)?.[1] ?? 'unknown',
    },
    held: process.env['CI'] === 'true' ? 'neither bound: recorded only, on CI' : 'both bounds',
  };
}
