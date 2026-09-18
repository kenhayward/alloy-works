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
  canonicaliseOutline,
  walkOutline,
} from './outline.js';
export type {
  OutlineDocument,
  OutlineNode,
  SectionNode,
  ReferenceNode,
  OutlineReadOutcome,
} from './outline.js';

export { applyOutlineOperation, outlineOperationSchema } from './operations.js';
export type { OutlineApplied, OutlineOperation } from './operations.js';
