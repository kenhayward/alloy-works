import { SUPERSEDED_BY, type TraceModel } from './model.js';

export type ProblemKind =
  | 'issued-twice'
  | 'wrong-document'
  | 'not-contiguous'
  | 'supersedes-unknown'
  | 'claims-unknown'
  | 'claimed-twice'
  | 'cites-unknown'
  | 'cited-undesigned';

export interface Problem {
  readonly kind: ProblemKind;
  readonly id: string;
  readonly detail: string;
}

/**
 * Every property of the corpus that no single row can establish, computed rather than asserted.
 *
 * These lived as assertions inside two test files, which meant the only way to learn whether the
 * corpus was sound was to run Vitest. `state.ts` depends on one of them - that a requirement has at
 * most one owning design - without being able to see it. Here they are data, the tests assert this
 * list is empty, and `pnpm trace check` gives a person the same answer.
 */
export function problems(model: TraceModel): Problem[] {
  const found: Problem[] = [];
  const known = new Set(model.requirements.map((requirement) => requirement.id));

  const seen = new Set<string>();
  for (const requirement of model.requirements) {
    if (seen.has(requirement.id)) {
      found.push({
        kind: 'issued-twice',
        id: requirement.id,
        detail: `allocated more than once, in ${requirement.document}`,
      });
    }
    seen.add(requirement.id);

    if (requirement.document.slice(0, 3) !== requirement.id.slice(0, 3)) {
      found.push({
        kind: 'wrong-document',
        id: requirement.id,
        detail: `sits in ${requirement.document}, which belongs to another area`,
      });
    }

    const target = SUPERSEDED_BY.exec(requirement.status)?.[1];
    if (target !== undefined && !known.has(target)) {
      found.push({
        kind: 'supersedes-unknown',
        id: requirement.id,
        detail: `is superseded by ${target}, which does not exist`,
      });
    }
  }

  const byArea = new Map<string, number[]>();
  for (const requirement of model.requirements) {
    const area = requirement.id.slice(0, 3);
    byArea.set(area, [...(byArea.get(area) ?? []), Number.parseInt(requirement.id.slice(4), 10)]);
  }
  for (const [area, numbers] of [...byArea].sort()) {
    const highest = Math.max(...numbers);
    const missing = Array.from({ length: highest }, (_, index) => index + 1).filter(
      (number) => !numbers.includes(number),
    );
    if (missing.length > 0) {
      found.push({
        kind: 'not-contiguous',
        id: area,
        detail: `is missing ${missing.map((number) => String(number).padStart(3, '0')).join(', ')} below ${highest}. A withdrawn requirement keeps its row; a deleted one leaves this hole`,
      });
    }
  }

  const claimedBy = new Map<string, string[]>();
  for (const design of model.designs) {
    for (const claim of design.owns) {
      claimedBy.set(claim.id, [...(claimedBy.get(claim.id) ?? []), design.document]);
      if (!known.has(claim.id)) {
        found.push({
          kind: 'claims-unknown',
          id: claim.id,
          detail: `is claimed by ${design.document} but does not exist`,
        });
      }
    }
  }
  for (const [id, documents] of [...claimedBy].sort()) {
    if (documents.length > 1) {
      found.push({
        kind: 'claimed-twice',
        id,
        detail: `is claimed by ${documents.join(' and ')}. Exactly one design owns a requirement`,
      });
    }
  }

  for (const citation of model.citations) {
    if (!known.has(citation.id)) {
      found.push({
        kind: 'cites-unknown',
        id: citation.id,
        detail: `is named by ${citation.file}:${citation.line} but does not exist`,
      });
      continue;
    }
    if (!claimedBy.has(citation.id)) {
      found.push({
        kind: 'cited-undesigned',
        id: citation.id,
        detail: `is named by ${citation.file}:${citation.line} and claimed by no design`,
      });
    }
  }

  return found;
}
