export * from './content/model/index.js';

// The admission pipeline: every paste, copy and import enters a component through it.
export * from './content/admission/index.js';

// Metadata: which fields apply to a component, what makes a value valid, and what a version records.
export * from './metadata/index.js';

// The whole version, as its digest serialises it (ADR-0024). The caller hashes.
export {
  canonicaliseVersion,
  canonicaliseVersionContent,
  componentTypeOf,
} from './version/substance.js';
export type {
  ComponentSubstance,
  DefinitionSubstance,
  DocumentSubstance,
  VersionSubstance,
} from './version/substance.js';

// Access: who may do what to which artifact, and why (docs/design/access.md). The caller loads facts.
export * from './access/index.js';

// The document's outline: the tree, its parse, and the five operations over it.
export * from './structure/index.js';

// Scaffolding. This is NOT the content model - see docs/design/content-model.md for that, and
// CLAUDE.md for why this exists. `apps/web` still uses it; retiring it is that app's change.
export {
  componentSchema,
  componentTypes,
  createComponent,
  parseComponent,
  nextVersion,
} from './component.js';

export type { Component, ComponentDraft, ComponentType } from './component.js';
