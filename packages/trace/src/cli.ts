// The query surface over the committed corpus. Thin by design: what is worth testing lives in
// format.ts and state.ts, which are pure and tested without a process.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { problems } from './check.js';
import { REPO_ROOT, compile } from './compile.js';
import { draftRequirement } from './draft.js';
import {
  formatAllAreas,
  formatArea,
  formatBaseline,
  formatDraft,
  formatGate,
  formatProblems,
  formatSearch,
  formatStats,
  formatTrace,
  formatTranche,
  nextIdentifier,
  search,
} from './format.js';
import { gate } from './gate.js';
import { type TraceModel, TRANCHES, validate } from './model.js';
import { type AreaIndexEntry, parseAreaIndex } from './parse/areas.js';
import { parseBaseline } from './parse/baseline.js';
import { FiledRequirement, normalizeTranche, parseIssue } from './parse/issue.js';
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
  area --all         every area, in the areas index's order, each under a heading with its name
                     and its count
  area <XXX> | --all --file <filename>
                     the same listing written to a file, UTF-8, instead of printed. A relative
                     filename is taken from the repository root, wherever pnpm trace is run
  tranche <Tn> [XXX]  a tranche by area, with a count per state; with an area, that area's
                     requirements in full - the listing designing a tranche starts from
  next <XXX>         the next free identifier in an area
  stats              the whole corpus, by tranche and state
  check              every problem in the corpus: holes, double claims, citations naming nothing
  draft <issue>      read GitHub issue <issue> and draft a row from it
  draft --area XXX --statement "..." [--tranche T1] [--issue 42]
                     draft a row from the command line - no gh required. Prints only; never
                     writes - paste the row yourself and put \`Fixes #<issue>\` in the pull
                     request body
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

const DRAFT_FLAG_FORM = 'draft --area XXX --statement "..." [--tranche T1] [--issue 42]';

interface DraftInput {
  readonly filed: FiledRequirement;
  readonly issue: number | undefined;
}

interface DraftInputError {
  readonly error: string;
}

/**
 * What `area` prints, or why it cannot: one area by its code, or `--all` for every area under
 * headings taken from the areas index. The index is read through `loadIndex` only for `--all`, so a
 * single-area listing never depends on a document it does not use.
 */
export function areaListing(
  argument: string | undefined,
  model: TraceModel,
  loadIndex: () => AreaIndexEntry[],
): AreaListing | { error: string } {
  if (argument === undefined) {
    return { error: 'area needs a three-letter code, such as CNT, or --all for every area.' };
  }
  const traces = allTraces(model);
  if (argument === '--all') {
    const index = loadIndex();
    const areas = new Set([
      ...index.map((entry) => entry.code),
      ...traces.map((trace) => trace.requirement.area),
    ]);
    return {
      output: formatAllAreas(traces, index),
      requirements: traces.length,
      areas: areas.size,
    };
  }
  const area = argument.toUpperCase();
  const inArea = traces.filter((trace) => trace.requirement.area === area);
  if (inArea.length === 0) return { error: `No area ${area} in the corpus.` };
  return { output: formatArea(inArea), requirements: inArea.length, areas: 1 };
}

/** A listing, and how much is in it - which is what the line after writing one to a file reports. */
export interface AreaListing {
  output: string;
  requirements: number;
  areas: number;
}

/**
 * The `area` command's arguments: the area code or `--all`, and `--file <filename>` before or after
 * it. A missing target is left absent rather than refused here, so `areaListing` refuses it with the
 * one message that names both forms.
 */
export function readAreaArguments(
  args: readonly string[],
): { target?: string; file?: string } | { error: string } {
  const read: { target?: string; file?: string } = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--file') {
      const filename = args[i + 1];
      if (filename === undefined || filename.startsWith('--')) {
        return { error: '--file needs a filename, such as --file areas.txt.' };
      }
      read.file = filename;
      i += 1;
      continue;
    }
    if (read.target !== undefined) {
      return { error: `area lists one area or --all, not both ${read.target} and ${arg}.` };
    }
    read.target = arg;
  }
  return read;
}

/**
 * Where `--file` writes. A relative filename is taken from `base`: under `pnpm trace` that is
 * `INIT_CWD`, the directory pnpm started from, which for this repository is its root wherever inside it
 * the command is run - not `packages/trace`, where pnpm actually runs the CLI. A folder that does not
 * exist is refused rather than created, so a mistyped path cannot leave stray folders behind.
 */
export function resolveOutputPath(
  file: string,
  base: string,
  directoryExists: (dir: string) => boolean,
): { path: string } | { error: string } {
  const path = isAbsolute(file) ? file : resolve(base, file);
  const folder = dirname(path);
  if (!directoryExists(folder)) {
    return { error: `No folder ${folder} to write ${basename(path)} into.` };
  }
  return { path };
}

/**
 * Writes a listing as UTF-8 with no byte-order mark, LF line endings and a final newline, so the
 * file reads the same in any editor on any platform and diffs cleanly against the next one.
 */
export function writeListing(path: string, text: string): void {
  const lf = text.replace(/\r\n?/g, '\n');
  writeFileSync(path, lf.endsWith('\n') ? lf : `${lf}\n`, { encoding: 'utf8' });
}

/** The one line printed instead of the listing, naming the counts and the full path written. */
export function describeWrite(listing: AreaListing, path: string): string {
  const count = (n: number, noun: string): string =>
    `${n.toLocaleString('en-GB')} ${noun}${n === 1 ? '' : 's'}`;
  return `Wrote ${count(listing.requirements, 'requirement')} in ${count(listing.areas, 'area')} to ${path}`;
}

/**
 * One of `draft`'s two ways in, read into a `FiledRequirement` and, if known, the issue number the
 * pull request will close. The numeric form shells out to `gh`, which may be missing or
 * unauthenticated - that failure is reported as one sentence naming the flag form, never a stack
 * trace. The flag form builds a `FiledRequirement` by hand, the same "somebody built it by hand
 * rather than through the issue form" case `draft.ts` already documents its own belt-and-braces
 * check against - and, because it never goes through `parseIssue`'s own `validate(FiledRequirement,
 * ...)` call, is passed through that same schema here. Without this the two ways in disagreed about
 * what is acceptable: `--area zz9` became `ZZ9` unrefused, and a statement with no must/should was
 * only warned about rather than refused, exactly as the issue-form path refuses it.
 */
export function readDraftInput(args: string[]): DraftInput | DraftInputError {
  const first = args[0];

  if (first !== undefined && !first.startsWith('--')) {
    const issue = Number.parseInt(first, 10);
    if (!Number.isInteger(issue) || issue <= 0) {
      return { error: `"${first}" is not an issue number. Usage: pnpm trace ${DRAFT_FLAG_FORM}` };
    }

    let body: string;
    try {
      body = execFileSync(
        'gh',
        ['issue', 'view', String(issue), '--json', 'body', '--jq', '.body'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
    } catch {
      return {
        error:
          `Could not read issue #${issue} with \`gh\` - it may not be installed, you may not be ` +
          `signed in, or the issue may not exist. Use the flag form instead: pnpm trace ${DRAFT_FLAG_FORM}`,
      };
    }
    try {
      return { filed: parseIssue(body), issue };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        error: `Issue #${issue} is not a filed requirement: ${reason} Use the flag form instead: pnpm trace ${DRAFT_FLAG_FORM}`,
      };
    }
  }

  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (key?.startsWith('--')) flags.set(key.slice(2), args[index + 1] ?? '');
  }

  const area = flags.get('area');
  const statement = flags.get('statement');
  if (area === undefined || statement === undefined) {
    return { error: `draft needs --area and --statement. Usage: pnpm trace ${DRAFT_FLAG_FORM}` };
  }

  const issueFlag = flags.get('issue');
  const issue = issueFlag === undefined ? undefined : Number.parseInt(issueFlag, 10);
  if (issueFlag !== undefined && (issue === undefined || !Number.isInteger(issue))) {
    return { error: `--issue must be a number, not "${issueFlag}".` };
  }

  try {
    return {
      filed: validate(
        FiledRequirement,
        {
          area: area.toUpperCase(),
          statement,
          why: '(given on the command line, not filed as an issue)',
          howWeWouldKnow: undefined,
          tranche: normalizeTranche(flags.get('tranche')),
          whoAsked: undefined,
        },
        'the draft flags',
      ),
      issue,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The area document `draft` should read candidate sections from - `AAA-whatever.md` in the
 * requirements directory, the same naming convention `compile.ts` reads by. `undefined` when the
 * area has no document at all yet. */
function areaDocumentPath(repoRoot: string, area: string): string | undefined {
  const dir = join(repoRoot, 'docs', 'specification', 'requirements');
  const match = readdirSync(dir).find(
    (name) => name.startsWith(`${area}-`) && name.endsWith('.md'),
  );
  return match === undefined ? undefined : join(dir, match);
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
        const args = readAreaArguments(argv.slice(1));
        if ('error' in args) return fail(args.error);
        const result = areaListing(args.target, model, () =>
          parseAreaIndex(
            readFileSync(
              join(REPO_ROOT, 'docs', 'specification', 'requirements', 'README.md'),
              'utf8',
            ),
          ),
        );
        if ('error' in result) return fail(result.error);
        if (args.file === undefined) {
          console.log(result.output);
          return 0;
        }
        // pnpm runs this inside packages/trace. INIT_CWD is the directory pnpm started from, which
        // for `pnpm trace` anywhere in the repository is the workspace root.
        const target = resolveOutputPath(args.file, process.env.INIT_CWD ?? process.cwd(), (dir) =>
          existsSync(dir),
        );
        if ('error' in target) return fail(target.error);
        writeListing(target.path, result.output);
        console.log(describeWrite(result, target.path));
        return 0;
      }
      case 'tranche': {
        if (argument === undefined) {
          return fail(`tranche needs a name, one of ${TRANCHES.join(', ')}.`);
        }
        const named = TRANCHES.find((name) => name.toLowerCase() === argument.toLowerCase());
        if (named === undefined) {
          return fail(`No tranche ${argument}. The tranches are ${TRANCHES.join(', ')}.`);
        }
        const second = argv[2];
        const area = second === undefined ? undefined : second.toUpperCase();
        console.log(formatTranche(model, named, area));
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
      case 'draft': {
        const input = readDraftInput(argv.slice(1));
        if ('error' in input) return fail(input.error);

        const documentPath = areaDocumentPath(REPO_ROOT, input.filed.area);
        if (documentPath === undefined) {
          return fail(
            `No requirements document for area ${input.filed.area} in docs/specification/requirements.`,
          );
        }

        const draft = draftRequirement(input.filed, model, readFileSync(documentPath, 'utf8'));
        console.log(formatDraft(draft, input.issue));
        return 0;
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
        const documents = packDocuments({
          version: argument,
          commit,
          baseline,
          result,
          model,
          outcomes: results.outcomes,
        });
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

/**
 * Runs `main` only when this file is the script Node was asked to execute - never when it is
 * imported, which `cli.test.ts` does to reach `readDraftInput` directly. Without this guard,
 * importing the module for a unit test would run the real CLI against the test runner's own
 * `process.argv`, reading the real corpus and setting `process.exitCode` as a side effect of import.
 */
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  process.exitCode = main(process.argv.slice(2));
}
