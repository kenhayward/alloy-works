import { problems as corpusProblems, type Problem } from './check.js';
import type { Baseline, TraceModel, VERIFICATION_KINDS } from './model.js';
import type { TestOutcome } from './results.js';

export type Unmet = { id: string; kind: (typeof VERIFICATION_KINDS)[number]; why: string };

/**
 * The decision, and nothing more: a pure function of a baseline, the compiled corpus and a test run.
 * It does not print, does not read files and does not exit - a gate that also has opinions is a gate
 * somebody switches off. `pnpm trace gate` (stage 3, task 4) is what turns this into output and an
 * exit code.
 */
export interface GateResult {
  readonly baseline: string;
  readonly declaredAt: string;
  readonly total: number;
  readonly met: number;
  readonly unmet: Unmet[];
  readonly problems: Problem[];
}

export function gate(
  baseline: Baseline,
  model: TraceModel,
  outcomes: Map<string, TestOutcome>,
): GateResult {
  const requirementById = new Map(
    model.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const includedIds = new Set(baseline.included.map((inclusion) => inclusion.id));
  const excludedIds = new Set(baseline.excluded.map((exclusion) => exclusion.id));
  const verificationById = new Map(baseline.verification.map((row) => [row.id, row]));
  const found = corpusProblems(model);

  const unmet: Unmet[] = [];

  // Rule 3: an exclusion for a requirement that is also included contradicts itself, and is refused
  // outright rather than folded into the ordinary evaluation below - whatever its test result says,
  // a baseline cannot both answer for a requirement and disclaim it.
  const contradictory = new Set<string>();
  for (const id of excludedIds) {
    if (includedIds.has(id)) {
      contradictory.add(id);
      unmet.push({
        id,
        kind: verificationById.get(id)?.kind ?? 'test',
        why: `${id} is both included and excluded in baseline ${baseline.name}`,
      });
    }
  }

  // Rule 4: every verification row must name an included requirement.
  for (const row of baseline.verification) {
    if (!includedIds.has(row.id)) {
      unmet.push({
        id: row.id,
        kind: row.kind,
        why: `${row.id} has a verification row but is not included in baseline ${baseline.name}`,
      });
    }
  }

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

  const evaluable = [...includedIds].filter((id) => !contradictory.has(id));

  function eligible(id: string): boolean {
    const requirement = requirementById.get(id);
    return requirement !== undefined && requirement.status === 'Specified' && !touching.has(id);
  }

  /** Whether `id` has its own evidence - everything except an `inherited` chain, which the fixed
   * point below resolves once every non-inherited requirement's evidence is known. */
  function hasOwnEvidence(id: string): boolean {
    const declared = verificationById.get(id);
    if (declared?.kind === 'attestation') return true;
    if (declared?.kind === 'inherited') return false;
    return outcomes.get(id)?.outcome === 'passed';
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
      if (includedIds.has(declared.by) && met.has(declared.by)) {
        met.add(id);
        changed = true;
      }
    }
  }

  for (const id of evaluable) {
    if (met.has(id)) continue;

    const kind = verificationById.get(id)?.kind ?? 'test';
    const requirement = requirementById.get(id);

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
      const target = verificationById.get(id)?.by;
      unmet.push({
        id,
        kind,
        why:
          target === undefined
            ? `${id} declares no inherited-from identifier`
            : !includedIds.has(target)
              ? `${id} inherits from ${target}, which is not in the baseline`
              : `${id} inherits from ${target}, which is not met`,
      });
      continue;
    }

    const cited = model.citations.some((citation) => citation.id === id);
    const outcome = outcomes.get(id);
    if (!cited) {
      unmet.push({ id, kind, why: `${id} is included but no test names it` });
    } else if (outcome === undefined) {
      unmet.push({ id, kind, why: `${id} is named by a test that produced no result` });
    } else {
      unmet.push({ id, kind, why: `${id} is named by a test that ${outcome.outcome}` });
    }
  }

  return {
    baseline: baseline.name,
    declaredAt: baseline.declaredAt,
    total: includedIds.size,
    met: met.size,
    unmet,
    problems: found,
  };
}
