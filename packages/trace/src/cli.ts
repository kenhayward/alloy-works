// The query surface over the committed corpus. Thin by design: what is worth testing lives in
// format.ts and state.ts, which are pure and tested without a process.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { problems } from './check.js';
import { REPO_ROOT, compile } from './compile.js';
import {
  formatArea,
  formatProblems,
  formatSearch,
  formatStats,
  formatTrace,
  nextIdentifier,
  search,
} from './format.js';
import { checkCoherence, parseResults } from './results.js';
import { allTraces, traceOf } from './state.js';

const DEFAULT_RESULTS_DIR = '.trace-results';
const WORKSPACE_GROUPS = ['apps', 'packages', 'tests'];
const VITEST_CONFIG = /^vitest\.config\.(ts|mts|cts|js|mjs|cjs)$/;

/**
 * The workspace directory name of every package that declares a `vitest.config.*` - which, by the
 * convention every config in this repo follows, is also the basename of the JSON report it writes
 * to `.trace-results`. `verify` uses this to notice a package whose tests never ran, not just one
 * whose report looks wrong.
 */
function packagesWithVitestConfig(repoRoot: string): string[] {
  const names: string[] = [];
  for (const group of WORKSPACE_GROUPS) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const hasVitestConfig = readdirSync(join(groupDir, entry.name)).some((file) =>
        VITEST_CONFIG.test(file),
      );
      if (hasVitestConfig) names.push(entry.name);
    }
  }
  return names;
}

const USAGE = `pnpm trace <command>

  show <ID>          one requirement: its statement, tranche, state and owning design
  search <term>      every requirement whose statement mentions the term
  area <XXX>         every requirement in an area, with its state
  next <XXX>         the next free identifier in an area
  stats              the whole corpus, by tranche and state
  check              every problem in the corpus: holes, double claims, citations naming nothing
  verify [dir]       states, with Verified computed from the JSON reports in dir
                     (default .trace-results)
`;

function main(argv: string[]): number {
  try {
    const [command, argument] = argv;
    const model = compile(REPO_ROOT);

    switch (command) {
      case 'show': {
        if (argument === undefined) return fail('show needs an identifier, such as CNT-014.');
        const trace = traceOf(argument.toUpperCase(), model);
        if (trace === undefined) return fail(`No requirement ${argument} in the corpus.`);
        console.log(formatTrace(trace));
        return 0;
      }
      case 'search': {
        if (argument === undefined) return fail('search needs a term.');
        const term = argv.slice(1).join(' ');
        console.log(formatSearch(search(model, term), term));
        return 0;
      }
      case 'area': {
        if (argument === undefined) return fail('area needs a three-letter code, such as CNT.');
        const area = argument.toUpperCase();
        const traces = allTraces(model).filter((trace) => trace.requirement.area === area);
        if (traces.length === 0) return fail(`No area ${area} in the corpus.`);
        console.log(formatArea(traces));
        return 0;
      }
      case 'next': {
        if (argument === undefined) return fail('next needs a three-letter code, such as CNT.');
        console.log(nextIdentifier(model, argument.toUpperCase()));
        return 0;
      }
      case 'stats': {
        console.log(formatStats(model));
        return 0;
      }
      case 'check': {
        const found = problems(model);
        console.log(formatProblems(found));
        return found.length > 0 ? 1 : 0;
      }
      case 'verify': {
        const relative = argument ?? DEFAULT_RESULTS_DIR;
        const dir = join(REPO_ROOT, relative);
        if (!existsSync(dir)) {
          return fail(
            `No ${relative} directory. Run \`pnpm test\` first - it writes the JSON reports verify reads.`,
          );
        }
        const named = readdirSync(dir)
          .filter((name) => name.endsWith('.json'))
          .map((name) => ({
            name: name.slice(0, -'.json'.length),
            report: JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown,
          }));
        const problems = checkCoherence(named, packagesWithVitestConfig(REPO_ROOT));
        if (problems.length > 0) {
          console.log(
            [
              `${problems.length} problem(s) with the reports in ${relative} - refusing to compute Verified:`,
              '',
              ...problems,
            ].join('\n'),
          );
          return 1;
        }
        const verifications = parseResults(named.map(({ report }) => report));
        console.log(formatStats(model, verifications));
        return 0;
      }
      default:
        console.log(USAGE);
        return command === undefined ? 0 : 1;
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Writes to stdout, not stderr: the CLI's output is one stream a person reads or pipes, and
 * splitting errors onto stderr would hide them from `pnpm trace ... | less`.
 */
function fail(message: string): number {
  console.log(message);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
