/**
 * What axe could not decide in each state the suite checked, read back from the suite's own report for
 * the audit a person makes before a release (CNT-177, docs/guides/auditing-a-release.md): `checkAxe`
 * writes each state's `incomplete` results into its test's `meta`, and Vitest's JSON reporter keeps
 * `meta` in `.trace-results/browser.json`. Kept apart from the script that prints it, so the reading is
 * tested without a report on disk.
 */

interface Undecided {
  readonly rule: string;
  readonly target: string;
}

/** The report, narrowed to what is read here. */
export interface Report {
  readonly testResults: readonly {
    readonly name: string;
    readonly assertionResults: readonly {
      readonly fullName: string;
      readonly meta?: {
        readonly axe?: {
          readonly engine: string;
          readonly incomplete: Readonly<Record<string, readonly Undecided[]>>;
        };
      };
    }[];
  }[];
}

/**
 * The lines to print: a summary, the count by rule, then each state axe left something in, with the
 * file and the test that checked it and each rule and element.
 */
export function undecided(report: Report): string[] {
  let engine: string | null = null;
  let states = 0;
  const byRule = new Map<string, number>();
  const each: string[] = [];
  let withAny = 0;
  for (const file of report.testResults) {
    for (const test of file.assertionResults) {
      const axe = test.meta?.axe;
      if (axe === undefined) continue;
      engine = axe.engine;
      for (const [state, found] of Object.entries(axe.incomplete)) {
        states += 1;
        if (found.length === 0) continue;
        withAny += 1;
        // The report names each file by its whole path; from the workspace's `src/` is enough.
        each.push(`${state} (${file.name.replace(/^.*?(?=src\/)/, '')}, ${test.fullName})`);
        for (const one of found) {
          byRule.set(one.rule, (byRule.get(one.rule) ?? 0) + 1);
          each.push(`  ${one.rule} at ${one.target}`);
        }
      }
    }
  }
  if (engine === null) {
    return ['The report holds no axe run: run pnpm test:browser against the stack first.'];
  }
  const elements = [...byRule.values()].reduce((sum, count) => sum + count, 0);
  return [
    `axe ${engine} checked ${states} states and left ${elements} elements for a person, in ${withAny} of them.`,
    '',
    ...[...byRule.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rule, count]) => `${rule}: ${count}`),
    '',
    ...each,
  ];
}
