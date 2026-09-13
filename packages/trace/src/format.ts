import type { Problem } from './check.js';
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
