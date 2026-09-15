import { definitionKinds } from '@alloy-works/domain';

/**
 * Every kind of artifact the version chain holds, and the check constraint on `artifact.kind` names
 * the same list. A kind is added with the plan that gives its content a shape: a document, an outline,
 * an asset and the rest arrive that way, by a migration widening the check.
 */
export const artifactKinds = ['component', ...definitionKinds] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

/** Content kinds live in exactly one space; every other kind is a definition and lives in none. */
export const contentKinds = ['component'] as const satisfies readonly ArtifactKind[];

export type ContentKind = (typeof contentKinds)[number];
