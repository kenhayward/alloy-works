export {
  OUTLINE_SCHEMA_VERSION,
  outlineDocumentSchema,
  outlineNodeSchema,
  sectionNodeSchema,
  referenceNodeSchema,
  referenceModeSchema,
  parseOutlineDocument,
  migrateOutline,
  outlineMigrationChain,
  readOutline,
  readOutlineView,
  withholdComponents,
  canonicaliseOutline,
  walkOutline,
} from './outline.js';
export type {
  OutlineDocument,
  OutlineNode,
  SectionNode,
  ReferenceNode,
  OutlineReadOutcome,
  OutlineView,
  OutlineViewNode,
  OutlineViewReadOutcome,
  ReferenceViewNode,
  SectionViewNode,
} from './outline.js';

export { applyOutlineOperation, outlineOperationSchema } from './operations.js';
export type { OutlineApplied, OutlineOperation } from './operations.js';
