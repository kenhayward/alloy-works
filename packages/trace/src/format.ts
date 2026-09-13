import type { Requirement, TraceModel } from './model.js';
import { type RequirementState, type Trace, allTraces } from './state.js';

const STATES: RequirementState[] = ['Specified', 'Designed', 'Withdrawn', 'Superseded'];

export function formatTrace(trace: Trace): string {
  const { requirement } = trace;
  const lines = [
    `${requirement.id}  ${requirement.tranche}  ${trace.state}`,
    '',
    requirement.statement,
    '',
    `  specified  ${requirement.document}:${requirement.line}`,
    `  design     ${trace.design ?? 'no design claims it'}`,
  ];
  if (trace.supersededBy !== undefined) lines.push(`  superseded by ${trace.supersededBy}`);
  return lines.join('\n');
}

export function search(model: TraceModel, term: string): Requirement[] {
  const needle = term.toLowerCase();
  return model.requirements.filter((requirement) =>
    requirement.statement.toLowerCase().includes(needle),
  );
}

export function formatSearch(results: Requirement[], term: string): string {
  if (results.length === 0) return `Nothing in the corpus mentions "${term}".`;
  const rows = results.map(
    (found) => `${found.id}  ${found.tranche.padEnd(10)}  ${found.statement}`,
  );
  return [`${results.length} requirement(s) mention "${term}":`, '', ...rows].join('\n');
}

export function formatStats(model: TraceModel): string {
  const traces = allTraces(model);
  const tranches = [...new Set(traces.map((trace) => trace.requirement.tranche))].sort();
  const header = ['Tranche'.padEnd(12), ...STATES.map((state) => state.padStart(11))].join('');
  const rows = tranches.map((tranche) => {
    const inTranche = traces.filter((trace) => trace.requirement.tranche === tranche);
    const counts = STATES.map((state) =>
      String(inTranche.filter((trace) => trace.state === state).length).padStart(11),
    );
    return [tranche.padEnd(12), ...counts].join('');
  });
  return [
    `${model.requirements.length} requirements, ${model.nonRequirements.length} non-requirements, ${model.questions.length} open questions`,
    '',
    header,
    ...rows,
  ].join('\n');
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
