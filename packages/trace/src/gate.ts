import { problems as corpusProblems, type Problem } from './check.js';
import {
  ATTESTATION_MIN_LENGTH,
  attestationIsSubstantial,
  inheritedFrom,
  isRecordOf,
  localRunDeclared,
  recordsNamed,
  type Baseline,
  type TraceModel,
  type VERIFICATION_KINDS,
  type Verification,
} from './model.js';
import { readRecordedRun, type TestOutcome } from './results.js';
import { traceOf } from './state.js';

export type Unmet = { id: string; kind: (typeof VERIFICATION_KINDS)[number]; why: string };

/**
 * A problem with the baseline's own declaration - rules 3 and 4 - as opposed to `Problem`, which is
 * a defect in the corpus itself. Kept separate from `Unmet` so `met + unmet.length === total` stays
 * an invariant: these are about identifiers the included/met/unmet accounting was never meant to
 * cover (an id excluded as well as included, a verification row naming an id outside the baseline)
 * or about a declaration too ambiguous to score honestly either way (two rows for one identifier).
 */
export type DeclarationProblemKind =
  | 'both-included-and-excluded'
  | 'verification-outside-baseline'
  | 'duplicate-verification'
  | 'blank-attestation'
  | 'missing-record';

export interface DeclarationProblem {
  readonly kind: DeclarationProblemKind;
  readonly id: string;
  readonly detail: string;
}

/**
 * The decision, and nothing more: a pure function of a baseline, the compiled corpus and a test run.
 * It does not print, does not read files and does not exit - a gate that also has opinions is a gate
 * somebody switches off. `pnpm trace gate` (stage 3, task 4) is what turns this into output and an
 * exit code.
 */
/**
 * What the gate is told of the repository for a `local-run` row, asked rather than read so it stays
 * pure: how many test files the worker's suite has, which a whole run of it must cover; and whether a
 * commit is in this branch's history - `unknown` where the clone holds no history to ask, as CI's
 * shallow checkout does not.
 */
export interface LocalRunFacts {
  readonly testFiles: number;
  readonly ancestry: (commit: string) => 'ancestor' | 'not-ancestor' | 'unknown';
}

/** Where a local run's tests are: the worker's suite, the one suite run where Word is. */
const LOCAL_RUN_TESTS = 'apps/worker/src/';

export interface GateResult {
  readonly baseline: string;
  readonly declaredAt: string;
  readonly total: number;
  readonly met: number;
  readonly unmet: Unmet[];
  readonly declarationProblems: DeclarationProblem[];
  readonly problems: Problem[];
}

export function gate(
  baseline: Baseline,
  model: TraceModel,
  outcomes: Map<string, TestOutcome>,
  /**
   * Whether a file - a file, not a folder - is there, by its path from the repository's root, for the
   * records an attestation names under `docs/audits/`: asked, not read, so the gate stays a pure
   * function of what it is handed. Required, so no caller can forget to look.
   */
  recordExists: (path: string) => boolean,
  /**
   * A file's text, by its path from the repository's root, or nothing where it cannot be read: for the
   * report a `local-run` row's record has beside it, which `pnpm trace record-run` wrote. Handed in, as
   * `recordExists` is, so the gate stays pure; asked only for a path of this release a row names.
   */
  readRecord: (path: string) => string | undefined,
  /** For a `local-run` row: the worker's test files and the commit's place in history. */
  facts: LocalRunFacts,
): GateResult {
  const requirementById = new Map(
    model.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const includedIds = new Set(baseline.included.map((inclusion) => inclusion.id));
  const excludedIds = new Set(baseline.excluded.map((exclusion) => exclusion.id));
  const found = corpusProblems(model);

  const declarationProblems: DeclarationProblem[] = [];

  // Rule 3: an exclusion for a requirement that is also included contradicts itself. Reported as a
  // declaration problem, not folded into the ordinary evaluation below - whatever its test result
  // says, a baseline cannot both answer for a requirement and disclaim it, so the identifier is
  // removed from the included population entirely rather than scored either way.
  const contradictory = new Set<string>();
  for (const id of excludedIds) {
    if (includedIds.has(id)) {
      contradictory.add(id);
      declarationProblems.push({
        kind: 'both-included-and-excluded',
        id,
        detail: `${id} is both included and excluded in baseline ${baseline.name}`,
      });
    }
  }

  // Rule 4: every verification row must name an included requirement. Deduplicated so a repeated
  // row for the same outside identifier is reported once, not once per row.
  const reportedOutside = new Set<string>();
  for (const row of baseline.verification) {
    if (!includedIds.has(row.id) && !reportedOutside.has(row.id)) {
      reportedOutside.add(row.id);
      declarationProblems.push({
        kind: 'verification-outside-baseline',
        id: row.id,
        detail: `${row.id} has a verification row but is not included in baseline ${baseline.name}`,
      });
    }
  }

  // Defensive, for a Baseline built programmatically rather than through the parser (which now
  // refuses this at parse time - see parse/baseline.ts): two rows for the same identifier must never
  // be resolved last-wins, because that is exactly how an appended attestation could silently launder
  // a requirement no test actually verified. Neither row is more authoritative than the other, so the
  // identifier is a declaration problem and is excluded from evaluation entirely, the same as a
  // contradictory inclusion/exclusion.
  const rowsById = new Map<string, Verification[]>();
  for (const row of baseline.verification) {
    rowsById.set(row.id, [...(rowsById.get(row.id) ?? []), row]);
  }
  const duplicateVerificationIds = new Set<string>();
  for (const [id, rows] of rowsById) {
    if (rows.length <= 1) continue;
    duplicateVerificationIds.add(id);
    if (includedIds.has(id)) {
      declarationProblems.push({
        kind: 'duplicate-verification',
        id,
        detail: `${id} has ${rows.length} verification rows in baseline ${baseline.name}; exactly one is allowed`,
      });
    }
  }
  // Rule 6: an attestation that names its record in docs/audits/ names a file that is there. The
  // record is the evidence the person's name stands for; a row pointing at nothing attests nothing.
  // A path that is not `docs/audits/<this release>/<name>.md` is refused before the disk is asked.
  for (const row of baseline.verification) {
    if (row.kind !== 'attestation' || !includedIds.has(row.id)) continue;
    for (const record of recordsNamed(row.by)) {
      const ours = isRecordOf(record, baseline.name);
      if (ours && recordExists(record)) continue;
      declarationProblems.push({
        kind: 'missing-record',
        id: row.id,
        detail: `${row.id} is attested by ${record} in baseline ${baseline.name}, which is ${
          ours ? 'not there' : 'not a record of this release'
        }`,
      });
    }
  }

  const verificationById = new Map<string, Verification>();
  for (const [id, rows] of rowsById) {
    if (rows.length === 1) verificationById.set(id, rows[0]!);
  }

  // The malformed ids above - a contradictory inclusion/exclusion, or an ambiguous duplicate
  // declaration - are declaration problems, not met-or-unmet requirements: an id whose own
  // declaration is self-contradictory cannot honestly be scored either way, so it is removed from
  // the population `total`, `met` and `unmet` are computed over. This is what keeps
  // `met + unmet.length === total` an invariant rather than an accident of which fixtures happen to
  // avoid the edge cases.
  const malformed = new Set(
    [...contradictory, ...duplicateVerificationIds].filter((id) => includedIds.has(id)),
  );
  const evaluable = [...includedIds].filter((id) => !malformed.has(id));

  // Rule 5: the corpus's own problems are carried whole in the result, but only fail the gate when
  // they touch the baseline. A problem whose id is an included requirement touches it directly. A
  // `not-contiguous` problem's id is an AREA CODE, not a requirement - `problems()` reports one hole
  // per area, not per identifier - so it touches the baseline when that area holds ANY included
  // requirement. Skipping this second case is the obvious-but-wrong implementation: matching a
  // problem's `id` straight against the included set would let a hole in an area sail through a
  // baseline that includes three requirements from it, which is exactly the deletion-disguised-as-
  // an-edit the contiguity check exists to catch.
  const touching = new Map<string, Problem[]>();
  for (const problem of found) {
    const ids =
      problem.kind === 'not-contiguous'
        ? [...includedIds].filter((id) => id.slice(0, 3) === problem.id)
        : includedIds.has(problem.id)
          ? [problem.id]
          : [];
    for (const id of ids) touching.set(id, [...(touching.get(id) ?? []), problem]);
  }

  /**
   * A `local-run` row's verdict (the W15 plan's W15-D), each condition in turn, the first that fails
   * named: its `by` names a person, a date and one record of this release; the record is there, and
   * the report `record-run` reduced beside it; the report is of a run that did not fail; by that report
   * the requirement is Verified - `traceOf`'s own rung, a title citation and every test naming it
   * passed, none skipped; and in CI's own results no test naming it failed, where a skip is expected,
   * since CI has no Word. Asked once per requirement, so each file is read once.
   */
  const localRuns = new Map<string, string | null>();
  function localRun(id: string, by: string): string | null {
    const known = localRuns.get(id);
    if (known !== undefined) return known;
    const why = ((): string | null => {
      const declared = localRunDeclared(by, baseline.name);
      if ('refused' in declared) return `${id}'s local-run \`by\` ${declared.refused}`;
      if (!recordExists(declared.record)) {
        return `${id}'s local run names its record ${declared.record}, which is not there`;
      }
      if ((readRecord(declared.record) ?? '').trim() === '') {
        return `${id}'s local run's record ${declared.record} is empty`;
      }
      const text = recordExists(declared.report) ? readRecord(declared.report) : undefined;
      if (text === undefined) {
        return `${id}'s local run has no report ${declared.report} beside its record - run pnpm trace record-run`;
      }
      const read = readRecordedRun(text);
      if ('refused' in read) {
        return read.refused === 'miscounted'
          ? `${id}'s local run's report ${declared.report} counts other tests than it holds`
          : `${id}'s local run's report ${declared.report} is not a report of a run`;
      }
      const { run } = read;
      if (run.files < facts.testFiles) {
        return (
          `${id}'s local run's report ${declared.report} covers ${run.files} of the worker's ` +
          `${facts.testFiles} test files - the whole suite is the run`
        );
      }
      if (!run.clean) {
        return `${id}'s local run was made from a working tree with uncommitted changes, by its report ${declared.report}`;
      }
      if (facts.ancestry(run.commit) === 'not-ancestor') {
        return `${id}'s local run was made at ${run.commit}, which is not in this branch's history`;
      }
      if (!run.success) return `${id}'s local run failed, by its report ${declared.report}`;
      const inWorker = model.citations.some(
        (each) => each.id === id && each.kind === 'title' && each.file.startsWith(LOCAL_RUN_TESTS),
      );
      if (!inWorker) {
        return `${id} is cited by no test title under ${LOCAL_RUN_TESTS}, where a local run's tests are`;
      }
      if (traceOf(id, model, run.outcomes)?.state !== 'Verified') {
        const there = run.outcomes.get(id);
        return there === undefined
          ? `${id} is named by no test in its local run`
          : there.outcome !== 'passed'
            ? `${id} is named by a test that ${there.outcome} in its local run`
            : `${id} is not cited by a test title, so its local run verifies nothing`;
      }
      if (outcomes.get(id)?.outcome === 'failed') {
        return `${id} is named by a test that failed in CI's own results`;
      }
      return null;
    })();
    localRuns.set(id, why);
    return why;
  }

  function eligible(id: string): boolean {
    const requirement = requirementById.get(id);
    return requirement !== undefined && requirement.status === 'Specified' && !touching.has(id);
  }

  /**
   * Whether `id` has its own evidence - everything except an `inherited` chain, which the fixed
   * point below resolves once every non-inherited requirement's evidence is known.
   *
   * The default `test` kind defers entirely to `state.ts`'s `traceOf`, which is also what
   * `pnpm trace verify` uses to decide `Verified`. That gives one shared definition of "a test names
   * it and every test naming it passed" instead of a second copy here: `traceOf` only reports
   * `Verified` when a *citation* exists for the identifier, so a test whose title is built
   * dynamically (`` it(`covers ${id}`) ``, `it.each`) - which `parseResults`'s runtime scan of
   * vitest's JSON report can match even though the static citation scan in `parse/citations.ts`
   * finds nothing - cannot be counted as met on the strength of the JSON report alone.
   */
  function hasOwnEvidence(id: string): boolean {
    const declared = verificationById.get(id);
    // Shared with the parser, which refuses an insubstantial attestation at parse time - but `gate`
    // is exported and decides CI, so it must not trust a `Baseline` built programmatically to have
    // already gone through that check.
    if (declared?.kind === 'attestation') return attestationIsSubstantial(declared.by);
    if (declared?.kind === 'inherited') return false;
    if (declared?.kind === 'local-run') return localRun(id, declared.by) === null;
    return traceOf(id, model, outcomes)?.state === 'Verified';
  }

  const met = new Set<string>();
  for (const id of evaluable) {
    if (eligible(id) && hasOwnEvidence(id)) met.add(id);
  }

  // Rule 2's `inherited` kind, resolved as a fixed point rather than by recursion: repeatedly mark
  // newly-met requirements until a full pass makes no change, then whatever is left unmarked is
  // unmet. This is what makes a cycle of inheritance ("ZZZ-001" inherited by "ZZZ-002" and
  // "ZZZ-002" inherited by "ZZZ-001", neither independently verified) terminate instead of stack-
  // overflowing: the natural-sounding recursive phrasing - "is X met? that depends on whether what X
  // inherits from is met, which depends on..." - has no base case on a cycle and recurses forever.
  // Here, a pass that adds nothing to `met` simply stops; a cycle never gets marked, and both ends
  // are reported unmet below.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of evaluable) {
      if (met.has(id) || !eligible(id)) continue;
      const declared = verificationById.get(id);
      if (declared?.kind !== 'inherited') continue;
      if (inheritedFrom(declared.by).every((from) => includedIds.has(from) && met.has(from))) {
        met.add(id);
        changed = true;
      }
    }
  }

  const unmet: Unmet[] = [];
  for (const id of evaluable) {
    if (met.has(id)) continue;

    const kind = verificationById.get(id)?.kind ?? 'test';
    const requirement = requirementById.get(id);

    // Rule 1, ahead of everything below so the message stays specific: absent or out-of-force always
    // reports its own reason, regardless of what any test or attestation might otherwise say.
    if (requirement === undefined) {
      unmet.push({ id, kind, why: `${id} does not exist in the corpus` });
      continue;
    }
    if (requirement.status !== 'Specified') {
      unmet.push({
        id,
        kind,
        why: `${id} is "${requirement.status}", not in force for this release`,
      });
      continue;
    }
    const problemsHere = touching.get(id);
    if (problemsHere !== undefined) {
      unmet.push({
        id,
        kind,
        why: `${id} has a corpus problem: ${problemsHere.map((problem) => problem.kind).join(', ')}`,
      });
      continue;
    }
    if (kind === 'inherited') {
      const by = verificationById.get(id)?.by;
      // The first it rests on that is not in the baseline, or else the first that is not met.
      const from = by === undefined ? [] : inheritedFrom(by);
      const outside = from.find((each) => !includedIds.has(each));
      const target = outside ?? from.find((each) => !met.has(each));
      unmet.push({
        id,
        kind,
        why:
          target === undefined
            ? `${id} declares no inherited-from identifier`
            : outside !== undefined
              ? `${id} inherits from ${target}, which is not in the baseline`
              : `${id} inherits from ${target}, which is not met`,
      });
      continue;
    }
    if (kind === 'local-run') {
      const declared = verificationById.get(id)!;
      unmet.push({
        id,
        kind,
        why: localRun(id, declared.by) ?? `${id} was not met by its local run`,
      });
      continue;
    }
    if (kind === 'attestation') {
      // Only reachable when `hasOwnEvidence` found nothing to accept - either a blank `by` (Minor 5)
      // or one that fails `attestationIsSubstantial` (a hand-built `Baseline` bypassing the parser's
      // own check). The two get distinct wording, so the detail says what was actually wrong rather
      // than merely that something was.
      const declaredBy = verificationById.get(id)?.by ?? '';
      const isBlank = declaredBy.trim().length === 0;
      declarationProblems.push({
        kind: 'blank-attestation',
        id,
        detail: isBlank
          ? `${id} declares an attestation with a blank \`by\` field in baseline ${baseline.name}`
          : `${id} declares an attestation whose \`by\` field does not name a person and a date ` +
            `in YYYY-MM-DD form, at least ${ATTESTATION_MIN_LENGTH} characters, in baseline ` +
            `${baseline.name}`,
      });
      unmet.push({
        id,
        kind,
        why: isBlank
          ? `${id} declares an attestation with no \`by\` text`
          : `${id}'s attestation \`by\` does not name a person and a date in YYYY-MM-DD form, at ` +
            `least ${ATTESTATION_MIN_LENGTH} characters`,
      });
      continue;
    }

    // kind === 'test' (the default): the same ladder `pnpm trace verify` reports, turned into a
    // specific reason. `Verified` would already be in `met`; `Withdrawn`/`Superseded` are handled by
    // rule 1 above, since `requirement.status === 'Specified'` here.
    const trace = traceOf(id, model, outcomes);
    const outcome = outcomes.get(id);
    if (trace?.state === 'Covered') {
      unmet.push({
        id,
        kind,
        why:
          outcome === undefined
            ? `${id} is named by a test that produced no result`
            : `${id} is named by a test that ${outcome.outcome}`,
      });
    } else if (trace?.state === 'Specified' || trace?.state === 'Designed' || trace === undefined) {
      unmet.push({ id, kind, why: `${id} is included but no test names it` });
    } else {
      // Unreachable in practice - reported honestly rather than silently claiming met.
      unmet.push({ id, kind, why: `${id} did not resolve to met for an unexpected reason` });
    }
  }

  return {
    baseline: baseline.name,
    declaredAt: baseline.declaredAt,
    total: evaluable.length,
    met: met.size,
    unmet,
    declarationProblems,
    problems: found,
  };
}
