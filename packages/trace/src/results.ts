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
 * Whether a set of JSON reports is coherent enough to trust for `verify`. Nothing cleans
 * `.trace-results`, and each `vitest.config.ts` overwrites only its own file, so left unchecked a
 * report can silently outlive the run that produced it: `tests/e2e`'s report is never refreshed by
 * `pnpm test` (which deliberately excludes it), a filtered run such as
 * `pnpm --filter X test somefile` writes a truncated report, and a suite that dies before writing
 * leaves the previous pass in place. Any of those makes `Verified` a number computed from a run that
 * never happened, which is worse than not computing it at all.
 *
 * Returns one legible sentence per problem found, naming the report; an empty array means the set
 * agrees with itself. `tests/e2e` is exempt from the "no report at all" check - `pnpm test` excludes
 * it on purpose - but not from the staleness check, which is exactly what catches an `e2e.json` that
 * has not been refreshed in weeks.
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
    if (expected === 'e2e') continue;
    if (!present.has(expected)) {
      problems.push(
        `${expected} has a vitest config but no report in .trace-results - run pnpm test first.`,
      );
    }
  }

  return problems;
}
