import { definitionKinds } from '@alloy-works/domain';

/**
 * Every kind of artifact the version chain holds, and the check constraint on `artifact.kind` names
 * the same list. A kind is added with the plan that gives its content a shape: a document arrived that
 * way, by 0016 widening the check, and a template, an asset and the rest will too.
 */
export const artifactKinds = ['component', 'document', ...definitionKinds] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

/** Content kinds live in exactly one space; every other kind is a definition and lives in none. */
export const contentKinds = ['component', 'document'] as const satisfies readonly ArtifactKind[];

export type ContentKind = (typeof contentKinds)[number];
