import { z } from 'zod';

import { RESERVED_AREA, validate } from './model.js';

export type Outcome = 'passed' | 'failed' | 'skipped';

export interface TestOutcome {
  readonly id: string;
  readonly outcome: Outcome;
  readonly tests: string[];
}

/**
 * The shape Vitest's built-in `json` reporter writes, narrowed to what matters here. Declared rather
 * than trusted: a silently changed reporter format would otherwise show up as every requirement
 * quietly becoming unverified, which is the worst way to learn about it.
 *
 * `success` and `startTime` are read here, not because `parseResults` needs them, but because
 * `checkCoherence` below does - and both live in the same top-level report object the reporter
 * writes, so one schema covers both.
 */
const Report = z.object({
  success: z.boolean(),
  startTime: z.number(),
  testResults: z.array(
    z.object({
      assertionResults: z.array(z.object({ fullName: z.string(), status: z.string() })),
    }),
  ),
});

const IDENTIFIER = /\b[A-Z]{3}-\d{3}\b/g;

const worst = (outcomes: Outcome[]): Outcome =>
  outcomes.includes('failed') ? 'failed' : outcomes.includes('skipped') ? 'skipped' : 'passed';

const outcomeOf = (status: string): Outcome =>
  status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'skipped';

/**
 * Several JSON reports to what each requirement's tests did. One report per package, because each
 * `vitest.config.ts` writes its own.
 */
/**
 * A run's report read from its text - one `.trace-results` wrote, or the reduced copy `record-run`
 * writes of one - or nothing where the text is not JSON or not a report's shape: whether the run
 * succeeded, and what each requirement's tests did in it. For the gate, which reads a local run's
 * report and must say it could not rather than throw.
 */
export function readRun(text: string):
  | {
      readonly success: boolean;
      readonly counts: RunCounts;
      readonly outcomes: Map<string, TestOutcome>;
    }
  | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const report = Report.safeParse(raw);
  if (!report.success) return undefined;
  return {
    success: report.data.success,
    counts: countsOf(report.data),
    outcomes: parseResults([report.data]),
  };
}

/** How many tests a run held, and how many of them passed, failed and did not run. */
export interface RunCounts {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

function countsOf(report: z.infer<typeof Report>): RunCounts {
  const outcomes = report.testResults.flatMap((file) =>
    file.assertionResults.map((each) => outcomeOf(each.status)),
  );
  const count = (outcome: Outcome) => outcomes.filter((each) => each === outcome).length;
  return {
    total: outcomes.length,
    passed: count('passed'),
    failed: count('failed'),
    skipped: count('skipped'),
  };
}

/**
 * A local run's report as `pnpm trace record-run` commits it beside the run's record (the W15 plan's
 * W15-D): whether the run succeeded, when it started, its counts, and each test's full name and status
 * - which is all the gate reads of it. No file's path, no failure's message, no duration and nothing a
 * test wrote into its `meta`: what a run on somebody's machine leaves in its report is theirs, not the
 * repository's.
 */
export interface RunRecord {
  readonly success: boolean;
  readonly startTime: number;
  readonly counts: RunCounts;
  readonly testResults: readonly {
    readonly assertionResults: readonly { readonly fullName: string; readonly status: string }[];
  }[];
}

/** A Vitest JSON report reduced to its `RunRecord`, or thrown on where it is not a report. */
export function reduceRun(raw: unknown): RunRecord {
  const report = validate(Report, raw, "the run's report");
  return {
    success: report.success,
    startTime: report.startTime,
    counts: countsOf(report),
    testResults: report.testResults.map((file) => ({
      assertionResults: file.assertionResults.map(({ fullName, status }) => ({ fullName, status })),
    })),
  };
}

export function parseResults(reports: unknown[]): Map<string, TestOutcome> {
  const perIdentifier = new Map<string, { outcomes: Outcome[]; tests: string[] }>();

  for (const [index, raw] of reports.entries()) {
    const report = validate(Report, raw, `report ${index + 1}`);
    for (const file of report.testResults) {
      for (const assertion of file.assertionResults) {
        for (const match of assertion.fullName.matchAll(IDENTIFIER)) {
          const id = match[0];
          if (id.slice(0, 3) === RESERVED_AREA) continue;
          const entry = perIdentifier.get(id) ?? { outcomes: [], tests: [] };
          entry.outcomes.push(outcomeOf(assertion.status));
          if (!entry.tests.includes(assertion.fullName)) entry.tests.push(assertion.fullName);
          perIdentifier.set(id, entry);
        }
      }
    }
  }

  return new Map(
    [...perIdentifier].map(([id, entry]) => [
      id,
      { id, outcome: worst(entry.outcomes), tests: entry.tests },
    ]),
  );
}

/**
 * Which report files contribute verification evidence.
 *
 * The tool's own report does not. `compile.ts` already excludes `packages/trace` from the citation
 * scan, because its tests verify the tool rather than the product - and a test named for a
 * requirement, written to check how this tool reports that requirement, would otherwise verify it.
 * That is not evidence about the product; it is the tool marking its own homework.
 */
export const OWN_REPORT = 'trace.json';

export function reportsForEvidence(filenames: string[]): string[] {
  return filenames.filter((name) => name !== OWN_REPORT).sort();
}

export interface NamedReport {
  readonly name: string;
  readonly report: unknown;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * The reports `pnpm test` never writes, because their suites drive a running stack: `pnpm test:e2e`'s
 * and `pnpm test:browser`'s. (The browser workspace's own `test`, its pin's tests, writes
 * `browser-pin.json` and is part of `pnpm test`.)
 */
const NEEDS_THE_STACK: ReadonlySet<string> = new Set(['e2e', 'browser']);

/**
 * Whether a set of JSON reports is coherent enough to trust for `verify`. Nothing cleans
 * `.trace-results`, and each `vitest.config.ts` overwrites only its own file, so left unchecked a
 * report can silently outlive the run that produced it: `tests/e2e`'s report is never refreshed by
 * `pnpm test` (which deliberately excludes it), a filtered run such as
 * `pnpm --filter X test somefile` writes a truncated report, and a suite that dies before writing
 * leaves the previous pass in place. Any of those makes `Verified` a number computed from a run that
 * never happened, which is worse than not computing it at all.
 *
 * Returns one legible sentence per problem found, naming the report; an empty array means the set
 * agrees with itself. `tests/e2e` and `tests/browser` are exempt from the "no report at all" check -
 * `pnpm test` never writes either report, since each suite needs the whole stack up - but not from the failure
 * or staleness checks, which are exactly what catch an `e2e.json` that has not been refreshed in weeks
 * or a browser run that failed.
 */
export function checkCoherence(reports: NamedReport[], expectedNames: string[]): string[] {
  const problems: string[] = [];
  const parsed = reports.map(({ name, report }) => ({
    name,
    report: validate(Report, report, `${name}.json`),
  }));

  for (const { name, report } of parsed) {
    if (!report.success) {
      problems.push(`${name}.json reports a failed run (success: false) - refusing to trust it.`);
    }
  }

  if (parsed.length > 0) {
    const newestStart = Math.max(...parsed.map(({ report }) => report.startTime));
    for (const { name, report } of parsed) {
      const ageMs = newestStart - report.startTime;
      if (ageMs > HOUR_MS) {
        const ageHours = (ageMs / HOUR_MS).toFixed(1);
        problems.push(
          `${name}.json is ${ageHours} hour(s) older than the newest report - stale, refusing to trust it.`,
        );
      }
    }
  }

  const present = new Set(parsed.map(({ name }) => name));
  for (const expected of expectedNames) {
    if (NEEDS_THE_STACK.has(expected)) continue;
    if (!present.has(expected)) {
      problems.push(
        `${expected} has a vitest config but no report in .trace-results - run pnpm test first.`,
      );
    }
  }

  return problems;
}
