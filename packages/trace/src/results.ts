import { z } from 'zod';

import { RESERVED_AREA, validate } from './model.js';

export type Outcome = 'passed' | 'failed' | 'skipped';

export interface Verification {
  readonly id: string;
  readonly outcome: Outcome;
  readonly tests: string[];
}

/**
 * The shape Vitest's built-in `json` reporter writes, narrowed to what matters here. Declared rather
 * than trusted: a silently changed reporter format would otherwise show up as every requirement
 * quietly becoming unverified, which is the worst way to learn about it.
 */
const Report = z.object({
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
export function parseResults(reports: unknown[]): Map<string, Verification> {
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
