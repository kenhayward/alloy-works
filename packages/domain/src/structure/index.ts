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
  canonicaliseTitle,
  walkOutline,
  outlineMatterSchema,
  mayBeFront,
} from './outline.js';
export type {
  OutlineDocument,
  OutlineNode,
  OutlineMatter,
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

export { contributionsOf, inlineContributions } from './contributions.js';
export type { Contribution } from './contributions.js';
export { conditions, number, resolve, sectionNumbers } from './numbering.js';
export type {
  Conditioned,
  NumberableNode,
  NumberableOutline,
  NumberingEntry,
  NumberingTable,
  Resolved,
} from './numbering.js';
export {
  defaultNumberingScheme,
  formatCounter,
  numberingSchemeSchema,
  REQUIRED_SEQUENCES,
} from './scheme.js';
export type { NumberFormat, NumberingRule, NumberingScheme } from './scheme.js';

export { contents, listOf } from './lists.js';
export type { ContentsEntry, ListEntry } from './lists.js';

export {
  documentTargets,
  formsFor,
  kindWord,
  printableForms,
  printed,
  referenceResolver,
  targetForms,
} from './references.js';
export type {
  BoundTarget,
  DocumentTargetsInput,
  Reading,
  ReferenceKind,
  ReferenceResolution,
  ReferenceTarget,
  ResolvingDocument,
  UnresolvedReason,
} from './references.js';
