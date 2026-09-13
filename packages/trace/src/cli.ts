// The query surface over the committed corpus. Thin by design: what is worth testing lives in
// format.ts and state.ts, which are pure and tested without a process.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { problems } from './check.js';
import { REPO_ROOT, compile } from './compile.js';
import {
  formatArea,
  formatBaseline,
  formatGate,
  formatProblems,
  formatSearch,
  formatStats,
  formatTrace,
  nextIdentifier,
  search,
} from './format.js';
import { gate } from './gate.js';
import { parseBaseline } from './parse/baseline.js';
import { packDocuments } from './pack.js';
import { dirtyTreeRefusal } from './pack-guard.js';
import {
  type NamedReport,
  type TestOutcome,
  checkCoherence,
  parseResults,
  reportsForEvidence,
} from './results.js';
import { allTraces, traceOf } from './state.js';

const DEFAULT_RESULTS_DIR = '.trace-results';
const WORKSPACE_GROUPS = ['apps', 'packages', 'tests'];
const VITEST_CONFIG = /^vitest\.config\.(ts|mts|cts|js|mjs|cjs)$/;
const BASELINES_DIR = 'baselines';
const BASELINE_DOCUMENT = /\.md$/;

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
  baseline [name]    a committed baseline: name, date, included count, exclusions and
                     verification declarations (default: the newest by filename). Reads and
                     reports only - never writes the document
  gate [name]        pass or fail a baseline (default: the newest by filename) against the JSON
                     reports in .trace-results. Exits 0 when every included requirement is met
                     and the declaration itself has no problems, 1 otherwise
  pack <version>     write the evidence pack for baseline <version> to docs/trace/<version>/ -
                     the matrix, the gaps and the test results a release is handed off with.
                     Refuses when the gate fails: an evidence pack for a release that does not
                     meet its own baseline is worse than none
`;

/**
 * The committed baseline documents, sorted by filename - the same convention `compile.ts` uses for
 * the requirement and design documents it reads, so that "newest" is a function of what is on disk
 * rather than of directory order. `README.md` explains the format; it is not itself a baseline.
 */
function baselineFiles(repoRoot: string): string[] {
  const dir = join(repoRoot, 'docs', 'specification', BASELINES_DIR);
  return readdirSync(dir)
    .filter((name) => BASELINE_DOCUMENT.test(name) && name !== 'README.md')
    .sort();
}

/**
 * The JSON reports in `dir`, and whether they agree with each other - the same coherence check
 * `verify` has always used, shared here so `gate` answers the exact same question about staleness
 * and completeness rather than a second copy that could quietly drift from it. `undefined` means the
 * directory itself does not exist; a non-empty `problems` list means it exists but cannot be trusted.
 *
 * Coherence is checked over every report, the tool's own included - a report that failed or went
 * stale is still evidence something is wrong, however that report is treated below. But the
 * identifiers fed to `parseResults` come only from `reportsForEvidence`: the tool's own report
 * verifies the tool, not the product, so it must never mark a product requirement's homework.
 */
interface LoadedResults {
  readonly problems: string[];
  readonly outcomes: Map<string, TestOutcome>;
}

function loadResults(repoRoot: string, relative: string): LoadedResults | undefined {
  const dir = join(repoRoot, relative);
  if (!existsSync(dir)) return undefined;
  const filenames = readdirSync(dir).filter((name) => name.endsWith('.json'));
  const reportByFile = new Map<string, unknown>(
    filenames.map((name) => [name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown]),
  );
  const named: NamedReport[] = filenames.map((name) => ({
    name: name.slice(0, -'.json'.length),
    report: reportByFile.get(name),
  }));
  const problems = checkCoherence(named, packagesWithVitestConfig(repoRoot));
  const outcomes =
    problems.length > 0
      ? new Map<string, TestOutcome>()
      : parseResults(reportsForEvidence(filenames).map((name) => reportByFile.get(name)));
  return { problems, outcomes };
}

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
      case 'baseline': {
        const dir = join(REPO_ROOT, 'docs', 'specification', BASELINES_DIR);
        const files = baselineFiles(REPO_ROOT);
        if (files.length === 0) return fail(`No baseline in docs/specification/${BASELINES_DIR}.`);

        const file = argument === undefined ? files[files.length - 1]! : `${argument}.md`;
        const path = join(dir, file);
        if (!existsSync(path)) {
          return fail(`No baseline ${file} in docs/specification/${BASELINES_DIR}.`);
        }

        const baseline = parseBaseline(file, readFileSync(path, 'utf8'));
        console.log(formatBaseline(baseline));
        return 0;
      }
      case 'verify': {
        const relative = argument ?? DEFAULT_RESULTS_DIR;
        const results = loadResults(REPO_ROOT, relative);
        if (results === undefined) {
          return fail(
            `No ${relative} directory. Run \`pnpm test\` first - it writes the JSON reports verify reads.`,
          );
        }
        if (results.problems.length > 0) {
          console.log(
            [
              `${results.problems.length} problem(s) with the reports in ${relative} - refusing to compute Verified:`,
              '',
              ...results.problems,
            ].join('\n'),
          );
          return 1;
        }
        console.log(formatStats(model, results.outcomes));
        return 0;
      }
      case 'gate': {
        const files = baselineFiles(REPO_ROOT);
        if (files.length === 0) return fail(`No baseline in docs/specification/${BASELINES_DIR}.`);

        const file = argument === undefined ? files[files.length - 1]! : `${argument}.md`;
        const dir = join(REPO_ROOT, 'docs', 'specification', BASELINES_DIR);
        const path = join(dir, file);
        if (!existsSync(path)) {
          return fail(`No baseline ${file} in docs/specification/${BASELINES_DIR}.`);
        }
        const baseline = parseBaseline(file, readFileSync(path, 'utf8'));

        const results = loadResults(REPO_ROOT, DEFAULT_RESULTS_DIR);
        if (results === undefined) {
          return fail(
            `No ${DEFAULT_RESULTS_DIR} directory. Run \`pnpm test\` first - it writes the JSON reports the gate reads.`,
          );
        }
        if (results.problems.length > 0) {
          console.log(
            [
              `${results.problems.length} problem(s) with the reports in ${DEFAULT_RESULTS_DIR} - refusing to run the gate:`,
              '',
              ...results.problems,
            ].join('\n'),
          );
          return 1;
        }

        const result = gate(baseline, model, results.outcomes);
        const includedIds = new Set(baseline.included.map((inclusion) => inclusion.id));
        console.log(formatGate(result, includedIds));
        return result.met === result.total && result.declarationProblems.length === 0 ? 0 : 1;
      }
      case 'pack': {
        if (argument === undefined) return fail('pack needs a version, such as 0.13.0.');

        // Refused before anything else, and before anything is written: a pack is stamped with
        // `git rev-parse HEAD`, which names the *parent* of whatever gets committed next, so a pack
        // built from a dirty tree is stamped with a commit that cannot reproduce it. See
        // pack-guard.ts.
        const status = execFileSync('git', ['status', '--porcelain'], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        });
        const refusal = dirtyTreeRefusal(status);
        if (refusal !== undefined) return fail(refusal);

        const dir = join(REPO_ROOT, 'docs', 'specification', BASELINES_DIR);
        const file = `${argument}.md`;
        const path = join(dir, file);
        if (!existsSync(path)) {
          return fail(`No baseline ${file} in docs/specification/${BASELINES_DIR}.`);
        }
        const baseline = parseBaseline(file, readFileSync(path, 'utf8'));

        const results = loadResults(REPO_ROOT, DEFAULT_RESULTS_DIR);
        if (results === undefined) {
          return fail(
            `No ${DEFAULT_RESULTS_DIR} directory. Run \`pnpm test\` first - it writes the JSON reports the gate reads.`,
          );
        }
        if (results.problems.length > 0) {
          console.log(
            [
              `${results.problems.length} problem(s) with the reports in ${DEFAULT_RESULTS_DIR} - refusing to run the gate:`,
              '',
              ...results.problems,
            ].join('\n'),
          );
          return 1;
        }

        const result = gate(baseline, model, results.outcomes);
        if (result.met !== result.total || result.declarationProblems.length > 0) {
          const includedIds = new Set(baseline.included.map((inclusion) => inclusion.id));
          console.log(
            [
              `Baseline ${baseline.name} does not pass its own gate - refusing to pack an evidence` +
                ' pack for a release that does not meet its own baseline. Run `pnpm trace gate` for' +
                ' the detail:',
              '',
              formatGate(result, includedIds),
            ].join('\n'),
          );
          return 1;
        }

        const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        }).trim();
        const documents = packDocuments({ version: argument, commit, baseline, result, model });
        for (const document of documents) {
          const absolute = join(REPO_ROOT, document.path);
          mkdirSync(dirname(absolute), { recursive: true });
          writeFileSync(absolute, document.body);
        }
        console.log(
          `Wrote the evidence pack for ${argument} to docs/trace/${argument}/` +
            ` (${documents.length} file(s)).`,
        );
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
