export * from './content/model/index.js';

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
