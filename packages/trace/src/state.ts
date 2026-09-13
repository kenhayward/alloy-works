import { type Citation, type Requirement, SUPERSEDED_BY, type TraceModel } from './model.js';
import type { TestOutcome } from './results.js';

/**
 * The full ladder. `Covered` means a test names the requirement; `Verified` means that test actually
 * passed - stage 1 could only compute the first two rungs, from documents alone.
 *
 * `Withdrawn` and `Superseded` are not rungs but exits: a requirement in either state has left the
 * ladder, and counting it as a gap would be the opposite of what keeping its row is for. A passing
 * test naming an exited requirement does not resurrect it.
 */
export type RequirementState =
  'Specified' | 'Designed' | 'Covered' | 'Verified' | 'Withdrawn' | 'Superseded';

export interface Trace {
  readonly requirement: Requirement;
  readonly state: RequirementState;
  readonly design: string | undefined;
  readonly supersededBy: string | undefined;
  readonly citations: Citation[];
  readonly verification: TestOutcome | undefined;
}

function designClaiming(id: string, model: TraceModel): string | undefined {
  return model.designs.find((design) => design.owns.some((claim) => claim.id === id))?.document;
}

function trace(
  requirement: Requirement,
  model: TraceModel,
  verifications: Map<string, TestOutcome> | undefined,
): Trace {
  const design = designClaiming(requirement.id, model);
  const citations = model.citations.filter((citation) => citation.id === requirement.id);
  const verification = verifications?.get(requirement.id);
  const supersededBy = SUPERSEDED_BY.exec(requirement.status)?.[1];
  if (supersededBy !== undefined) {
    return { requirement, state: 'Superseded', design, supersededBy, citations, verification };
  }
  if (requirement.status === 'Withdrawn') {
    return {
      requirement,
      state: 'Withdrawn',
      design,
      supersededBy: undefined,
      citations,
      verification,
    };
  }
  // A `rule:` citation reaches `Covered`, never `Verified`: a result is identified by its test's
  // name, and a `rule:` assertion lives in a test's body, not its title, so no result ever carries
  // it. Only a `title` citation can be matched to a passed outcome and earn the top rung.
  const state: RequirementState =
    citations.length === 0
      ? design === undefined
        ? 'Specified'
        : 'Designed'
      : verification?.outcome === 'passed' &&
          citations.some((citation) => citation.kind === 'title')
        ? 'Verified'
        : 'Covered';
  return { requirement, state, design, supersededBy: undefined, citations, verification };
}

export function traceOf(
  id: string,
  model: TraceModel,
  verifications?: Map<string, TestOutcome>,
): Trace | undefined {
  const requirement = model.requirements.find((candidate) => candidate.id === id);
  return requirement === undefined ? undefined : trace(requirement, model, verifications);
}

export function allTraces(model: TraceModel, verifications?: Map<string, TestOutcome>): Trace[] {
  return model.requirements.map((requirement) => trace(requirement, model, verifications));
}
