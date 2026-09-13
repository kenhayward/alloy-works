import type { Problem } from './check.js';
import type { Draft } from './draft.js';
import type { GateResult } from './gate.js';
import type { Baseline, Requirement, TraceModel } from './model.js';
import type { TestOutcome } from './results.js';
import { type RequirementState, type Trace, allTraces } from './state.js';

/**
 * Every rung and every exit, in the order the stats table's columns appear. Pinned by a test against
 * `RequirementState` itself - this list fell silently out of step with that type once already, which
 * is how `Covered` requirements went uncounted with no error at all.
 */
export const STATES: RequirementState[] = [
  'Specified',
  'Designed',
  'Covered',
  'Verified',
  'Withdrawn',
  'Superseded',
];

/**
 * The design line must never claim a false absence: a requirement can be Withdrawn or Superseded
 * and still be claimed by a design that has not caught up. Say both facts rather than picking one.
 */
function designLine(trace: Trace): string {
  if (trace.design === undefined) return 'no design claims it';
  if (trace.state === 'Withdrawn') return `claimed by ${trace.design}, but withdrawn`;
  if (trace.state === 'Superseded') {
    return `claimed by ${trace.design}, but superseded by ${trace.supersededBy}`;
  }
  return trace.design;
}

export function formatTrace(trace: Trace): string {
  const { requirement } = trace;
  const lines = [
    `${requirement.id}  ${requirement.tranche}  ${trace.state}`,
    '',
    requirement.statement,
    '',
    `  specified  ${requirement.document}:${requirement.line}`,
    `  design     ${designLine(trace)}`,
    ...trace.citations.map((citation) => `  tested     ${citation.file}:${citation.line}`),
  ];
  if (trace.supersededBy !== undefined) lines.push(`  superseded by ${trace.supersededBy}`);
  if (trace.verification !== undefined) lines.push(`  verified   ${trace.verification.outcome}`);
  return lines.join('\n');
}

export function search(model: TraceModel, term: string): Requirement[] {
  const needle = term.toLowerCase();
  return model.requirements.filter((requirement) =>
    requirement.statement.toLowerCase().includes(needle),
  );
}

export function formatArea(traces: Trace[]): string {
  return traces
    .map(
      (trace) =>
        `${trace.requirement.id}  ${trace.state.padEnd(10)}  ${trace.requirement.statement}`,
    )
    .join('\n');
}

/**
 * A tranche, by area, or one area of it in full. This is the listing designing a tranche starts from:
 * `stats` gives a tranche one number per state and `area` gives an area every tranche at once, and
 * neither answers "which areas does T1 reach, and how much of each has no design yet".
 *
 * Superseded and Withdrawn columns are carried rather than filtered out, because a tranche whose
 * remaining work looks small can look that way from exits rather than from progress, and that is
 * worth seeing in the same table rather than inferring from a smaller total.
 */
export function formatTranche(
  model: TraceModel,
  tranche: string,
  area?: string,
  verifications?: Map<string, TestOutcome>,
): string {
  const inTranche = allTraces(model, verifications).filter(
    (trace) => trace.requirement.tranche === tranche,
  );

  if (area !== undefined) {
    const here = inTranche.filter((trace) => trace.requirement.area === area);
    if (here.length === 0) return `No requirement in ${area} is in tranche ${tranche}.`;
    return [
      `${here.length} requirement(s) in ${area}, tranche ${tranche}:`,
      '',
      formatArea(here),
    ].join('\n');
  }

  if (inTranche.length === 0) return `No requirement is in tranche ${tranche}.`;

  const areas = [...new Set(inTranche.map((trace) => trace.requirement.area))].sort();
  // The same rule as `formatStats`: without a test run there is no Verified count, and a column of
  // zeroes would read as "nothing is verified" rather than "verification was not computed". STY has
  // verified requirements in T1, so printing 0 there would be a plain untruth.
  const states =
    verifications === undefined ? STATES.filter((state) => state !== 'Verified') : STATES;
  const header = ['Area'.padEnd(8), ...states.map((state) => state.padStart(11))].join('');
  const rows = areas.map((code) => {
    const here = inTranche.filter((trace) => trace.requirement.area === code);
    const counts = states.map((state) =>
      String(here.filter((trace) => trace.state === state).length).padStart(11),
    );
    return [code.padEnd(8), ...counts].join('');
  });

  const lines = [
    `${inTranche.length} requirement(s) in tranche ${tranche}, across ${areas.length} area(s):`,
    '',
    header,
    ...rows,
    '',
    `\`pnpm trace tranche ${tranche} <XXX>\` lists one area's requirements in full.`,
  ];
  if (verifications === undefined) {
    lines.push('`pnpm trace verify` adds the Verified column.');
  }
  return lines.join('\n');
}

export function formatSearch(results: Requirement[], term: string): string {
  if (results.length === 0) return `Nothing in the corpus mentions "${term}".`;
  const rows = results.map(
    (found) => `${found.id}  ${found.tranche.padEnd(10)}  ${found.statement}`,
  );
  return [`${results.length} requirement(s) mention "${term}":`, '', ...rows].join('\n');
}

/**
 * `Verified` is only ever computed from a run's JSON reports, which only `pnpm trace verify`
 * supplies. `stats`, `show` and `area` never do, and a `Verified` column would then read as an
 * honest zero rather than "not computed" - indistinguishable from a corpus with nothing verified.
 * So the column is omitted entirely when there is no verification map to back it, and the gap is
 * named rather than left to be misread.
 */
export function formatStats(model: TraceModel, verifications?: Map<string, TestOutcome>): string {
  const traces = allTraces(model, verifications);
  const tranches = [...new Set(traces.map((trace) => trace.requirement.tranche))].sort();
  const states =
    verifications === undefined ? STATES.filter((state) => state !== 'Verified') : STATES;
  const header = ['Tranche'.padEnd(12), ...states.map((state) => state.padStart(11))].join('');
  const rows = tranches.map((tranche) => {
    const inTranche = traces.filter((trace) => trace.requirement.tranche === tranche);
    const counts = states.map((state) =>
      String(inTranche.filter((trace) => trace.state === state).length).padStart(11),
    );
    return [tranche.padEnd(12), ...counts].join('');
  });
  const lines = [
    `${model.requirements.length} requirements, ${model.nonRequirements.length} non-requirements, ${model.questions.length} open questions`,
    '',
    header,
    ...rows,
  ];
  if (verifications === undefined) {
    lines.push('', 'Verification not computed. Run `pnpm trace verify` for a Verified count.');
  }
  return lines.join('\n');
}

/**
 * Reads and reports only - never writes. A baseline is a declaration a person committed; the whole
 * value of that is lost the moment a tool can rewrite it, so this prints exactly what is on disk:
 * name, date, how many are included, every exclusion with its reason, and any verification rows.
 */
export function formatBaseline(baseline: Baseline): string {
  const lines = [
    `${baseline.name}  declared ${baseline.declaredAt}`,
    '',
    `${baseline.included.length} requirement(s) included`,
  ];

  if (baseline.excluded.length > 0) {
    lines.push('', `${baseline.excluded.length} excluded:`);
    for (const exclusion of baseline.excluded) {
      lines.push(`  ${exclusion.id}  ${exclusion.reason}`);
    }
  }

  if (baseline.verification.length > 0) {
    lines.push('', 'Verification:');
    for (const row of baseline.verification) {
      lines.push(`  ${row.id}  ${row.kind}  ${row.by}`);
    }
  }

  return lines.join('\n');
}

export function formatProblems(found: Problem[]): string {
  if (found.length === 0) return 'No problems in the corpus.';
  const rows = found.map((problem) => `${problem.kind}  ${problem.id}  ${problem.detail}`);
  return [`${found.length} problem(s) in the corpus:`, '', ...rows].join('\n');
}

/**
 * Whether a corpus problem touches the baseline - the same attribution `gate.ts`'s rule 5 uses to
 * decide eligibility, recomputed here only for the informational count `formatGate` prints below.
 * This does not change what the gate decides; it only decides whether a problem is worth counting as
 * "outside" it. A `not-contiguous` problem's id is an AREA CODE, not a requirement - `check.ts`
 * reports one hole per area, not per identifier - so it touches the baseline whenever the baseline
 * includes ANY requirement from that area, not just when its id happens to equal one.
 */
function touchesBaseline(problem: Problem, includedIds: ReadonlySet<string>): boolean {
  if (problem.kind === 'not-contiguous') {
    return [...includedIds].some((id) => id.slice(0, 3) === problem.id);
  }
  return includedIds.has(problem.id);
}

/**
 * The gate's decision, for a person debugging a red CI build. Order matters: the baseline's name and
 * date first, so a reader knows within one line whether they are looking at the right document; the
 * met/total count next; then one line per unmet requirement, naming the rule it broke, since
 * `pnpm trace verify` computes `Verified` differently and a reader seeing that elsewhere needs to
 * know why the gate disagrees; then every declaration problem, under a heading that says plainly
 * these are defects in the baseline document itself and not in the code; and last, as information
 * that never affects the exit code, how many corpus problems lie outside the declared scope.
 *
 * `total` counts only identifiers a declaration problem did not remove (rule 3/4 in `gate.ts`), so a
 * baseline with two malformed rows can print "5 of 5 met" while two were silently dropped. The
 * met/total line is never printed alone when that happened - it says how many rows were dropped, and
 * the declaration problems themselves are always listed below, whether or not they caused a drop.
 */
export function formatGate(result: GateResult, includedIds: ReadonlySet<string>): string {
  const lines = [`${result.baseline}  declared ${result.declaredAt}`, ''];

  const dropped = includedIds.size - result.total;
  const droppedNote =
    dropped > 0 ? ` (${dropped} row(s) dropped from the declaration - see below)` : '';
  lines.push(`${result.met} of ${result.total} included requirement(s) met${droppedNote}`);

  if (result.unmet.length > 0) {
    lines.push('', 'Unmet:');
    for (const item of result.unmet) lines.push(`  ${item.why}`);
  }

  if (result.declarationProblems.length > 0) {
    lines.push('', 'Declaration problems - defects in the baseline document, not the code:');
    for (const problem of result.declarationProblems) lines.push(`  ${problem.detail}`);
  }

  const outside = result.problems.filter((problem) => !touchesBaseline(problem, includedIds));
  lines.push(
    '',
    outside.length === 0
      ? 'No corpus problems outside this baseline.'
      : `${outside.length} corpus problem(s) outside this baseline (informational - does not affect the gate).`,
  );

  return lines.join('\n');
}

/**
 * A drafted requirement, for a person to copy into the corpus by hand - the tool never writes. Names
 * the identifier, prints the row on its own line so it can be copied whole, lists the sections that
 * already hold a requirements table (never picking among them - see `draft.ts`), and states any
 * warnings before the two things left to do: paste the row where it belongs, and - the reason this
 * whole intake exists - name the issue in the pull request body so it closes.
 *
 * `issue` is `undefined` for the flag form used without `--issue`, when there is no issue to close.
 * Saying so plainly is the point: a template that printed `Fixes #${issue}` regardless would read
 * as `Fixes #undefined`, which looks like a bug rather than an honest "not applicable".
 */
export function formatDraft(draft: Draft, issue: number | undefined): string {
  const lines = [`Drafted ${draft.id}.`, '', draft.row, ''];

  if (draft.sections.length === 0) {
    lines.push(
      'No section in this document already holds a requirements table - add the row under a new one.',
    );
  } else {
    lines.push('Candidate sections:');
    for (const section of draft.sections) lines.push(`  ${section}`);
  }

  if (draft.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of draft.warnings) lines.push(`  ${warning}`);
  }

  lines.push('', 'Next: paste the row above into the section it belongs in.');
  lines.push(
    issue === undefined
      ? 'No issue number given, so there is nothing to close - pass --issue <n> if this came from one.'
      : `Then put \`Fixes #${issue}\` in the pull request body so the issue closes.`,
  );

  return lines.join('\n');
}

/**
 * The next number after the highest allocated, never the count. Identifiers are contiguous as a set
 * and withdrawn rows are kept, so counting would reissue one - and an identifier is only worth
 * citing if it means exactly one thing for ever.
 */
export function nextIdentifier(model: TraceModel, area: string): string {
  const numbers = model.requirements
    .filter((requirement) => requirement.area === area)
    .map((requirement) => Number.parseInt(requirement.id.slice(4), 10));
  if (numbers.length === 0) throw new Error(`No area ${area} in the corpus.`);
  return `${area}-${String(Math.max(...numbers) + 1).padStart(3, '0')}`;
}
