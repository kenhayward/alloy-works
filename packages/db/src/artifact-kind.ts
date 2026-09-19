import { definitionKinds } from '@alloy-works/domain';

/**
 * Every kind of artifact there is, and the check constraint on `artifact.kind` names the same list. A
 * kind is added with the plan that gives it a shape: a document arrived that way, by 0016 widening the
 * check, and a publication by 0017. A publication has no versions: nothing records one, because
 * `VersionSubstance` has no arm for it.
 */
export const artifactKinds = ['component', 'document', 'publication', ...definitionKinds] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

/** Content kinds are authored and versioned, and live in exactly one space. */
export const contentKinds = ['component', 'document'] as const satisfies readonly ArtifactKind[];

export type ContentKind = (typeof contentKinds)[number];

/** The kinds that live in exactly one space: content, and what is published from it (finding 9). */
export const spacedKinds = [
  ...contentKinds,
  'publication',
] as const satisfies readonly ArtifactKind[];
