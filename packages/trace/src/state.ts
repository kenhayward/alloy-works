import { type Requirement, SUPERSEDED_BY, type TraceModel } from './model.js';

/**
 * The rungs stage 1 can compute. `Covered` and `Verified` arrive in stage 2, when citations and test
 * results exist to compute them from.
 *
 * `Withdrawn` and `Superseded` are not rungs but exits: a requirement in either state has left the
 * ladder, and counting it as a gap would be the opposite of what keeping its row is for.
 */
export type RequirementState = 'Specified' | 'Designed' | 'Withdrawn' | 'Superseded';

export interface Trace {
  readonly requirement: Requirement;
  readonly state: RequirementState;
  readonly design: string | undefined;
  readonly supersededBy: string | undefined;
}

function designClaiming(id: string, model: TraceModel): string | undefined {
  return model.designs.find((design) => design.owns.some((claim) => claim.id === id))?.document;
}

function trace(requirement: Requirement, model: TraceModel): Trace {
  const supersededBy = SUPERSEDED_BY.exec(requirement.status)?.[1];
  if (supersededBy !== undefined) {
    return { requirement, state: 'Superseded', design: undefined, supersededBy };
  }
  if (requirement.status === 'Withdrawn') {
    return { requirement, state: 'Withdrawn', design: undefined, supersededBy: undefined };
  }
  const design = designClaiming(requirement.id, model);
  return {
    requirement,
    state: design === undefined ? 'Specified' : 'Designed',
    design,
    supersededBy: undefined,
  };
}

export function traceOf(id: string, model: TraceModel): Trace | undefined {
  const requirement = model.requirements.find((candidate) => candidate.id === id);
  return requirement === undefined ? undefined : trace(requirement, model);
}

export function allTraces(model: TraceModel): Trace[] {
  return model.requirements.map((requirement) => trace(requirement, model));
}
